import json
import time
from dataclasses import asdict, replace
from decimal import Decimal, ROUND_DOWN
from .config import number
from .market_data import Market, fee_parameters
from .pricing import levels
from .secure_bridge import GuardError

D=Decimal
UNIT=D(1000000)
SIGNATURE={'EOA':0,'POLY_PROXY':1,'GNOSIS_SAFE':2,'DEPOSIT_WALLET':3}


def walk_asks(book,notional):
    remaining=notional
    total=D(0);worst=None
    for price,qty in levels(book['asks']):
        spend=min(remaining,price*qty)
        total+=spend/price;remaining-=spend;worst=price
        if remaining<=D('.000001'):break
    if remaining>D('.000001') or worst is None:raise GuardError('INSUFFICIENT_ORDER_BOOK_DEPTH')
    if total<number(book['min_order_size']):raise GuardError('BUDGET_BELOW_MARKET_MINIMUM_SIZE')
    return worst,total


class Account:
    def __init__(self,client):self.client=client

    def balance(self,asset=None,version='v1'):
        kind='COLLATERAL' if asset is None else 'CONDITIONAL-V2' if version=='v2' else 'CONDITIONAL'
        params={'asset_type':kind,'signature_type':SIGNATURE[self.client.wallet_type]}
        if asset:params['token_id']=asset
        # Refresh is an acknowledgement, not the authoritative balance payload.
        # Some deployments return an empty 2xx body or plain OK here.
        ack=self.client._ctx.secure_clob.get_bytes('/balance-allowance/update',params=params).strip()
        if ack and ack!=b'OK':
            try:payload=json.loads(ack)
            except (ValueError,TypeError):raise GuardError('BALANCE_REFRESH_INVALID_ACKNOWLEDGEMENT') from None
            if isinstance(payload,dict) and payload.get('error'):
                raise GuardError('BALANCE_REFRESH_REPORTED_ERROR')
        value=self.client.get_balance_allowance(asset_type=kind,asset_id=asset)
        if value.balance<0 or any(x<0 for x in value.allowances.values()):raise GuardError('INVALID_ACCOUNT_BALANCE')
        return value

    def snapshot(self):
        cash=self.balance()
        orders=self.client.list_open_orders().iter_items()
        has_orders=next(orders,None) is not None
        if has_orders:raise GuardError('EXISTING_OPEN_ORDERS_REQUIRE_REVIEW')
        return cash

    def allowance(self,balance,market):
        config=self.client._ctx.environment_config
        exchange=config.exchange_v3 if market.version=='v2' else config.standard_exchange
        return D(next((v for k,v in balance.allowances.items() if k.lower()==exchange.lower()),0))/UNIT


def buy_plan(settings,decision,market,book,fees,cash,remaining,allowance):
    amount=number(decision['all_in_usd'])
    if allowance<=0:raise GuardError('MISSING_PUSD_EXCHANGE_APPROVAL_NO_AUTO_APPROVAL')
    available=min(D(cash)/UNIT,remaining,settings.max_trade,allowance)
    if amount>available or amount<=0:raise GuardError('AI_SPEND_EXCEEDS_AVAILABLE_OR_TEST_BUDGET')
    if fees.rate and fees.exponent<1:raise GuardError('UNSUPPORTED_LIVE_FEE_EXPONENT')
    # For exponent >=1, collateral fee/notional <= rate for every possible fill price.
    # Reserve rounding per side, do not assume a top-of-book fee equals every fill's fee.
    notional=((amount-D('.00002'))/(1+fees.rate)).quantize(D('.01'),rounding=ROUND_DOWN)
    if notional<=0:raise GuardError('BUDGET_TOO_SMALL_AFTER_FEES')
    worst,shares=walk_asks(book,notional)
    p=decision['probability_yes'] if decision['action']=='BUY_YES' else 1-decision['probability_yes']
    if decision['confidence']<settings.confidence:raise GuardError('AI_CONFIDENCE_BELOW_CONFIGURED_LIMIT')
    edge=p-worst-fees.per_share(worst)
    if edge*100<settings.min_edge:raise GuardError('FORECAST_EDGE_BELOW_LIMIT')
    return {'asset':market.yes if decision['action']=='BUY_YES' else market.no,
            'notional':notional,'cap':amount,'max_price':worst,'edge_pct':edge*100,'shares_estimate':shares}


