"""Refresh ACK is not a balance; all balances still require a validated SDK read."""
import contextlib
import io
import unittest
from types import SimpleNamespace
from unittest.mock import Mock
import httpx
from polymarket.errors import UnexpectedResponseError
from polymarket_arb.ai_engine import Account
from polymarket_arb.secure_bridge import SDKBridge,GuardError


class RefreshTests(unittest.TestCase):
    def test_empty_or_ok_or_json_refresh_requires_separate_balance_read(self):
        for ack in (b'',b'OK',b'null',b'{}',b'{"balance":"6570000","allowances":{}}'):
            with self.subTest(ack=ack):
                wire=Mock();wire.get_bytes.return_value=ack
                balance=SimpleNamespace(balance=6570000,allowances={})
                client=Mock(wallet_type='POLY_PROXY');client._ctx.secure_clob=wire
                client.get_balance_allowance.return_value=balance
                self.assertIs(Account(client).balance(),balance)
                wire.get_bytes.assert_called_once_with('/balance-allowance/update',params={'asset_type':'COLLATERAL','signature_type':1})
                wire.get_json.assert_not_called()
                client.get_balance_allowance.assert_called_once_with(asset_type='COLLATERAL',asset_id=None)

    def test_refresh_success_cannot_hide_invalid_balance(self):
        client=Mock(wallet_type='POLY_PROXY');client._ctx.secure_clob.get_bytes.return_value=b''
        client.get_balance_allowance.side_effect=UnexpectedResponseError('fixture invalid balance')
        with self.assertRaises(UnexpectedResponseError):Account(client).balance()

    def test_error_refresh_ack_does_not_become_cash(self):
        client=Mock(wallet_type='POLY_PROXY')
        client._ctx.secure_clob.get_bytes.return_value=b'{"error":"fixture"}'
        with self.assertRaisesRegex(GuardError,'BALANCE_REFRESH_REPORTED_ERROR'):Account(client).balance()
        client.get_balance_allowance.assert_not_called()

    def test_only_refresh_endpoint_accepts_empty_or_plain_ok(self):
        for body in ('','OK'):
            for path in ('/balance-allowance/update','/balance-allowance','/auth/derive-api-key'):
                with self.subTest(body=body,path=path):
                    bridge=SDKBridge();page=Mock()
                    page.evaluate.return_value={'status':200,'text':body,'retry':'','content_type':'text/plain'}
                    bridge._page=Mock(return_value=page)
                    with contextlib.redirect_stdout(io.StringIO()):
                        if path.endswith('/update'):
                            response=bridge.handle_request(httpx.Request('GET','https://clob.polymarket.com'+path))
                            self.assertEqual(response.content,body.encode())
                        else:
                            with self.assertRaises(GuardError):
                                bridge.handle_request(httpx.Request('GET','https://clob.polymarket.com'+path))

    def test_refresh_html_remains_blocked_without_body_logging(self):
        bridge=SDKBridge();page=Mock()
        page.evaluate.return_value={'status':200,'text':'<html>private_fixture</html>','retry':'','content_type':'text/html'}
        bridge._page=Mock(return_value=page);output=io.StringIO()
        with contextlib.redirect_stdout(output),self.assertRaisesRegex(GuardError,'SDK_BALANCE_REFRESH_NON_JSON_RESPONSE'):
            bridge.handle_request(httpx.Request('GET','https://clob.polymarket.com/balance-allowance/update'))
        self.assertNotIn('private_fixture',output.getvalue())
