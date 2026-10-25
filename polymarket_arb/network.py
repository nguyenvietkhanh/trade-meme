"""IPv4-bound HTTPS without changing DNS globally, TLS verification or proxy policy."""
import http.client
import urllib.request
import urllib.error
import urllib.parse
import socket
import subprocess
import shutil
import os


def ipv4_create_connection(address, timeout=socket._GLOBAL_DEFAULT_TIMEOUT, source_address=None):
    last_error = None
    for family, kind, proto, _, endpoint in socket.getaddrinfo(address[0], address[1], socket.AF_INET, socket.SOCK_STREAM):
        connection = socket.socket(family, kind, proto)
        try:
            if timeout is not socket._GLOBAL_DEFAULT_TIMEOUT:
                connection.settimeout(timeout)
            if source_address:
                connection.bind(source_address)
            connection.connect(endpoint)
            return connection
        except OSError as exc:
            last_error = exc
            connection.close()
    if last_error:
        raise last_error
    raise OSError("No IPv4 address")


class IPv4HTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, *args, **kwargs):
        # create_connection tries DNS results and skips incompatible IPv6 bindings.
        # The original hostname is retained for SNI/certificate validation.
        kwargs["source_address"] = ("0.0.0.0", 0)
        super().__init__(*args, **kwargs)
        self._create_connection = ipv4_create_connection


class IPv4HTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(IPv4HTTPSConnection, req, context=self._context)


def build_opener(*handlers, force_ipv4=True):
    extra = [IPv4HTTPSHandler()] if force_ipv4 else []
    # Keep urllib's normal ProxyHandler (environment/Windows proxy) and HTTPS trust.
    return urllib.request.build_opener(*handlers, *extra)


PUBLIC_HOSTS = {"docs.polymarket.com", "gamma-api.polymarket.com", "clob.polymarket.com"}


class CurlReadError(OSError):
    def __init__(self, exit_code):
        super().__init__("Public curl read failed")
        self.curl_exit_code = exit_code


def default_public_backend():
    return "curl" if os.name == "nt" else "python"


def curl_public_get(url, *, force_ipv4=True, max_bytes=8_000_000):
    """Public unauthenticated GET only; never accept wallet headers, keys or bodies."""
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in PUBLIC_HOSTS or parsed.username or parsed.port not in (None, 443) or parsed.fragment:
        raise ValueError("Non-official public URL blocked")
    executable = shutil.which("curl.exe" if os.name == "nt" else "curl")
    if not executable:
        raise RuntimeError("curl is required for PUBLIC_HTTP_BACKEND=curl")
    args = [executable, "--disable", "--silent", "--show-error", "--proto", "=https",
            "--connect-timeout", "10", "--max-time", "20", "--max-filesize", str(max_bytes),
            "--write-out", "\n%{http_code}"]
    if force_ipv4: args.append("--ipv4")
    args.extend(["--url", url])
    try:
        result = subprocess.run(args, capture_output=True, timeout=25, shell=False)
    except subprocess.TimeoutExpired:
        raise CurlReadError(28) from None
    if result.returncode:
        # Never log stderr: proxy diagnostics may contain credentials or local paths.
        raise CurlReadError(result.returncode)
    try:
        body, code = result.stdout.rsplit(b"\n", 1)
        code = int(code)
    except ValueError:
        raise CurlReadError(-1) from None
    if len(body) > max_bytes:
        raise CurlReadError(63)
    # No -L: redirect responses are rejected rather than following external hosts.
    if code != 200:
        raise urllib.error.HTTPError(url, code, "Public HTTP read failed", {}, None)
    return code, body
