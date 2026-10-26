import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from polymarket_arb.browser_data import ChromeReader, BrowserReadError, allowed
from polymarket_arb.config import Config
from polymarket_arb.market_data import Requests
from local_verify import safe_error


class BrowserTests(unittest.TestCase):
    def reader(self, status=200, body=b'{"ok":true}', url='https://clob.polymarket.com/time'):
        reader = ChromeReader()
        response = SimpleNamespace(url=url, status=status, headers={}, body=lambda: body)
        reader.page = Mock()
        reader.page.goto.return_value = response
        return reader

    def test_public_json_navigation(self):
        reader = self.reader(body=b'1792953205')
        self.assertEqual(reader.get('https://clob.polymarket.com/time'), (200, b'1792953205'))
        reader.page.goto.assert_called_once_with('https://clob.polymarket.com/time', wait_until='domcontentloaded', timeout=25000)

    def test_origin_scheme_and_credentials_restrictions(self):
        for url in ('https://example.com', 'http://clob.polymarket.com/time',
                    'https://user:pass@clob.polymarket.com/time', 'https://clob.polymarket.com:123/time'):
            self.assertFalse(allowed(url))
            with self.assertRaises(ValueError): self.reader().get(url)

    def test_route_denies_external_hosts_and_write_methods(self):
        reader = ChromeReader()
        for method, url, permit in [('GET','https://clob.polymarket.com/time',True),
                                    ('POST','https://clob.polymarket.com/order',False),
                                    ('GET','https://example.com/',False)]:
            route = Mock()
            route.request = SimpleNamespace(method=method,url=url)
            reader.route(route)
            self.assertEqual(route.continue_.call_count, int(permit))
            self.assertEqual(route.abort.call_count, int(not permit))

    def test_challenge_and_denial_are_not_automated(self):
        with self.assertRaises(BrowserReadError) as caught:
            self.reader(body=b'<html>captcha</html>').get('https://clob.polymarket.com/time')
        self.assertEqual(caught.exception.browser_error_code,'BROWSER_NON_JSON_OR_CHALLENGE')
        with self.assertRaises(HTTPError):
            self.reader(status=403).get('https://clob.polymarket.com/time')
        with self.assertRaises(BrowserReadError):
            self.reader(url='https://example.com').get('https://clob.polymarket.com/time')

    def test_maximum_response_size(self):
        with self.assertRaises(BrowserReadError):
            self.reader(body=b'12345').get('https://clob.polymarket.com/time', max_bytes=3)

    def test_market_data_requests_use_browser_backend(self):
        requests = Requests(Config(public_http_backend='browser'))
        with patch('polymarket_arb.browser_data.browser_public_get',return_value=(200,b'[{"id":"fixture"}]')) as fetch:
            data = requests.get('https://gamma-api.polymarket.com','/markets',{'limit':1})
        self.assertEqual(data,[{'id':'fixture'}])
        fetch.assert_called_once_with('https://gamma-api.polymarket.com/markets?limit=1')

    def test_browser_error_report_excludes_raw_exception(self):
        report = safe_error(BrowserReadError('CHROME_START_FAILED'))
        self.assertEqual(report['error_code'],'CHROME_START_FAILED')

    def test_close_releases_resources(self):
        reader=ChromeReader()
        resources=[Mock(),Mock(),Mock()]
        reader.context,reader.browser,reader.driver=resources
        reader.close()
        resources[0].close.assert_called_once()
        resources[1].close.assert_called_once()
        resources[2].stop.assert_called_once()
        self.assertIsNone(reader.page)

    def test_launch_is_visible_isolated_and_verifies_https(self):
        import types
        import sys
        driver=Mock()
        package=types.ModuleType('playwright')
        sync=types.ModuleType('playwright.sync_api')
        sync.sync_playwright=Mock(return_value=SimpleNamespace(start=lambda:driver))
        with patch.dict(sys.modules,{'playwright':package,'playwright.sync_api':sync}):
            reader=ChromeReader()
            reader.start()
        kwargs=driver.chromium.launch.call_args.kwargs
        self.assertEqual(kwargs['channel'],'chrome')
        self.assertFalse(kwargs['headless'])
        self.assertNotIn('user_data_dir',kwargs)
        driver.chromium.launch.return_value.new_context.assert_called_once_with(
            ignore_https_errors=False,service_workers='block',accept_downloads=False)
        reader.close()
