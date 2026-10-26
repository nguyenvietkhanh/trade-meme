"""Offline failures: fixed diagnostics, read-only retries and no write replay."""
import contextlib
import io
import json
import unittest
from unittest.mock import Mock,patch
import httpx
from polymarket_arb.secure_bridge import SDKBridge,failure_code


class SDKDiagnosticsTests(unittest.TestCase):
    def bridge(self,results):
        bridge=SDKBridge()
        page=Mock();page.evaluate.side_effect=results
        bridge._page=Mock(return_value=page)
        return bridge,page

    def test_read_recovers_without_logging_credentials_or_query(self):
        bridge,page=self.bridge([RuntimeError('net::ERR_CONNECTION_RESET private_fixture'),
                                 {'status':200,'text':'{}','retry':''}])
        stream=io.StringIO()
        with contextlib.redirect_stdout(stream),patch('polymarket_arb.secure_bridge.time.sleep'):
            response=bridge.handle_request(httpx.Request('GET','https://clob.polymarket.com/auth/derive-api-key?hidden=private_fixture',
                headers={'POLY_SIGNATURE':'private_fixture'}))
        self.assertEqual(response.status_code,200)
        self.assertEqual(page.evaluate.call_count,2)
        self.assertIsNone(bridge.last_error)
        self.assertIn('AUTH_DERIVE',stream.getvalue())
        self.assertNotIn('private_fixture',stream.getvalue())
        self.assertNotIn('hidden=',stream.getvalue())

    def test_auth_create_network_failure_is_not_replayed(self):
        bridge,page=self.bridge([RuntimeError('net::ERR_CONNECTION_RESET')])
        with contextlib.redirect_stdout(io.StringIO()),self.assertRaises(httpx.TransportError):
            bridge.handle_request(httpx.Request('POST','https://clob.polymarket.com/auth/api-key'))
        self.assertEqual(page.evaluate.call_count,1)
        self.assertEqual(bridge.last_error,'SDK_AUTH_CREATE_CONNECTION_RESET')

    def test_order_uncertainty_does_not_replay_or_renew_permit(self):
        bridge,page=self.bridge([RuntimeError('net::ERR_CONNECTION_RESET')])
        body=b'{"fixture":"not an order"}';bridge.authorize_order(body)
        with contextlib.redirect_stdout(io.StringIO()),self.assertRaises(httpx.TransportError):
            bridge.handle_request(httpx.Request('POST','https://clob.polymarket.com/order',content=body))
        self.assertEqual(page.evaluate.call_count,1)
        self.assertIsNone(bridge.permit)
        self.assertIsNone(bridge.routing_permit)
        self.assertEqual(bridge.last_error,'SDK_ORDER_SUBMIT_CONNECTION_RESET')

    def test_readonly_rpc_retries_are_bounded(self):
        bridge,page=self.bridge([RuntimeError('net::ERR_TIMED_OUT')]*3)
        stream=io.StringIO()
        with contextlib.redirect_stdout(stream),patch('polymarket_arb.secure_bridge.time.sleep'),self.assertRaises(httpx.TransportError):
            bridge.handle_request(httpx.Request('POST','https://polygon.drpc.org/',
                content=json.dumps({'method':'eth_chainId','params':[]}).encode()))
        self.assertEqual(page.evaluate.call_count,3)
        self.assertIn('POLYGON_CHAIN_ID',stream.getvalue())

    def test_access_denial_response_is_not_retried_or_logged(self):
        bridge,page=self.bridge([{'status':403,'text':'private_fixture challenge','retry':''}])
        stream=io.StringIO()
        with contextlib.redirect_stdout(stream):
            response=bridge.handle_request(httpx.Request('GET','https://clob.polymarket.com/time'))
        self.assertEqual(response.status_code,403)
        self.assertEqual(page.evaluate.call_count,1)
        self.assertEqual(bridge.last_error,'SDK_SERVER_TIME_HTTP_403')
        self.assertNotIn('private_fixture',stream.getvalue())

    def test_tls_failure_is_not_retried(self):
        bridge,page=self.bridge([RuntimeError('net::ERR_CERT_AUTHORITY_INVALID')])
        with contextlib.redirect_stdout(io.StringIO()),self.assertRaises(httpx.TransportError):
            bridge.handle_request(httpx.Request('GET','https://clob.polymarket.com/time'))
        self.assertEqual(page.evaluate.call_count,1)
        self.assertEqual(failure_code('unrecognized secret fixture'),'FETCH_FAILED')
