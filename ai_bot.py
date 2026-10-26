"""AI directional predictions. No live order unless BOTH --live and DRY_RUN=false."""
import argparse
import json
import os
import time
from dataclasses import asdict
from decimal import Decimal
from pathlib import Path
from polymarket_arb.ai_settings import AISettings,load_local,state_directory
from polymarket_arb.ai_journal import Journal
from polymarket_arb.ai_model import decide
from polymarket_arb.ai_engine import Executor,Account
from polymarket_arb.market_data import MarketData,Market,APIError,DataError
from polymarket_arb.config import Config
from polymarket_arb.pricing import levels
from polymarket_arb.secure_bridge import SDKBridge,connect_sdk,GuardError


def app(argv=None):
    parser=argparse.ArgumentParser(description='Polymarket AI: account check, DRY_RUN or explicitly armed live test <=7 USD')
    parser.add_argument('--check-account',action='store_true')
    parser.add_argument('--loop',action='store_true')
    parser.add_argument('--live',action='store_true')
    args=parser.parse_args(argv)
    os.chdir(Path(__file__).resolve().parent)
    load_local()
    settings=AISettings.from_env()
    if args.live and settings.dry_run:raise GuardError('SET_DRY_RUN_FALSE_EXPLICITLY_TO_ARM_LIVE')
    if not settings.dry_run and not args.live and not args.check_account:raise GuardError('LIVE_REQUIRES_EXPLICIT_LIVE_FLAG')
    print('AI LOCAL | revision=derive-existing-v3 | auth=GET existing credentials',flush=True)
    bridge=SDKBridge();client=data=journal=None
    try:
        if Path('STOP').exists():raise GuardError('STOP_FILE')
        journal=Journal(state_directory(settings.wallet),settings.wallet)
        client=connect_sdk(settings.private_key,settings.wallet,bridge)
        cfg=client._ctx.environment_config
        if (cfg.chain_id!=137 or cfg.collateral_token.lower()!='0xc011a7e12a19f7b1f670d46f03b03f3342e82dfb' or
            cfg.exchange_v3.lower()!='0xe3333700ca9d93003f00f0f71f8515005f6c00aa'):
            raise GuardError('SDK_PRODUCTION_CONTRACTS_CHANGED_REVIEW_REQUIRED')
        server_time=client._ctx.clob.get_json('/time')
        if abs(float(server_time)-time.time())>10:raise GuardError('SYNC_WINDOWS_CLOCK_BEFORE_TRADING')
        account=Account(client)
        cash=account.snapshot()
        remaining=journal.remaining(settings.test_budget)
        available=min(Decimal(cash.balance)/1000000,remaining,settings.max_trade)
        print('ACCOUNT VERIFIED | wallet='+settings.wallet+' | type='+client.wallet_type,flush=True)
        print(f'Cash={Decimal(cash.balance)/1000000} pUSD | remaining cumulative BUY test cap={remaining} | usable <= {available}',flush=True)
        print('State directory:',journal.directory,flush=True)
        for exchange in (cfg.standard_exchange,cfg.exchange_v3):
            limit=next((v for k,v in cash.allowances.items() if k.lower()==exchange.lower()),0)
            print('Allowance '+exchange+' = '+str(Decimal(limit)/1000000)+' pUSD',flush=True)
        if journal.pending():raise GuardError('UNRESOLVED_ORDER_REQUIRES_REVIEW_NO_AUTOMATIC_RESUBMISSION')
        if args.check_account:
            print('Account read check complete. No trading approval, wrap or order submitted.')
            return 0
        if not settings.model_key:raise GuardError('SET_MODEL_API_KEY_LOCALLY')
        data=MarketData(Config(max_markets=20,public_http_backend='python'))
        # Both the modern public SDK and discovery reuse the authenticated SDK's
        # transport WITHOUT auth headers for public data, so only one Chrome process.
        def public_read(origin,path,params=None):
            transport=client._ctx.gamma if 'gamma-api.polymarket.com' in origin else client._ctx.clob
            return transport.get_json(path,params=params)
        data.requests.read_json=public_read
        executor=Executor(settings,client,bridge,journal)
        failures=0
        while True:
            if Path('STOP').exists():print('STOP file found. No new order.');return 0
            if journal.pending():raise GuardError('UNRESOLVED_ORDER_REQUIRES_REVIEW')
            try:
                positions=journal.positions()
                for position in positions:
                    raw=account.balance(position['asset'],position['market']['version'])
                    if raw.balance!=position['qty']:raise GuardError('POSITION_CHANGED_EXTERNALLY_REVIEW_REQUIRED')
                cash=account.snapshot();remaining=journal.remaining(settings.test_budget)
                available=min(Decimal(cash.balance)/1000000,remaining,settings.max_trade)
                markets=data.markets()
                known={}
                for p in positions:
                    m=Market(**p['market']);known[m.id]=m
                for m in markets:known.setdefault(m.id,m)
                contexts=[];selected={};skips={}
                for market in known.values():
                    if Path('STOP').exists():return 0
                    try:
                        yes,no,fee,minimum,yt,nt=data.snapshot(market)
                        y=levels(yes['asks']);n=levels(no['asks'])
                        context={'market_id':market.id,'question':market.title,'description':market.description,
                                 'end_date':market.end_date,'resolution_source':market.resolution_source,
                                 'yes_ask':str(y[0][0]),'no_ask':str(n[0][0]),'minimum_shares':str(minimum),
                                 'yes_asks':yes['asks'][-20:],'no_asks':no['asks'][-20:],
                                 'fee_rate':str(fee.rate),'fee_exponent':fee.exponent,'observed_at':time.time(),
                                 'research_status':'MARKET_DATA_ONLY_NO_CURRENT_NEWS_VERIFICATION'}
                        contexts.append(context);selected[market.id]=market
                        if len(contexts)>=max(3,len(positions)):break
                    except (APIError,DataError,ValueError,KeyError) as exc:
                        code=str(exc) if isinstance(exc,DataError) else type(exc).__name__
                        skips[code]=skips.get(code,0)+1
                # Ensure owned positions are not silently omitted by candidate count.
                if positions and any(p['market']['id'] not in selected for p in positions):
                    print('HOLD | owned-position quote unavailable; no order sent',flush=True)
                    decision={'action':'HOLD','reason':'owned-position quote unavailable'}
                elif not contexts:
                    print('HOLD | no fresh complete market data | '+json.dumps(skips),flush=True)
                    decision={'action':'HOLD','reason':'no fresh complete market data'}
                elif available<=0 and not positions:
                    print('TEST_BUDGET_OR_CASH_EXHAUSTED; stopped.',flush=True);return 0
                else:
                    journal.take_model_call(settings.max_calls)
                    decision=decide(settings,contexts,positions,available,remaining)
                    print('AI | '+decision['action']+' | '+''.join(c for c in decision['reason'] if c.isprintable())[:500],flush=True)
                    journal.event('AI_DECISION',decision)
                if decision['action']!='HOLD':
                    if decision['action']=='SELL':
                        pos=next(p for p in positions if p['asset']==decision['position_asset'])
                        market=Market(**pos['market'])
                    else:market=selected[decision['market_id']]
                    # LLM latency must never turn its input books into an execution quote.
                    yes,no,fee,_,_,_=data.snapshot(market)
                    try:
                        result=executor.execute(decision,market,yes,no,fee,live=args.live)
                        journal.event('ORDER_RESULT',result)
                        print('ORDER | '+json.dumps(result,default=str),flush=True)
                    except GuardError as exc:
                        if journal.pending():raise
                        journal.event('ENTRY_REJECTED',{'code':str(exc)})
                        print('NO ORDER | '+str(exc),flush=True)
                failures=0
            except (APIError,DataError) as exc:
                failures+=1
                print('DATA ERROR | '+type(exc).__name__+f' | consecutive={failures}/3',flush=True)
                if failures>=3:raise GuardError('CONSECUTIVE_DATA_FAILURES')
            if not args.loop:return 0
            deadline=time.monotonic()+settings.interval
            while time.monotonic()<deadline:
                if Path('STOP').exists():return 0
                time.sleep(1)
    except Exception as exc:
        if bridge.last_error:raise GuardError(bridge.last_error) from None
        if type(exc).__name__=='UnexpectedResponseError' and bridge.last_stage:
            raise GuardError(f'SDK_{bridge.last_stage}_RESPONSE_SCHEMA_MISMATCH') from None
        raise
    finally:
        if data:data.close()
        if client:
            try:client.close()
            except Exception:pass
        bridge.shutdown()
        if journal:journal.close()


if __name__=='__main__':
    try:raise SystemExit(app())
    except KeyboardInterrupt:print('Stopped. Pending/accepted orders are not assumed cancelled.')
    except Exception as exc:
        import re
        code=str(exc) if (isinstance(exc,GuardError) or type(exc) in (ValueError,RuntimeError)) and re.fullmatch(r'[A-Z0-9_]{1,120}',str(exc)) else type(exc).__name__
        print('STOPPED | '+code+' | No automatic retry of financial requests. Do not share keys.');raise SystemExit(1)
