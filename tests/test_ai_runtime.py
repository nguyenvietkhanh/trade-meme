import base64
import io
import json
import os
import tempfile
import unittest
from dataclasses import dataclass
from decimal import Decimal as D
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock,patch
import httpx
from eth_account import Account as EVMAccount
from polymarket import PRODUCTION
from polymarket._internal.environment import get_environment_config
from polymarket._internal.wallet import derive_proxy_wallet_address,derive_beacon_deposit_wallet_address
from polymarket.models.clob.orders import SignedOrder
from polymarket_arb.ai_settings import AISettings,state_directory
from polymarket_arb.ai_journal import Journal
from polymarket_arb.ai_model import validate_decision,decide
from polymarket_arb.ai_engine import buy_plan,Executor
from polymarket_arb.secure_bridge import SDKBridge,GuardError,connect_sdk
from polymarket_arb.market_data import Market
from polymarket_arb.pricing import Fees

KEY='0x'+'01'*32  # offline fixture only; no transport contacts real services.
CFG=get_environment_config(PRODUCTION)
OWNER=EVMAccount.from_key(KEY).address
WALLET=derive_proxy_wallet_address(OWNER,CFG.wallet_derivation)
ASSET='32338220190071351435772801779725302244575775216413325951443816017994629993401'
NO='25659310674993675562345759665114759892400026242514633218387667107987341231962'
M=Market('559651','0x'+'ab'*32,'fixture',ASSET,NO)
BOOK={'asks':[{'price':'.4','size':'100'}],'bids':[{'price':'.39','size':'100'}], 'min_order_size':'5'}
DECISION={'action':'BUY_YES','market_id':M.id,'all_in_usd':D(3),'probability_yes':D('.8'),'confidence':D('.9'),'reason':'offline fixture'}


class FakeSDKWire(SDKBridge):
    def __init__(self):super().__init__();self.calls=[]
    def handle_request(self,request):
        self.policy(request.method,str(request.url),request.content,consume=True)
        self.calls.append((request.method,request.url.path))
        if request.url.path in ('/auth/derive-api-key','/auth/api-key'):
            payload={'apiKey':'00000000-0000-4000-8000-000000000001','secret':base64.urlsafe_b64encode(b'fixture').decode(),'passphrase':'fixture'}
        elif request.url.path=='/deployed':payload={'deployed':True}
        elif request.url.host=='polygon.drpc.org':
            raw=json.loads(request.content);payload={'id':raw['id'],'jsonrpc':'2.0','result':'0x89'}
        else:raise AssertionError('Unexpected SDK bootstrap request: '+request.url.path)
        return httpx.Response(200,json=payload,request=request)


class SDKIntegrationTests(unittest.TestCase):
    def test_sdk_detects_owner_proxy_wallet_without_writes(self):
        bridge=FakeSDKWire()
        client=connect_sdk(KEY,WALLET,bridge)
        try:
            self.assertEqual(client.wallet.lower(),WALLET.lower())
            self.assertEqual(client.wallet_type,'POLY_PROXY')
            self.assertFalse(any(method=='POST' and path not in ('/','/auth/api-key') for method,path in bridge.calls))
            self.assertTrue(any(path=='/deployed' for _,path in bridge.calls))
        finally:client.close();bridge.shutdown()

    def test_sdk_detects_deposit_wallet_owner(self):
        wallet=derive_beacon_deposit_wallet_address(OWNER,CFG.wallet_derivation)
        bridge=FakeSDKWire();client=connect_sdk(KEY,wallet,bridge)
        try:self.assertEqual(client.wallet_type,'DEPOSIT_WALLET')
        finally:client.close();bridge.shutdown()

    def test_sdk_session_fallback_is_not_silently_trusted(self):
        bridge=FakeSDKWire()
        try:
            with self.assertRaises(GuardError):connect_sdk(KEY,'0x'+'12'*20,bridge)
        finally:bridge.shutdown()

    def test_bridge_blocks_financial_rpc_and_relayer(self):
        b=SDKBridge()
        for url,body in [('https://polygon.drpc.org/',b'{"method":"eth_sendRawTransaction"}'),
                         ('https://relayer-v2.polymarket.com/submit',b'{}'),
                         ('https://clob.polymarket.com/order',b'{}')]:
            with self.assertRaises(GuardError):b.policy('POST',url,body,consume=True)

    def test_one_exact_order_permit_cannot_replay_or_change_payload(self):
        b=SDKBridge();b.authorize_order(b'{"fixture":1}')
        with self.assertRaises(GuardError):b.policy('POST','https://clob.polymarket.com/order',b'{"fixture":2}',consume=True)
        b.policy('POST','https://clob.polymarket.com/order',b'{"fixture":1}',consume=True)
        with self.assertRaises(GuardError):b.policy('POST','https://clob.polymarket.com/order',b'{"fixture":1}',consume=True)


class AIBudgetTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.directory=Path(self.tmp.name)
        self.j=Journal(self.directory,WALLET);self.addCleanup(self.j.close)
        self.settings=AISettings(WALLET,KEY,model_key='fixture-api-key')

    def test_state_has_one_lock_per_wallet(self):
        with self.assertRaises(RuntimeError):Journal(self.directory,WALLET)

    def test_budget_uses_actual_cash_not_fixed_seven(self):
        with self.assertRaises(GuardError):buy_plan(self.settings,DECISION,M,BOOK,Fees(D(0),1),2_000_000,D(7),D(7))
        plan=buy_plan(self.settings,DECISION,M,BOOK,Fees(D('.07'),1),6_570_000,D(7),D(7))
        self.assertLess(plan['notional'],D(3))
        self.assertLessEqual(plan['notional']*D('1.07')+D('.00002'),D(3))

    def test_journal_reserves_before_post_and_survives_reopen(self):
        identifier=self.j.prepare(ASSET,'BUY',D(6),{'signature':'fixture'},6570000,0,D(7))
        self.j.transition(identifier,'SENDING')
        self.assertEqual(self.j.remaining(D(7)),D(1))
        self.j.close();self._cleanups.pop()
        reopened=Journal(self.directory,WALLET);self.addCleanup(reopened.close)
        self.assertTrue(reopened.pending())
        with self.assertRaises(RuntimeError):reopened.prepare(NO,'BUY',D(2),{},6570000,0,D(7))

    def test_unknown_keeps_accepted_response_and_reservation(self):
        identifier=self.j.prepare(ASSET,'BUY',D(3),{},6570000,0,D(7))
        self.j.transition(identifier,'ACCEPTED',{'order_id':'fixture-order'})
        self.j.transition(identifier,'UNKNOWN')
        response=self.j.db.execute('SELECT response FROM orders WHERE id=?',(identifier,)).fetchone()[0]
        self.assertEqual(json.loads(response)['order_id'],'fixture-order')
        self.assertEqual(self.j.remaining(D(7)),D(4))

    def test_accepted_is_not_a_confirmed_position(self):
        identifier=self.j.prepare(ASSET,'BUY',D(3),{},6570000,0,D(7))
        self.j.transition(identifier,'ACCEPTED',{'order_id':'fixture-order'})
        self.assertEqual(self.j.positions(),[])
        self.assertEqual(self.j.daily_pnl(),0)

    def test_model_validation_rejects_unsupported_research_or_assets(self):
        raw={'action':'BUY_YES','market_id':M.id,'all_in_usd':3,'probability_yes':.8,'confidence':.9,'uses_external_facts':False,'reason':'fixture'}
        self.assertEqual(validate_decision(raw,[{'market_id':M.id}],[])['market_id'],M.id)
        for change in ({'uses_external_facts':True},{'market_id':'foreign'},{'probability_yes':float('nan')}):
            with self.assertRaises(ValueError):validate_decision(dict(raw,**change),[{'market_id':M.id}],[])

    def test_api_payload_contains_no_wallet_or_signer_secret(self):
        response=Mock(status_code=200)
        response.json.return_value={'choices':[{'message':{'content':'{"action":"HOLD","reason":"no evidence"}'}}]}
        client=Mock();client.post.return_value=response
        with patch('polymarket_arb.ai_model.httpx.Client') as constructor:
            constructor.return_value.__enter__.return_value=client
            decide(self.settings,[{'market_id':M.id}],[],D('6.57'),D(7))
        payload=json.dumps(client.post.call_args.kwargs['json'])
        for secret in (KEY,WALLET,self.settings.model_key):self.assertNotIn(secret,payload)

    def test_model_call_limit_persists(self):
        self.j.take_model_call(1)
        with self.assertRaises(RuntimeError):self.j.take_model_call(1)

    def test_config_enforces_explicit_default_dryrun_and_seven_cap(self):
        base={'POLYMARKET_WALLET_ADDRESS':WALLET,'SIGNER_PRIVATE_KEY':KEY}
        with patch.dict(os.environ,base,clear=True):self.assertTrue(AISettings.from_env().dry_run)
        with patch.dict(os.environ,dict(base,MAX_TEST_BUDGET='8'),clear=True):
            with self.assertRaises(ValueError):AISettings.from_env()
        self.assertNotIn(KEY,repr(self.settings))
        self.assertNotIn(self.settings.model_key,repr(self.settings))

@dataclass
class FakeContext:
    order_metadata: object = None
    environment_config: object = CFG


class ExecutorTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.j=Journal(Path(self.tmp.name),WALLET);self.addCleanup(self.j.close)
        self.settings=AISettings(WALLET,KEY,dry_run=False)
        self.client=Mock()
        self.client.wallet_type='POLY_PROXY';self.client.signer=OWNER
        self.client._ctx=FakeContext()
        self.client.credentials=SimpleNamespace(key='fixture-api-key')
        self.bridge=Mock()
        self.executor=Executor(self.settings,self.client,self.bridge,self.j)
        cash=SimpleNamespace(balance=6570000,allowances={CFG.standard_exchange:10000000})
        self.executor.account.snapshot=Mock(return_value=cash)
        self.executor.account.balance=Mock(side_effect=[SimpleNamespace(balance=0),SimpleNamespace(balance=3582000),SimpleNamespace(balance=7470000)])
        self.signed=SignedOrder(builder='0x'+'0'*64,expiration=0,maker=WALLET,maker_amount=2988000,
            metadata='0x'+'0'*64,order_type='FOK',salt=1,side='BUY',signature='0x'+'00'*65,
            signature_type=1,signer=OWNER,taker_amount=7470000,timestamp=1,token_id=ASSET)
        self.client.create_market_order.return_value=self.signed
        response=SimpleNamespace(ok=True,order_id='0x'+'12'*32,trade_ids=('fixture-trade',),
            model_dump=lambda **_: {'ok':True,'order_id':'0x'+'12'*32,'trade_ids':['fixture-trade']})
        self.client.post_order.return_value=response
        self.client.list_account_trades.return_value.first_page.return_value.items=[SimpleNamespace(status='CONFIRMED',taker_order_id=response.order_id)]

    def test_dryrun_never_signs_or_posts(self):
        result=self.executor.execute(DECISION,M,BOOK,BOOK,Fees(D(0),1),live=False)
        self.assertEqual(result['status'],'DRY_RUN_NO_ORDER_SIGNED_OR_SENT')
        self.client.create_market_order.assert_not_called()
        self.client.post_order.assert_not_called()
        self.assertFalse(self.j.pending())

    def test_durable_sending_state_precedes_exactly_one_post(self):
        response=self.client.post_order.return_value
        def send(signed):
            state=self.j.db.execute('SELECT state,signed FROM orders').fetchone()
            self.assertEqual(state[0],'SENDING')
            self.assertEqual(json.loads(state[1])['maker_amount'],2988000)
            self.bridge.authorize_order.assert_called_once()
            return response
        self.client.post_order.side_effect=send
        result=self.executor.execute(DECISION,M,BOOK,BOOK,Fees(D(0),1),live=True)
        self.assertEqual(result['status'],'CONFIRMED')
        self.client.post_order.assert_called_once()
        self.assertEqual(self.j.remaining(D(7)),D('4.012'))
        self.assertEqual(self.j.positions()[0]['qty'],7470000)

    def test_post_timeout_is_unknown_never_retried(self):
        self.client.post_order.side_effect=TimeoutError('fixture only')
        with self.assertRaises(TimeoutError):self.executor.execute(DECISION,M,BOOK,BOOK,Fees(D(0),1),live=True)
        self.assertTrue(self.j.pending())
        self.assertEqual(self.j.remaining(D(7)),D(4))
        with self.assertRaises(GuardError):self.executor.execute(DECISION,M,BOOK,BOOK,Fees(D(0),1),live=True)
        self.client.post_order.assert_called_once()

    def test_accepted_without_trade_settlement_is_not_reported_as_fill(self):
        response=self.client.post_order.return_value
        response.trade_ids=()
        with self.assertRaises(GuardError):self.executor.execute(DECISION,M,BOOK,BOOK,Fees(D(0),1),live=True)
        self.assertEqual(self.j.positions(),[])
        self.assertTrue(self.j.pending())
        saved=json.loads(self.j.db.execute('SELECT response FROM orders').fetchone()[0])
        self.assertIn('order_id',saved)

    def test_no_post_if_signed_payload_exceeds_cap(self):
        from dataclasses import replace
        self.client.create_market_order.return_value=replace(self.signed,maker_amount=7000000)
        with self.assertRaises(GuardError):self.executor.execute(DECISION,M,BOOK,BOOK,Fees(D(0),1),live=True)
        self.client.post_order.assert_not_called()
        self.assertFalse(self.j.pending())

    def test_sell_confirmed_position_records_realized_loss_and_does_not_reset_buy_cap(self):
        from dataclasses import replace
        identifier=self.j.prepare(ASSET,'BUY',D(3),{},6570000,0,D(7))
        self.j.confirmed(identifier,ASSET,'BUY',D('-2.988'),7470000,M,'YES',0)
        sell=replace(self.signed,side='SELL',maker_amount=7470000,taker_amount=2913300)
        self.client.create_market_order.return_value=sell
        self.executor.account.snapshot.return_value=SimpleNamespace(balance=3582000,allowances={CFG.standard_exchange:10000000})
        self.executor.account.balance=Mock(side_effect=[SimpleNamespace(balance=7470000),
            SimpleNamespace(balance=7470000,allowances={CFG.standard_exchange:2**256-1}),
            SimpleNamespace(balance=6495300),SimpleNamespace(balance=0)])
        decision={'action':'SELL','position_asset':ASSET,'probability_yes':D('.5'),'confidence':D('.5')}
        result=self.executor.execute(decision,M,BOOK,BOOK,Fees(D(0),1),live=True)
        self.assertEqual(result['status'],'CONFIRMED')
        self.assertEqual(self.j.positions(),[])
        self.assertEqual(self.j.daily_pnl(),D('-.0747'))
        self.assertEqual(self.j.remaining(D(7)),D('4.012'))
