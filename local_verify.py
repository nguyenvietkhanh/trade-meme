"""Fetch public official documentation/API evidence locally. No keys or orders."""
import datetime
import hashlib
import json
import re
import ssl
import socket
import argparse
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from polymarket_arb.network import build_opener, curl_public_get, CurlReadError, default_public_backend

HOSTS = {"docs.polymarket.com", "gamma-api.polymarket.com", "clob.polymarket.com"}


class Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parts = urllib.parse.urlsplit(newurl)
        if parts.scheme != "https" or parts.hostname not in HOSTS or parts.username or parts.port not in (None, 443):
            raise ValueError("Non-official redirect blocked")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url, backend=None):
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https" or parts.hostname not in HOSTS or parts.username or parts.port not in (None, 443):
        raise ValueError("Non-official URL blocked")
    if backend == "browser":
        from polymarket_arb.browser_data import browser_public_get
        return browser_public_get(url, max_bytes=4_000_000)
    if (backend or default_public_backend()) == "curl":
        return curl_public_get(url, max_bytes=4_000_000)
    opener = build_opener(Redirects(), force_ipv4=True)
    req = urllib.request.Request(url, headers={"User-Agent": "polymarket-local-verifier/0.1", "Accept": "text/plain, application/json, text/html"})
    with opener.open(req, timeout=20) as response:
        body = response.read(4_000_001)
        if len(body) > 4_000_000: raise ValueError("Oversized response")
        return response.status, body


def safe_error(exc):
    result = {"status": "FAILED", "error_type": type(exc).__name__}
    reason = getattr(exc, "reason", exc)
    if hasattr(exc, "browser_error_code"):
        result.update(error_code=exc.browser_error_code)
    elif isinstance(exc, CurlReadError):
        result.update(error_code="CURL_READ_FAILED", curl_exit_code=exc.curl_exit_code)
    elif isinstance(exc, urllib.error.HTTPError):
        result.update(error_code="HTTP_ERROR", http_status=exc.code)
    elif isinstance(reason, ssl.SSLCertVerificationError):
        result.update(error_code="TLS_CERTIFICATE_VERIFY_FAILED", verify_code=reason.verify_code)
    elif isinstance(reason, socket.gaierror):
        result.update(error_code="DNS_FAILED", os_errno=reason.errno)
    elif isinstance(reason, (TimeoutError, socket.timeout)):
        result.update(error_code="CONNECTION_TIMEOUT")
    elif isinstance(reason, ssl.SSLError):
        result.update(error_code="TLS_ERROR")
    elif isinstance(reason, OSError):
        result.update(error_code="NETWORK_OS_ERROR", os_errno=reason.errno,
                      winerror=getattr(reason, "winerror", None))
    elif "certificate verify failed" in str(reason).lower():
        result.update(error_code="TLS_CERTIFICATE_VERIFY_FAILED")
    elif "tunnel connection failed: 403" in str(reason).lower():
        result.update(error_code="PROXY_CONNECT_403")
    else:
        result.update(error_code="UNCLASSIFIED_CONNECTION_ERROR")
    # Never serialize raw errors: proxy URLs/credentials may be embedded there.
    return result


def main():
    parser = argparse.ArgumentParser(description="Public API/docs diagnostics; never signs trades")
    parser.add_argument("--api-only", action="store_true", help="Skip docs; test Gamma/CLOB only")
    parser.add_argument("--backend", choices=("python", "curl", "browser"), default=default_public_backend())
    args = parser.parse_args()
    directory = Path("verification") / datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    directory.mkdir(parents=True, exist_ok=False)
    report = {"mode": "PUBLIC_READ_ONLY", "keys_read": False, "orders_sent": False,
              "production_verified": False, "report_version": 5, "force_ipv4": args.backend != "browser", "public_http_backend": args.backend, "results": []}
    sources = ["https://docs.polymarket.com/llms.txt",
               "https://clob.polymarket.com/time",
               "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1"]
    if args.api_only:
        sources = sources[1:]
    candidates = []
    condition = None
    selected_market = None
    for index, url in enumerate(sources):
        row = {"url": url}
        try:
            status, body = fetch(url, args.backend)
            filename = f"public-{index}.txt"
            (directory / filename).write_bytes(body)
            row.update(status=status, file=filename, sha256=hashlib.sha256(body).hexdigest())
            if url == "https://docs.polymarket.com/llms.txt":
                # Read only links from the official docs index. Never execute documentation.
                links = re.findall(r"https://docs\.polymarket\.com/[A-Za-z0-9_./-]+", body.decode("utf-8", "replace"))
                terms = ("v2-migration", "migrat", "fees", "collateral", "wrap", "contracts", "order-book", "orderbook", "websocket", "balance")
                candidates = sorted(set(link for link in links if any(word in link.lower() for word in terms)))[:24]
            if "gamma-api.polymarket.com" in url:
                markets = json.loads(body)
                if isinstance(markets, list) and markets:
                    c = markets[0].get("conditionId")
                    if isinstance(c, str) and re.fullmatch(r"0x[0-9a-fA-F]{62}(?:[0-9a-fA-F]{2})?", c): condition = c
                    from polymarket_arb.config import Config
                    from polymarket_arb.market_data import market_from_gamma
                    selected_market = market_from_gamma(markets[0], Config(min_liquidity=0, min_volume=0))
        except Exception as exc:
            row.update(safe_error(exc))
        report["results"].append(row)
    if not args.api_only:
        required = ["concepts/pusd.md", "trading/wallets-auth.md", "trading/place-orders.md",
                    "trading/manage-orders.md", "trading/positions/manage.md",
                    "market-data/market-details.md", "market-data/realtime-data.md",
                    "trading/realtime-order-updates.md", "api-spec/clob-openapi.yaml"]
        candidates = list(dict.fromkeys(["https://docs.polymarket.com/" + path for path in required] + candidates))
    if condition:
        candidates.append("https://clob.polymarket.com/clob-markets/" + condition)
    if selected_market:
        for asset_id in (selected_market.yes, selected_market.no):
            candidates.append("https://clob.polymarket.com/book?" + urllib.parse.urlencode({"token_id": asset_id}))
    for index, url in enumerate(candidates):
        row = {"url": url}
        try:
            status, body = fetch(url, args.backend)
            filename = f"evidence-{index}.txt"
            (directory / filename).write_bytes(body)
            row.update(status=status, file=filename, sha256=hashlib.sha256(body).hexdigest())
        except Exception as exc:
            row.update(safe_error(exc))
        report["results"].append(row)
    (directory / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    import zipfile
    archive_path = directory.with_suffix(".zip")
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(directory.iterdir()): archive.write(file, file.name)
    for row in report["results"]:
        print(row["url"].split("?")[0], row.get("error_code", row["status"]))
    print("Public evidence:", archive_path)
    print("No .env/private key/wallet files were read. No order sent.")
    print("HTTP success is not approval of production contracts/fees or live execution.")
    checks = report["results"] if args.api_only else report["results"][:len(sources)]
    return 0 if checks and all(row["status"] == 200 for row in checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())
