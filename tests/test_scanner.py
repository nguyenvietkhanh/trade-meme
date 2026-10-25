import tempfile
import unittest
import time
from decimal import Decimal as D
from pathlib import Path
from unittest.mock import patch
from polymarket_arb.config import Config
from polymarket_arb.pricing import Fees, evaluate, levels
from polymarket_arb.risk import admission
from polymarket_arb.market_data import Market, DataError, Requests, fee_parameters, market_from_gamma, check_book, MarketData
from polymarket_arb.storage import Storage
from polymarket_arb.main import scan
from polymarket_arb.executor import ReadOnlyExecutor


def asks(*pairs):
    return [{"price": str(p), "size": str(q)} for p, q in pairs]


class PricingTests(unittest.TestCase):
    def run_price(self, yes, no, fee=Fees(D(0), 1), **kw):
        return evaluate(yes, no, fee, fee, budget=kw.get("budget", 100),
                        min_edge_pct=kw.get("edge", 0), slippage_bps=kw.get("slip", 0))

    def test_fee_matches_pinned_official_sdk(self):
        from py_clob_client_v2.fees import adjust_buy_amount_for_fees
        for p in (D("0.1"), D("0.5"), D("0.9")):
            for exponent in (1, 2):
                # Function's return at exact balance subtracts platform fee; no builder fee.
                amount = 10
                adjusted = adjust_buy_amount_for_fees(amount, float(p), amount, .25, exponent, 0)
                ours = (D(amount) / p) * Fees(D(".25"), exponent).per_share(p)
                self.assertAlmostEqual(float(ours), amount - adjusted, places=10)

    def test_best_ask_is_not_entire_depth(self):
        e = self.run_price(asks((.4, 2), (.7, 100)), asks((.5, 100)))
        self.assertEqual(e.max_size, 2)
        self.assertEqual(e.expected_profit, D(".2"))
        self.assertEqual(e.depth_yes, 102)

    def test_fee_erases_false_edge(self):
        self.assertIsNone(self.run_price(asks((.49, 100)), asks((.49, 100)), Fees(D(".25"), 1)))

    def test_depth_vwap_and_asymmetric_quantities(self):
        e = self.run_price(asks((.4, 3), (.45, 7)), asks((.5, 6), (.51, 8)))
        self.assertEqual(e.max_size, 10)
        self.assertEqual(e.vwap_yes, D(".435"))
        self.assertEqual(e.vwap_no, D(".504"))

    def test_budget_and_slippage(self):
        e = self.run_price(asks((.4, 100)), asks((.5, 100)), budget=3, slip=25)
        self.assertLessEqual(e.cost, 3)
        self.assertGreater(e.slippage, 0)
        self.assertLess(e.max_size, D(3) / D(".9"))

    def test_fee_rounding_does_not_invent_profit(self):
        self.assertIsNone(self.run_price(asks((.49999999, .000001)), asks((.49999999, .000001)), Fees(D(".00000001"), 1)))

    def test_invalid_or_nonfinite_books(self):
        for price in ("NaN", "Infinity", "-1", "0", "1"):
            with self.assertRaises(ValueError): levels(asks((price, 1)))
        with self.assertRaises(ValueError): levels(asks((.4, -1)))
        self.assertIsNone(self.run_price([], asks((.4, 1))))

    def test_unsorted_and_duplicate_prices(self):
        self.assertEqual(levels(asks((.5, 2), (.4, 3), (.4, 7))), [(D(".4"), D(10)), (D(".5"), D(2))])


class SafetyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.config = Config(stop_file=Path(self.tmp.name) / "STOP")
        self.market = Market("1", "0x" + "a" * 64, "test", "111", "222")

    def test_no_live_even_when_env_enabled(self):
        with patch.dict("os.environ", {"DRY_RUN": "false"}):
            with self.assertRaises(ValueError): Config.from_env()
        with self.assertRaises(RuntimeError): ReadOnlyExecutor().submit()

    def test_invalid_config(self):
        for kwargs in ({"interval": float("nan")}, {"slippage_bps": -1}, {"max_markets": 0}, {"max_usd_per_trade": 0}):
            with self.assertRaises(ValueError): Config(**kwargs)

    def risk(self, **changes):
        args = dict(cost=25, open_exposure=75, realized_pnl=0, balance=25)
        args.update(changes)
        return admission(self.config, **args)

    def test_risk_boundaries(self):
        self.assertTrue(self.risk()[0])
        for kwargs, reason in [({"cost": 26}, "TRADE_LIMIT"), ({"open_exposure": 76}, "EXPOSURE_LIMIT"),
                               ({"realized_pnl": -10}, "DAILY_LOSS_LIMIT"), ({"balance": 24}, "INSUFFICIENT_BALANCE")]:
            self.assertEqual(self.risk(**kwargs), (False, reason))
        self.config.stop_file.touch()
        self.assertEqual(self.risk(), (False, "STOP_FILE"))

    def test_fee_requires_explicit_parameters_and_token_binding(self):
        info = {"t": [{"t": "111", "o": "Yes"}, {"t": "222", "o": "No"}], "fd": {"r": "0", "e": 1}}
        self.assertEqual(fee_parameters(info, self.market).rate, 0)
        for fd in ({}, {"r": "0"}, {"r": "NaN", "e": 1}):
            with self.assertRaises(ValueError): fee_parameters(dict(info, fd=fd), self.market)
        with self.assertRaises(ValueError): fee_parameters(dict(info, nr=True), self.market)
        with self.assertRaises(ValueError): fee_parameters(dict(info, t=[{"t": "333", "o": "Yes"}]), self.market)

    def test_gamma_outcome_order_and_filters(self):
        raw = dict(active=True, closed=False, acceptingOrders=True, enableOrderBook=True, negRisk=False,
                   outcomes='["No", "Yes"]', clobTokenIds='["222", "111"]',
                   conditionId=self.market.condition, id="1", question="test", liquidityNum=20000, volumeNum=20000)
        self.assertEqual(market_from_gamma(raw, self.config).yes, "111")
        for changes in ({"closed": True}, {"negRisk": True}, {"outcomes": '["Up", "Down"]'}, {"liquidityNum": 1}):
            self.assertIsNone(market_from_gamma(dict(raw, **changes), self.config))

    def test_book_age_id_and_future(self):
        book = dict(asset_id="111", market=self.market.condition, timestamp="100000", asks=asks((.4, 5)), min_order_size="1")
        self.assertEqual(check_book(book, self.market, "111", 105, 10)[0], 100)
        for now in (111, 98):
            with self.assertRaises(DataError): check_book(book, self.market, "111", now, 10)
        with self.assertRaises(DataError): check_book(book, self.market, "222", 105, 10)

    def test_official_endpoints_only_and_stop(self):
        req = Requests(self.config, sleep=lambda _: None)
        with self.assertRaises(ValueError): req.get("https://example.com", "/markets")
        self.config.stop_file.touch()
        with self.assertRaises(InterruptedError): req.call(lambda: {})

    def test_read_only_scan_and_durable_log(self):
        class Fixture:
            def markets(inner): return [self.market]
            def snapshot(inner, market):
                return {"asks": asks((.4, 50))}, {"asks": asks((.5, 50))}, Fees(D(0), 1), D(1), 100, 100
        store = Storage(Path(self.tmp.name))
        try:
            from contextlib import redirect_stdout
            import io
            with redirect_stdout(io.StringIO()): result = scan(self.config, Fixture(), store)
            self.assertEqual(len(result), 1)
            status = store.db.execute("SELECT status FROM scans").fetchone()[0]
            self.assertEqual(status, "ESTIMATE_UNVERIFIED_DOCS")
            self.assertIn("expected_profit", store.csv_path.read_text())
        finally: store.close()

    def test_nonretryable_403(self):
        import urllib.error
        from polymarket_arb.market_data import APIError
        req = Requests(self.config, sleep=lambda _: None)
        calls = []
        def failure():
            calls.append(1)
            raise urllib.error.HTTPError("redacted", 403, "forbidden", {}, None)
        with self.assertRaises(APIError): req.call(failure)
        self.assertEqual(len(calls), 1)

    def test_unprofitable_diagnostic(self):
        e = evaluate(asks((.6, 20)), asks((.5, 20)), Fees(D(0), 1), Fees(D(0), 1),
                     budget=20, min_edge_pct=0, slippage_bps=0, profitable_only=False)
        self.assertEqual(e.max_size, 0)
        self.assertGreater(e.evaluated_size, 0)
        self.assertLess(e.edge_pct, 0)

    def test_retry_is_bounded(self):
        import urllib.error
        req = Requests(self.config, sleep=lambda _: None)
        count = 0
        def failure():
            nonlocal count
            count += 1
            raise urllib.error.HTTPError("redacted", 429, "rate limit", {}, None)
        from polymarket_arb.market_data import APIError
        with self.assertRaises(APIError): req.call(failure)
        self.assertEqual(count, self.config.retries + 1)


if __name__ == "__main__": unittest.main()
