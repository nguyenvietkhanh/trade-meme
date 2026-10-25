import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from decimal import Decimal
from .config import number
from .pricing import Fees, levels

GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"


class DataError(ValueError):
    pass


class APIError(RuntimeError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise APIError("Redirect blocked")


class Requests:
    """GET only, allowlisted official origins. Bounded pacing, retries, response size."""
    def __init__(self, config, sleep=time.sleep, clock=time.monotonic):
        self.config, self.sleep, self.clock = config, sleep, clock
        self.last = -float("inf")
        self.opener = urllib.request.build_opener(NoRedirect())

    def call(self, fn):
        for attempt in range(self.config.retries + 1):
            if self.config.stop_file.exists():
                raise InterruptedError("STOP_FILE")
            self.sleep(max(0, self.config.request_spacing - (self.clock() - self.last)))
            self.last = self.clock()
            try:
                return fn()
            except Exception as exc:
                status = getattr(exc, "code", None) or getattr(exc, "status_code", None)
                retryable = status in (429, 500, 502, 503, 504) or (isinstance(exc, (TimeoutError, urllib.error.URLError)) and not isinstance(exc, urllib.error.HTTPError))
                if not retryable or attempt == self.config.retries:
                    # No exception body/URL/query dump (future auth must never leak).
                    raise APIError("API read failed" + (f" HTTP_{status}" if status else "")) from None
                headers = getattr(exc, "headers", {}) or {}
                retry_after = headers.get("Retry-After", "0")
                try: delay = min(30, max(0, float(retry_after)))
                except ValueError: delay = 0
                delay = max(delay, min(30, 2 ** attempt + random.random()))
                # Check STOP every second while backing off.
                while delay > 0:
                    if self.config.stop_file.exists(): raise InterruptedError("STOP_FILE")
                    part = min(1, delay); self.sleep(part); delay -= part

    def get(self, origin, path, params=None):
        if origin not in (GAMMA, CLOB) or not path.startswith("/") or path.startswith("//") or "?" in path:
            raise ValueError("Non-official endpoint blocked")
        url = origin + path + ("?" + urllib.parse.urlencode(params) if params else "")
        def read():
            request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "polymarket-readonly-scanner/0.1"})
            with self.opener.open(request, timeout=10) as response:
                data = response.read(8_000_001)
            if len(data) > 8_000_000: raise APIError("Response too large")
            return json.loads(data, parse_float=Decimal)
        return self.call(read)


@dataclass(frozen=True)
class Market:
    id: str
    condition: str
    title: str
    yes: str
    no: str
    version: str = "v1"


def array(value):
    return json.loads(value) if isinstance(value, str) else value


def market_from_gamma(raw, config):
    # Strict binary YES/NO only. No guessed outcome order or neg-risk conversions.
    if raw.get("active") is not True or raw.get("closed") is not False or raw.get("acceptingOrders") is not True or raw.get("enableOrderBook") is not True:
        return None
    if raw.get("negRisk") is not False:
        return None
    version = raw.get("version")
    if version not in ("v1", "v2"):
        return None
    outcomes = array(raw.get("outcomes"))
    # Official API migration: version wins even if both ID fields are present.
    tokens = raw.get("positionIds") if version == "v2" else array(raw.get("clobTokenIds"))
    if not isinstance(outcomes, list) or not isinstance(tokens, list) or len(outcomes) != 2 or len(tokens) != 2:
        return None
    names = [str(x).lower() for x in outcomes]
    if sorted(names) != ["no", "yes"] or len(set(tokens)) != 2 or not all(isinstance(t, str) and t.isdigit() for t in tokens):
        return None
    if number(raw.get("liquidityNum")) < config.min_liquidity or number(raw.get("volumeNum")) < config.min_volume:
        return None
    condition = raw.get("conditionId")
    if not isinstance(condition, str) or not condition.startswith("0x") or len(condition) not in ((64, 66) if version == "v2" else (66,)):
        return None
    if version == "v2" and len(condition) == 66 and not condition.endswith("00"):
        return None
    try: int(condition[2:], 16)
    except ValueError: return None
    return Market(str(raw["id"]), condition, str(raw.get("question", ""))[:200], tokens[names.index("yes")], tokens[names.index("no")], version)


def fee_parameters(info, market):
    # No SDK defaults: absence is UNKNOWN, never zero fee.
    if info.get("nr", False) is not False:
        raise DataError("UNKNOWN_OR_NEG_RISK")
    tokens = info.get("t")
    if not isinstance(tokens, list) or len(tokens) != 2:
        raise DataError("MARKET_TOKEN_MISMATCH")
    observed = {str(t["t"]): str(t["o"]).lower() for t in tokens}
    if observed != {market.yes: "yes", market.no: "no"}:
        raise DataError("MARKET_TOKEN_MISMATCH")
    fd = info.get("fd")
    if not isinstance(fd, dict) or "r" not in fd or "e" not in fd:
        raise DataError("FEE_DATA_UNKNOWN")
    exp = number(fd["e"])
    if exp != exp.to_integral_value(): raise DataError("UNSUPPORTED_FEE_EXPONENT")
    return Fees(number(fd["r"]), int(exp))


def check_book(book, market, token, now, max_age):
    if not isinstance(book, dict) or book.get("asset_id") != token or book.get("market") != market.condition:
        raise DataError("BOOK_ID_MISMATCH")
    timestamp = float(number(book.get("timestamp"))) / 1000
    if timestamp > now + 1 or now - timestamp > max_age:
        raise DataError("STALE_OR_FUTURE_BOOK")
    asks = levels(book.get("asks"))
    minimum = number(book.get("min_order_size"))
    if minimum <= 0 or not asks:
        raise DataError("EMPTY_OR_INVALID_BOOK")
    return timestamp, minimum


class MarketData:
    def __init__(self, config, client=None):
        self.config, self.requests = config, Requests(config)
        if client is None:
            try:
                from py_clob_client_v2 import ClobClient
            except ImportError:
                raise RuntimeError("Install requirements.txt (py-clob-client-v2 required)") from None
            # No key, credentials, funder, order builder or authentication.
            client = ClobClient(host=CLOB, chain_id=137, retry_on_error=False)
        self.client = client

    def markets(self):
        result, seen = [], set()
        for page in range(self.config.max_pages):
            rows = self.requests.get(GAMMA, "/markets", {"active": "true", "closed": "false", "limit": 100, "offset": page * 100})
            if not isinstance(rows, list): raise DataError("INVALID_GAMMA_RESPONSE")
            for raw in rows:
                try: market = market_from_gamma(raw, self.config)
                except (ValueError, TypeError, KeyError): market = None
                if market and market.condition not in seen:
                    seen.add(market.condition); result.append(market)
                    if len(result) >= self.config.max_markets: return result
            if len(rows) < 100: break
        return result

    def snapshot(self, market):
        # Raw fd required: SDK internally defaults missing fees to zero; we do not.
        info = self.requests.get(CLOB, "/clob-markets/" + market.condition)
        fees = fee_parameters(info, market)
        # Public SDK calls only. Sequential snapshots; freshness/skew checked after both reads.
        yes = self.requests.call(lambda: self.client.get_order_book(market.yes))
        no = self.requests.call(lambda: self.client.get_order_book(market.no))
        now = time.time()
        yt, ym = check_book(yes, market, market.yes, now, self.config.max_book_age)
        nt, nm = check_book(no, market, market.no, now, self.config.max_book_age)
        if abs(yt - nt) > self.config.max_book_skew: raise DataError("BOOK_SKEW")
        return yes, no, fees, max(ym, nm), yt, nt
