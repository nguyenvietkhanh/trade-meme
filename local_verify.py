"""Fetch public official documentation/API evidence locally. No keys or orders."""
import datetime
import hashlib
import json
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HOSTS = {"docs.polymarket.com", "gamma-api.polymarket.com", "clob.polymarket.com"}


class Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parts = urllib.parse.urlsplit(newurl)
        if parts.scheme != "https" or parts.hostname not in HOSTS or parts.username or parts.port not in (None, 443):
            raise ValueError("Non-official redirect blocked")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url):
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https" or parts.hostname not in HOSTS or parts.username or parts.port not in (None, 443):
        raise ValueError("Non-official URL blocked")
    opener = urllib.request.build_opener(Redirects())
    req = urllib.request.Request(url, headers={"User-Agent": "polymarket-local-verifier/0.1", "Accept": "text/plain, application/json, text/html"})
    with opener.open(req, timeout=20) as response:
        body = response.read(4_000_001)
        if len(body) > 4_000_000: raise ValueError("Oversized response")
        return response.status, body


def main():
    directory = Path("verification") / datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    directory.mkdir(parents=True, exist_ok=False)
    report = {"mode": "PUBLIC_READ_ONLY", "keys_read": False, "orders_sent": False,
              "production_verified": False, "results": []}
    sources = ["https://docs.polymarket.com/llms.txt",
               "https://clob.polymarket.com/time",
               "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1"]
    candidates = []
    condition = None
    for index, url in enumerate(sources):
        row = {"url": url}
        try:
            status, body = fetch(url)
            filename = f"public-{index}.txt"
            (directory / filename).write_bytes(body)
            row.update(status=status, file=filename, sha256=hashlib.sha256(body).hexdigest())
            if index == 0:
                # Read only links from the official docs index. Never execute documentation.
                links = re.findall(r"https://docs\.polymarket\.com/[A-Za-z0-9_./-]+", body.decode("utf-8", "replace"))
                terms = ("v2-migration", "migrat", "fees", "collateral", "wrap", "contracts", "order-book", "orderbook", "websocket", "balance")
                candidates = sorted(set(link for link in links if any(word in link.lower() for word in terms)))[:24]
            if index == 2:
                markets = json.loads(body)
                if isinstance(markets, list) and markets:
                    c = markets[0].get("conditionId")
                    if isinstance(c, str) and re.fullmatch(r"0x[0-9a-fA-F]{64}", c): condition = c
        except Exception as exc:
            row.update(status="FAILED", error_type=type(exc).__name__)
        report["results"].append(row)
    if condition:
        candidates.append("https://clob.polymarket.com/clob-markets/" + condition)
    for index, url in enumerate(candidates):
        row = {"url": url}
        try:
            status, body = fetch(url)
            filename = f"evidence-{index}.txt"
            (directory / filename).write_bytes(body)
            row.update(status=status, file=filename, sha256=hashlib.sha256(body).hexdigest())
        except Exception as exc:
            row.update(status="FAILED", error_type=type(exc).__name__)
        report["results"].append(row)
    (directory / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    import zipfile
    archive_path = directory.with_suffix(".zip")
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(directory.iterdir()): archive.write(file, file.name)
    print("Public evidence:", archive_path)
    print("No .env/private key/wallet files were read. No order sent.")
    print("HTTP success is not approval of production contracts/fees or live execution.")
    return 0 if all(row["status"] == 200 for row in report["results"][:3]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
