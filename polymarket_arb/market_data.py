import json
import random
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from decimal import Decimal
from .config import number
from .pricing import Fees, levels
from .network import build_opener, curl_public_get, CurlReadError

GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"


class DataError(ValueError):
    def __init__(self, code, details=None):
        super().__init__(code)
        self.details = details or {}


class APIError(RuntimeError):
    def __init__(self, message, *, code="API_READ_FAILED", http_status=None, attempts=1):
        super().__init__(message)
        self.safe_code = code
        self.http_status = http_status
        self.attempts = attempts
        self.stage = "unknown"
        self.request_parameters = {}
        self.validation = []


def safe_failure(exc):
    status = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    status = status if type(status) is int and 100 <= status <= 599 else None
    if status: return "HTTP_" + str(status), status
    browser = getattr(exc, "browser_error_code", None)
    if isinstance(browser, str) and re.fullmatch(r"[A-Z_]{1,80}", browser):
        return browser, None
    if isinstance(exc, CurlReadError): return "CURL_EXIT_" + str(exc.curl_exit_code), None
    if isinstance(exc, TimeoutError): return "CONNECTION_TIMEOUT", None
    return "API_READ_FAILED", None


TRANSIENT_BROWSER = {"BROWSER_ERR_CONNECTION_RESET", "BROWSER_ERR_CONNECTION_CLOSED",
                     "BROWSER_ERR_CONNECTION_TIMED_OUT", "BROWSER_ERR_TIMED_OUT",
                     "BROWSER_TIMEOUT", "BROWSER_CONNECTION_FAILED"}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise APIError("Redirect blocked")


class Requests:
    """GET only, allowlisted official origins. Bounded pacing, retries, response size."""
    def __init__(self, config, sleep=time.sleep, clock=time.monotonic):
        self.config, self.sleep, self.clock = config, sleep, clock
        self.last = -float("inf")
        self.opener = build_opener(NoRedirect(), force_ipv4=config.force_ipv4)

    def call(self, fn):
        for attempt in range(self.config.retries + 1):
            if self.config.stop_file.exists():
                raise InterruptedError("STOP_FILE")
            self.sleep(max(0, self.config.request_spacing - (self.clock() - self.last)))
            self.last = self.clock()
            try:
                return fn()
            except Exception as exc:
                if isinstance(exc, APIError): raise
                code, status = safe_failure(exc)
                retryable = code in TRANSIENT_BROWSER or status in (429, 500, 502, 503, 504) or (isinstance(exc, (TimeoutError, urllib.error.URLError, CurlReadError)) and not isinstance(exc, urllib.error.HTTPError))
                if not retryable or attempt == self.config.retries:
                    # No exception body/URL/query dump (future auth must never leak).
                    error = APIError("API read failed: " + code, code=code, http_status=status, attempts=attempt+1)
                    error.validation = getattr(exc, "public_validation", [])
                    if isinstance(exc, urllib.error.HTTPError): exc.close()
                    raise error from None
                headers = getattr(exc, "headers", {}) or {}
                retry_after = headers.get("Retry-After", headers.get("retry-after", "0"))
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
        try:
            return self.call(lambda: self.read_json(origin, path, params))
        except APIError as exc:
            exc.stage = "gamma_markets" if origin == GAMMA else "fee_metadata" if path.startswith("/clob-markets/") else "clob_read"
            if origin == GAMMA and path == "/markets":
                exc.request_parameters = {k: v for k, v in (params or {}).items()
                                          if k in ("offset", "limit") and type(v) is int}
            raise

    def read_json(self, origin, path, params=None):
        if origin not in (GAMMA, CLOB) or not path.startswith("/") or path.startswith("//") or "?" in path:
            raise ValueError("Non-official endpoint blocked")
        url = origin + path + ("?" + urllib.parse.urlencode(params) if params else "")
        request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "polymarket-readonly-scanner/0.1"})
        if self.config.public_http_backend == "browser":
            from .browser_data import browser_public_get
            _, data = browser_public_get(url)
        elif self.config.public_http_backend == "curl":
            _, data = curl_public_get(url, force_ipv4=self.config.force_ipv4)
        else:
            with self.opener.open(request, timeout=10) as response:
                data = response.read(8_000_001)
        if len(data) > 8_000_000: raise APIError("Response too large")
        return json.loads(data, parse_float=Decimal)


@dataclass(frozen=True)
class Market:
    id: str
    condition: str
    title: str
    yes: str
    no: str
    version: str = "v1"
    description: str = ""
    end_date: str = ""
    resolution_source: str = ""


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
    return Market(str(raw["id"]), condition, str(raw.get("question", ""))[:200], tokens[names.index("yes")], tokens[names.index("no")], version,
                  str(raw.get("description", ""))[:6000], str(raw.get("endDate", "")),
                  str(raw.get("resolutionSource", ""))[:1000])


