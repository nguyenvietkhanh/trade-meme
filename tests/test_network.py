import ssl
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from polymarket_arb.config import Config
from polymarket_arb.market_data import Market, MarketData
from polymarket_arb.network import IPv4HTTPSConnection, IPv4HTTPSHandler, build_opener


class NetworkTests(unittest.TestCase):
    def test_ipv4_source_binding_and_tls_verification(self):
        conn = IPv4HTTPSConnection('clob.polymarket.com', timeout=10)
        self.assertEqual(conn.source_address, ('0.0.0.0', 0))
        self.assertTrue(conn._context.check_hostname)
        self.assertEqual(conn._context.verify_mode, ssl.CERT_REQUIRED)
        conn.close()

    def test_transport_is_per_opener_and_retains_proxy_handler(self):
        import urllib.request
        before = __import__('socket').getaddrinfo
        opener = build_opener(force_ipv4=True)
        self.assertTrue(any(isinstance(h, IPv4HTTPSHandler) for h in opener.handlers))
        # A ProxyHandler may be omitted when no proxies are configured by urllib.
        self.assertIs(__import__('socket').getaddrinfo, before)
        normal = build_opener(force_ipv4=False)
        self.assertFalse(any(isinstance(h, IPv4HTTPSHandler) for h in normal.handlers))

    def test_sdk_books_share_adapter_and_cannot_post(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Config(stop_file=Path(directory)/'STOP', request_spacing=.00001)
            data = MarketData(config)
            market = Market('1', '0x'+'ab'*32, 'fixture', '111', '222')
            def read(origin, path, params=None):
                if path.startswith('/clob-markets/'):
                    return {'t':[{'t':'111','o':'Yes'},{'t':'222','o':'No'}], 'fd':{'r':0,'e':1}}
                self.assertEqual(path, '/book')
                return {'asset_id':params['token_id'], 'market':market.condition,
                        'timestamp':str(int(time.time()*1000)), 'min_order_size':'1',
                        'asks':[{'price':'.4','size':'10'}]}
            with patch.object(data.requests, 'read_json', side_effect=read) as transport:
                result = data.snapshot(market)
            self.assertEqual(transport.call_count, 3)
            self.assertEqual(result[0]['asset_id'], '111')
            self.assertEqual(result[1]['asset_id'], '222')
            with self.assertRaises(RuntimeError): data.client._post('/order')
            with self.assertRaises(ValueError): data.client._get('https://example.com/book')

    def test_ipv4_env_flag_validation(self):
        with patch.dict('os.environ', {'FORCE_IPV4':'false'}):
            self.assertFalse(Config.from_env().force_ipv4)
        with patch.dict('os.environ', {'FORCE_IPV4':'maybe'}):
            with self.assertRaises(ValueError): Config.from_env()

class CurlTransportTests(unittest.TestCase):
    def test_public_read_preserves_tls_and_uses_no_shell_or_auth(self):
        from types import SimpleNamespace
        from polymarket_arb.network import curl_public_get
        with patch('polymarket_arb.network.shutil.which', return_value='curl.exe'), patch(
            'polymarket_arb.network.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout=b'1792953205\n200', stderr=b'')) as run:
            status, body = curl_public_get('https://clob.polymarket.com/time')
        self.assertEqual((status, body), (200, b'1792953205'))
        args = run.call_args.args[0]
        self.assertIn('--ipv4', args)
        self.assertEqual(args[1], '--disable')
        self.assertNotIn('--insecure', args)
        self.assertNotIn('--location', args)
        self.assertNotIn('--noproxy', args)
        self.assertNotIn('--header', args)
        self.assertFalse(run.call_args.kwargs['shell'])
        self.assertNotIn('env', run.call_args.kwargs)

    def test_public_curl_blocks_external_host(self):
        from polymarket_arb.network import curl_public_get
        with patch('polymarket_arb.network.subprocess.run') as run:
            with self.assertRaises(ValueError): curl_public_get('https://example.com/')
            run.assert_not_called()

    def test_curl_error_never_exports_stderr(self):
        from types import SimpleNamespace
        from polymarket_arb.network import curl_public_get, CurlReadError
        from local_verify import safe_error
        with patch('polymarket_arb.network.shutil.which', return_value='curl.exe'), patch(
            'polymarket_arb.network.subprocess.run', return_value=SimpleNamespace(returncode=35, stdout=b'', stderr=b'fixture-proxy-secret')):
            with self.assertRaises(CurlReadError) as caught: curl_public_get('https://clob.polymarket.com/time')
        report = safe_error(caught.exception)
        self.assertEqual(report['curl_exit_code'], 35)
        self.assertNotIn('fixture-proxy-secret', str(report))

    def test_curl_does_not_follow_redirects(self):
        from types import SimpleNamespace
        from polymarket_arb.network import curl_public_get
        from urllib.error import HTTPError
        with patch('polymarket_arb.network.shutil.which', return_value='curl.exe'), patch(
            'polymarket_arb.network.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout=b'moved\n302', stderr=b'')):
            with self.assertRaises(HTTPError): curl_public_get('https://clob.polymarket.com/time')

    def test_python_socket_resolves_only_ipv4(self):
        import socket
        from polymarket_arb.network import ipv4_create_connection
        with patch('polymarket_arb.network.socket.getaddrinfo', return_value=[(socket.AF_INET,socket.SOCK_STREAM,6,'',('192.0.2.1',443))]) as resolve, patch('polymarket_arb.network.socket.socket') as make:
            conn = ipv4_create_connection(('clob.polymarket.com',443), 10, ('0.0.0.0',0))
        resolve.assert_called_once_with('clob.polymarket.com',443,socket.AF_INET,socket.SOCK_STREAM)
        self.assertIs(conn,make.return_value)
        conn.connect.assert_called_once_with(('192.0.2.1',443))
