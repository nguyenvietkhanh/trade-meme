"""Visible installed Chrome, public navigation only. No wallet/profile/signing."""
import atexit
import json
import re
import urllib.error
import urllib.parse
from .network import PUBLIC_HOSTS


class BrowserReadError(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.browser_error_code = code


def allowed(url):
    try:
        p = urllib.parse.urlsplit(url)
        return p.scheme == "https" and p.hostname in PUBLIC_HOSTS and p.username is None and p.password is None and p.port in (None, 443) and not p.fragment
    except ValueError:
        return False


def validation_fields(body):
    # Retain query field names/numeric bounds only, never arbitrary server text.
    if len(body) > 32768: return []
    try:
        payload = json.loads(body)
        items = payload.get("detail", []) if isinstance(payload, dict) else []
        result = []
        for item in items[:8] if isinstance(items, list) else []:
            if not isinstance(item, dict): continue
            loc = item.get("loc", [])
            if not isinstance(loc, list) or len(loc) < 2 or loc[0] != "query" or loc[-1] not in ("offset", "limit", "active", "closed"):
                continue
            row = {"field": loc[-1]}
            kind = item.get("type", "")
            if isinstance(kind, str) and re.fullmatch(r"[a-zA-Z0-9_]{1,64}", kind): row["kind"] = kind
            ctx = item.get("ctx", {})
            if isinstance(ctx, dict):
                for key in ("le", "lt", "ge", "gt"):
                    value = ctx.get(key)
                    if type(value) is int and 0 <= value <= 1000000: row[key] = value
            result.append(row)
        return result
    except (ValueError, TypeError, UnicodeError): return []


class ChromeReader:
    def __init__(self):
        self.driver = self.browser = self.context = self.page = None

    def start(self):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            raise BrowserReadError("INSTALL_BROWSER_REQUIREMENTS") from None
        try:
            self.driver = sync_playwright().start()
            # Ephemeral context, never the user's default profile or wallet extensions.
            self.browser = self.driver.chromium.launch(channel="chrome", headless=False,
                args=["--disable-background-networking", "--disable-component-update"])
            self.context = self.browser.new_context(ignore_https_errors=False, service_workers="block", accept_downloads=False)
            self.context.route("**/*", self.route)
            self.page = self.context.new_page()
        except Exception:
            self.close()
            raise BrowserReadError("CHROME_START_FAILED") from None

    def route(self, route):
        request = route.request
        # Explicitly deny third-party origins and every write method.
        if request.method == "GET" and allowed(request.url):
            route.continue_()
        else:
            route.abort("blockedbyclient")

    def get(self, url, max_bytes=8_000_000):
        if not allowed(url): raise ValueError("Non-official public URL blocked")
        if self.page is None: self.start()
        try:
            response = self.page.goto(url, wait_until="domcontentloaded", timeout=25_000)
            if response is None: raise BrowserReadError("BROWSER_EMPTY_RESPONSE")
            if not allowed(response.url): raise BrowserReadError("BROWSER_EXTERNAL_REDIRECT")
            if response.status != 200:
                error = urllib.error.HTTPError(url, response.status, "Public browser read failed", response.headers, None)
                if response.status == 422:
                    try: error.public_validation = validation_fields(response.body())
                    except Exception: error.public_validation = []
                raise error
            length = response.headers.get("content-length")
            if length and int(length) > max_bytes: raise BrowserReadError("BROWSER_RESPONSE_TOO_LARGE")
            body = response.body()
            if len(body) > max_bytes: raise BrowserReadError("BROWSER_RESPONSE_TOO_LARGE")
            if urllib.parse.urlsplit(url).hostname != "docs.polymarket.com":
                try: json.loads(body)
                except (ValueError, UnicodeError):
                    # Includes interstitials/CAPTCHA. Do not interact with or solve them.
                    raise BrowserReadError("BROWSER_NON_JSON_OR_CHALLENGE") from None
            return 200, body
        except (BrowserReadError, urllib.error.HTTPError, KeyboardInterrupt):
            raise
        except Exception as exc:
            match = re.search(r"net::(ERR_[A-Z_]+)", str(exc))
            code = "BROWSER_" + match.group(1) if match else "BROWSER_TIMEOUT" if type(exc).__name__ == "TimeoutError" else "BROWSER_CONNECTION_FAILED"
            raise BrowserReadError(code) from None

    def close(self):
        for resource in (self.context, self.browser):
            if resource:
                try: resource.close()
                except Exception: pass
        if self.driver:
            try: self.driver.stop()
            except Exception: pass
        self.driver = self.browser = self.context = self.page = None


_reader = None


def browser_public_get(url, *, max_bytes=8_000_000):
    global _reader
    if _reader is None: _reader = ChromeReader()
    return _reader.get(url, max_bytes)


def close_browser():
    global _reader
    if _reader: _reader.close()
    _reader = None


atexit.register(close_browser)