class Executor:
    def __init__(self,settings,client,bridge,journal):
        self.settings=settings;self.client=client;self.bridge=bridge;self.journal=journal
        self.account=Account(client)

    def execute(self,decision,market,yes,no,fees,*,live=False):
        if self.journal.pending():raise GuardError('UNRESOLVED_ORDER_REQUIRES_RECONCILIATION')
        if decision['action']=='HOLD':return {'status':'HOLD'}
        cash=self.account.snapshot()
        before_cash=cash.balance
        remaining=self.journal.remaining(self.settings.test_budget)
        if decision['action'].startswith('BUY_'):
            if len(self.journal.positions())>=self.settings.max_positions:raise GuardError('MAX_OPEN_POSITIONS')
            if self.journal.daily_pnl()<=-self.settings.daily_loss:raise GuardError('DAILY_REALIZED_LOSS_LIMIT')
            book=yes if decision['action']=='BUY_YES' else no
            plan=buy_plan(self.settings,decision,market,book,fees,before_cash,remaining,self.account.allowance(cash,market))
            asset=plan['asset'];side='BUY';cap=plan['cap']
            before_qty=self.account.balance(asset,market.version).balance
            if before_qty!=0 or any(p['asset']==asset for p in self.journal.positions()):raise GuardError('ASSET_ALREADY_HELD')
            kwargs={'asset_id':asset,'side':'BUY','amount':str(plan['notional']),
                    'max_spend':str(cap),'max_price':str(plan['max_price']),'order_type':'FOK'}
            outcome='YES' if decision['action']=='BUY_YES' else 'NO'
        elif decision['action']=='SELL':
            asset=decision['position_asset'];side='SELL';cap=D(0)
            position=next((p for p in self.journal.positions() if p['asset']==asset),None)
            if not position:raise GuardError('NO_OWNED_POSITION')
            before_qty=self.account.balance(asset,market.version).balance
            if before_qty!=position['qty']:raise GuardError('POSITION_CHANGED_EXTERNALLY_REVIEW_REQUIRED')
            book=yes if asset==market.yes else no
            bids=sorted([(number(x['price']),number(x['size'])) for x in book.get('bids',[])],reverse=True)
            shares=(D(before_qty)/UNIT).quantize(D('.01'),rounding=ROUND_DOWN)
            if shares<number(book['min_order_size']):raise GuardError('POSITION_DUST_OR_BELOW_MIN_SIZE')
            total=D(0);floor=None
            for p,q in bids:
                if not 0<p<1 or q<=0:raise GuardError('INVALID_BID')
                total+=q;floor=p
                if total>=shares:break
            if total<shares or floor is None:raise GuardError('INSUFFICIENT_SELL_DEPTH')
            allowance=self.account.allowance(self.account.balance(asset,market.version),market)
            if allowance<shares:raise GuardError('MISSING_OUTCOME_SELL_APPROVAL')
            kwargs={'asset_id':asset,'side':'SELL','shares':str(shares),'min_price':str(floor),'order_type':'FOK'}
            outcome=position['outcome'];plan={'asset':asset,'cap':cap,'shares_estimate':shares,'min_price':floor}
        else:raise GuardError('UNSUPPORTED_DECISION')
        from polymarket._internal.actions.orders.context import resolve_order_exchange_address
        expected=self.client._ctx.environment_config.exchange_v3 if market.version=='v2' else self.client._ctx.environment_config.standard_exchange
        resolved=resolve_order_exchange_address(self.client._ctx.environment_config,asset_id=asset,neg_risk=False)
        if str(resolved).lower()!=expected.lower():raise GuardError('MARKET_PROTOCOL_ASSET_ID_MISMATCH')
        if self.settings.dry_run or not live:
            return {'status':'DRY_RUN_NO_ORDER_SIGNED_OR_SENT','plan':plan}
        if __import__('pathlib').Path('STOP').exists():raise GuardError('STOP_FILE')
        if not self.bridge or not self.client:raise GuardError('AUTH_REQUIRED')
        # SDK metadata has a long cache lifetime: use a new cache for every entry/exit.
        from polymarket._internal.actions.orders.cache import SyncOrderMetadataCache
        self.client._ctx=replace(self.client._ctx,order_metadata=SyncOrderMetadataCache())
        prepared_at=time.monotonic()
        signed=self.client.create_market_order(**kwargs)
        if (signed.maker.lower()!=self.settings.wallet.lower() or str(signed.token_id)!=asset or
            signed.side!=side or signed.order_type!='FOK' or signed.signature_type!=SIGNATURE[self.client.wallet_type] or
            str(signed.signer).lower()!=(self.settings.wallet if self.client.wallet_type=='DEPOSIT_WALLET' else self.client.signer).lower() or
            signed.builder!='0x'+'0'*64 or signed.maker_amount<=0 or signed.taker_amount<=0):
            raise GuardError('SIGNED_ORDER_DOES_NOT_MATCH_PLAN')
        if side=='BUY' and D(signed.maker_amount)/UNIT*(1+fees.rate)+D('.00002')>cap:
            raise GuardError('SIGNED_NOTIONAL_AND_WORST_CASE_FEES_EXCEED_CAP')
        if side=='BUY' and D(signed.maker_amount)/D(signed.taker_amount)>=plan['max_price']+D('.0001'):
            raise GuardError('SIGNED_PRICE_EXCEEDS_BOUND')
        if side=='SELL' and D(signed.taker_amount)/D(signed.maker_amount)<=floor-D('.0001'):
            raise GuardError('SIGNED_PRICE_EXCEEDS_BOUND')
        if side=='BUY' and D(signed.taker_amount)/UNIT<number(book['min_order_size']):raise GuardError('SIGNED_SHARES_BELOW_MINIMUM')
        if side=='SELL' and signed.maker_amount>before_qty:raise GuardError('SELL_EXCEEDS_HELD_SHARES')
        if time.monotonic()-prepared_at>10:raise GuardError('QUOTE_PREPARATION_TOO_OLD')
        if __import__('pathlib').Path('STOP').exists():raise GuardError('STOP_FILE')
        identifier=self.journal.prepare(asset,side,cap,asdict(signed),before_cash,before_qty,self.settings.test_budget)
        self.journal.transition(identifier,'SENDING')
        from polymarket._internal.actions.orders.post import build_post_order_request
        _,payload=build_post_order_request(signed,owner_api_key=self.client.credentials.key)
        wire=json.dumps(payload,separators=(',',':')).encode()
        self.bridge.authorize_order(wire)
        try:
            response=self.client.post_order(signed)  # exactly one attempt, NEVER retried
            safe=response.model_dump(mode='json')
            if not response.ok:
                if response.code=='unknown':
                    self.journal.transition(identifier,'UNKNOWN');raise GuardError('POST_RESPONSE_UNCERTAIN')
                self.journal.transition(identifier,'REJECTED',{'code':response.code})
                return {'status':'REJECTED','code':response.code}
            self.journal.transition(identifier,'ACCEPTED',safe)
            if not response.trade_ids:raise GuardError('ACCEPTED_WITHOUT_SETTLED_FILLS')
            self.client.wait_for_order_fill_settlement(response,timeout_s=30)
            for tid in response.trade_ids:
                rows=self.client.list_account_trades(id=tid).first_page().items
                if len(rows)!=1 or rows[0].status!='CONFIRMED' or str(rows[0].taker_order_id)!=str(response.order_id):
                    raise GuardError('FILL_SETTLEMENT_NOT_VERIFIED')
            after_cash=self.account.balance().balance
            after_qty=self.account.balance(asset,market.version).balance
            cash_delta=D(after_cash-before_cash)/UNIT;qty_delta=after_qty-before_qty
            if side=='BUY' and not (cash_delta<0 and -cash_delta<=cap and qty_delta>0):
                raise GuardError('BUY_RECEIPT_BALANCE_MISMATCH')
            if side=='SELL' and not (cash_delta>0 and -min(before_qty,signed.maker_amount)<=qty_delta<0):
                raise GuardError('SELL_RECEIPT_BALANCE_MISMATCH')
            self.journal.confirmed(identifier,asset,side,cash_delta,qty_delta,market,outcome,before_qty)
            return {'status':'CONFIRMED','order_id':str(response.order_id),'cash_delta_usd':str(cash_delta),'share_delta':str(D(qty_delta)/UNIT)}
        except BaseException:
            # Preserve signed intent/cap and stop. An unknown result is not a failed fill.
            row=self.journal.db.execute('SELECT state FROM orders WHERE id=?',(identifier,)).fetchone()
            if row and row[0] not in ('CONFIRMED','REJECTED'):self.journal.transition(identifier,'UNKNOWN')
            raise
