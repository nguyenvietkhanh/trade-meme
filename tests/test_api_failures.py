import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import Mock
from polymarket_arb.browser_data import BrowserReadError
from polymarket_arb.config import Config
from polymarket_arb.market_data import Requests, APIError, Market, DataError
from polymarket_arb.main import scan
from polymarket_arb.storage import Storage


class APIFailureTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config=Config(retries=2,stop_file=Path(self.temp.name)/'STOP', output_dir=Path(self.temp.name))

    def test_transient_chrome_reset_retries_and_recovers(self):
        fn=Mock(side_effect=[BrowserReadError('BROWSER_ERR_CONNECTION_RESET'), {'ok':True}])
        requests=Requests(self.config,sleep=lambda _:None)
        self.assertEqual(requests.call(fn),{'ok':True})
        self.assertEqual(fn.call_count,2)

    def test_retry_exhaustion_keeps_safe_code_and_attempt_count(self):
        fn=Mock(side_effect=BrowserReadError('BROWSER_ERR_CONNECTION_RESET'))
        with self.assertRaises(APIError) as caught:
            Requests(self.config,sleep=lambda _:None).call(fn)
        self.assertEqual(fn.call_count,3)
        self.assertEqual(caught.exception.safe_code,'BROWSER_ERR_CONNECTION_RESET')
        self.assertEqual(caught.exception.attempts,3)

    def test_challenge_and_start_failure_are_not_retried(self):
        for code in ('BROWSER_NON_JSON_OR_CHALLENGE','CHROME_START_FAILED'):
            fn=Mock(side_effect=BrowserReadError(code))
            with self.assertRaises(APIError) as caught:
                Requests(self.config,sleep=lambda _:None).call(fn)
            self.assertEqual(fn.call_count,1)
            self.assertEqual(caught.exception.safe_code,code)

    def test_three_actual_consecutive_errors_print_cause_then_stop(self):
        market=Market('1','0x'+'ab'*32,'fixture','111','222')
        error=APIError('fixture',code='HTTP_429',http_status=429,attempts=3)
        error.stage='book_yes'
        data=Mock()
        data.markets.return_value=[market]*3
        data.snapshot.side_effect=error
        store=Storage(self.config.output_dir)
        try:
            out=io.StringIO()
            with redirect_stdout(out), self.assertRaises(APIError): scan(self.config,data,store)
            self.assertIn('HTTP_429 stage=book_yes attempts=3',out.getvalue())
            self.assertIn('consecutive=3/3',out.getvalue())
            self.assertEqual(store.db.execute('SELECT count(*) FROM scans').fetchone()[0],3)
        finally:store.close()

    def test_data_skip_breaks_consecutive_api_failure_sequence(self):
        market=Market('1','0x'+'ab'*32,'fixture','111','222')
        data=Mock()
        data.markets.return_value=[market]*4
        data.snapshot.side_effect=[APIError('fixture'),DataError('FEE_DATA_UNKNOWN'),APIError('fixture'),APIError('fixture')]
        store=Storage(self.config.output_dir)
        try:
            with redirect_stdout(io.StringIO()): scan(self.config,data,store)
            self.assertEqual(store.db.execute('SELECT count(*) FROM scans').fetchone()[0],4)
        finally:store.close()

    def test_launcher_does_not_label_every_failure_chrome_start(self):
        text=(Path(__file__).parent.parent/'start_browser.bat').read_text()
        self.assertNotIn('echo CHROME_START_FAILED',text)
