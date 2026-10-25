"""IPv4-bound HTTPS without changing DNS globally, TLS verification or proxy policy."""
import http.client
import urllib.request


class IPv4HTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, *args, **kwargs):
        # create_connection tries DNS results and skips incompatible IPv6 bindings.
        # The original hostname is retained for SNI/certificate validation.
        kwargs["source_address"] = ("0.0.0.0", 0)
        super().__init__(*args, **kwargs)


class IPv4HTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(IPv4HTTPSConnection, req, context=self._context)


def build_opener(*handlers, force_ipv4=True):
    extra = [IPv4HTTPSHandler()] if force_ipv4 else []
    # Keep urllib's normal ProxyHandler (environment/Windows proxy) and HTTPS trust.
    return urllib.request.build_opener(*handlers, *extra)
