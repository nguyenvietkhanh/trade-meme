import io
import os
import unittest
from contextlib import redirect_stdout
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from polymarket_arb.browser_data import BrowserReadError
from polymarket_arb.market_data import APIError
from local_verify import fetch_with_retry, safe_error
import browser_start


class PreflightTests(unittest.TestCase):
    def test_preflight_retries_reset_then_returns_success(self):
        with patch('local_verify.fetch',side_effect=[BrowserReadError('BROWSER_ERR_CONNECTION_RESET'),(200,b'123')]) as fetch, redirect_stdout(io.StringIO()):
            result=fetch_with_retry('https://clob.polymarket.com/time','browser',sleep=lambda _:None)
        self.assertEqual(result,(200,b'123',2))
        self.assertEqual(fetch.call_count,2)

    def test_preflight_denial_is_not_retried(self):
        with patch('local_verify.fetch',side_effect=HTTPError('fixture',403,'fixture',{},None)) as fetch, redirect_stdout(io.StringIO()):
            with self.assertRaises(APIError) as caught:
                fetch_with_retry('https://clob.polymarket.com/time','browser',sleep=lambda _:None)
        self.assertEqual(fetch.call_count,1)
        self.assertEqual(safe_error(caught.exception)['http_status'],403)

    def test_preflight_exhaustion_preserves_code_and_attempt_count(self):
        out=io.StringIO()
        with patch('local_verify.fetch',side_effect=BrowserReadError('BROWSER_ERR_CONNECTION_RESET')) as fetch, redirect_stdout(out):
            with self.assertRaises(APIError) as caught:
                fetch_with_retry('https://clob.polymarket.com/time','browser',sleep=lambda _:None)
        self.assertEqual(fetch.call_count,4)
        self.assertEqual(safe_error(caught.exception)['attempts'],4)
        self.assertEqual(safe_error(caught.exception)['error_code'],'BROWSER_ERR_CONNECTION_RESET')
        self.assertIn('attempt 4/4',out.getvalue())

    def test_same_process_handoff_does_not_close_browser_between_steps(self):
        with patch('browser_start.os.chdir'),patch('browser_start.load_env'),patch.dict(os.environ,{'DRY_RUN':'false'}),patch('browser_start.close_browser') as close,patch('browser_start.verify',return_value=0) as verify,patch('browser_start.scanner') as scanner,redirect_stdout(io.StringIO()):
            def check(args):
                close.assert_not_called()
                self.assertEqual(os.environ['DRY_RUN'],'true')
                self.assertEqual(os.environ['PUBLIC_HTTP_BACKEND'],'browser')
                return 0
            scanner.side_effect=check
            self.assertEqual(browser_start.main(),0)
            verify.assert_called_once_with(['--api-only','--backend','browser'])
            scanner.assert_called_once_with(['--loop'])
            close.assert_called_once()

    def test_failed_preflight_cannot_start_scanner(self):
        with patch('browser_start.os.chdir'),patch('browser_start.load_env'),patch.dict(os.environ,{}),patch('browser_start.close_browser') as close,patch('browser_start.verify',return_value=1),patch('browser_start.scanner') as scanner,redirect_stdout(io.StringIO()):
            self.assertEqual(browser_start.main(),1)
            scanner.assert_not_called()
            close.assert_called_once()