def fee_parameters(info, market):
    # No SDK defaults: absence is UNKNOWN, never zero fee.
    if not isinstance(info, dict):
        raise DataError("INVALID_FEE_METADATA")
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
        raise DataError("STALE_OR_FUTURE_BOOK", {"asset_id": token,
            "book_timestamp": str(book.get("timestamp")), "client_time": now,
            "max_age_seconds": max_age})
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
                from polymarket import PublicClient
                from dataclasses import replace
            except ImportError:
                raise RuntimeError("Install requirements.txt (polymarket-client required)") from None
            adapter = self.requests
            class ReadTransport:
                def get_json(self, path, *, params=None, headers=None):
                    if headers: raise ValueError("Public reads cannot authenticate")
                    return adapter.read_json(CLOB, path, params)
                def close(self): pass
            class PublicBooks:
                def __init__(self):
                    self.sdk = PublicClient()
                    self.sdk._ctx.clob.close()
                    self.sdk._ctx = replace(self.sdk._ctx, clob=ReadTransport())
                def get_order_book(self, token):
                    b = self.sdk.get_order_book(asset_id=token)
                    return {"market": str(b.condition_id), "asset_id": str(b.asset_id),
                            "timestamp": str(int(b.timestamp.timestamp()*1000)) if b.timestamp else None,
                            "asks": [{"price":str(l.price),"size":str(l.size)} for l in b.asks],
                            "bids": [{"price":str(l.price),"size":str(l.size)} for l in b.bids],
                            "tick_size":str(b.tick_size),"min_order_size":str(b.min_order_size),
                            "neg_risk":b.neg_risk,"hash":b.hash}
                def close(self): self.sdk.close()
            client = PublicBooks()
        self.client = client
        self.discovery_offset = 0

    def markets(self):
        result, seen = [], set()
        # Resume after the last inspected raw Gamma row, not the same first N markets.
        # Offset pagination is best effort when Gamma ordering changes mid-scan.
        for _ in range(self.config.max_pages):
            window_size = self.config.discovery_window_pages * 100
            if self.discovery_offset >= window_size: self.discovery_offset = 0
            offset = self.discovery_offset
            page_limit = min(100, window_size - offset)
            rows = self.requests.get(GAMMA, "/markets", {"active": "true", "closed": "false", "limit": page_limit, "offset": offset})
            if not isinstance(rows, list): raise DataError("INVALID_GAMMA_RESPONSE")
            if not rows:
                self.discovery_offset = 0
                break
            for index, raw in enumerate(rows):
                self.discovery_offset = offset + index + 1
                try: market = market_from_gamma(raw, self.config)
                except (ValueError, TypeError, KeyError): market = None
                if market and market.condition not in seen:
                    seen.add(market.condition); result.append(market)
                    if len(result) >= self.config.max_markets:
                        if self.discovery_offset >= window_size or index == len(rows)-1 and len(rows) < page_limit:
                            self.discovery_offset = 0
                        return result
            if len(rows) < page_limit or self.discovery_offset >= window_size:
                self.discovery_offset = 0
                break
        return result

    def snapshot(self, market):
        # Raw fd required: SDK internally defaults missing fees to zero; we do not.
        info = self.requests.get(CLOB, "/clob-markets/" + market.condition)
        try:
            fees = fee_parameters(info, market)
        except DataError as exc:
            exc.details = {"metadata_fee_details": info.get("fd"), "metadata_version": info.get("v"),
                "metadata_condition": info.get("c"), "metadata_tokens": info.get("t"),
                "metadata_keys": sorted(info)} if isinstance(info, dict) else {"metadata_type": type(info).__name__}
            raise
        # Public SDK calls only. Sequential snapshots; freshness/skew checked after both reads.
        try:
            yes = self.requests.call(lambda: self.client.get_order_book(market.yes))
        except APIError as exc:
            exc.stage = "book_yes"
            raise
        try:
            no = self.requests.call(lambda: self.client.get_order_book(market.no))
        except APIError as exc:
            exc.stage = "book_no"
            raise
        now = time.time()
        yt, ym = check_book(yes, market, market.yes, now, self.config.max_book_age)
        nt, nm = check_book(no, market, market.no, now, self.config.max_book_age)
        if abs(yt - nt) > self.config.max_book_skew:
            raise DataError("BOOK_SKEW", {"yes_timestamp": yt, "no_timestamp": nt,
                "max_skew_seconds": self.config.max_book_skew})
        return yes, no, fees, max(ym, nm), yt, nt

    def close(self):
        close = getattr(self.client, "close", None)
        if close: close()
