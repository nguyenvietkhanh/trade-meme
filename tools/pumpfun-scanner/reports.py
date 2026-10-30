"""Data-only reports. Missing evidence is explicit; no model or account actions."""
from collections import Counter
from datetime import datetime, timezone, timedelta
import difflib
from filters import assess, number, weekly


def report(mode,data):
    if mode=='autopsy':
        return assess(data)['verdict']
    if mode=='borderline':
        r=assess(data)
        order=['CREATION_BLOCK','DEV_EARLY_SALE','TOP10','DEV_HOLD','WALLETS_TXT','SOCIALS','CURVE']
        strongest=next((k for k in order if k in r['failed']),None)
        return dict(strongest_skip=strongest or ('unverified data: '+','.join(r['missing']) if r['missing'] else 'none in configured checks'),
                    strongest_positive=next((k for k,v in r['checks'].items() if v=='PASS'),'unverified'),
                    one_point_that_flips='none: multiple failed or missing checks remain' if len(r['failed'])+len(r['missing'])>1 else (r['failed']+r['missing'] or ['none'])[0],
                    where='RPC holder/creation receipts; verified social history; owner-maintained wallets.txt',
                    note='Passing data checks does not establish a trading edge.')
    if mode=='dev-trace':
        creator=data.get('dev_wallet'); rows=[x for x in data.get('observed_tokens',[]) if x.get('dev_wallet')==creator and creator]
        return dict(dev_wallet=creator or 'unverified',funding=data.get('verified_funding_transfers') or 'unverified',
                    observed_tokens=len({r.get('mint') for r in rows if r.get('mint')}),
                    observed_died_within_1h=sum(r.get('outcome_verified') is True and r.get('outcome')=='died_within_1h' for r in rows),
                    repeat_creator=len({r.get('mint') for r in rows if r.get('mint')})>=2,
                    complete_creator_history='unverified',ultimate_funding_source='unverified',
                    wallets_txt_matches=data.get('dev_blocklist_matches','unverified'),
                    note='Supplied observations only; no claim of having browsed Solscan or an exhaustive creator index.')
    if mode=='curve':
        holders=[r for r in data.get('holders',[]) if (number(r.get('supply_pct')) or 0)>1.5]
        table=[{k:r.get(k,'unverified') for k in ('wallet','supply_pct','first_buy_at','average_entry','sold','in_wallets_txt')} for r in holders]
        top=sorted(data.get('holders',[]),key=lambda r:number(r.get('supply_pct')) or 0,reverse=True)[:5]
        supply,x,y=(number(data.get(k)) for k in ('supply_tokens','pool_base_tokens','pool_quote_sol'))
        model='unverified: require observed CPMM reserves and complete top5 distribution'
        if data.get('pool_model')=='cpmm' and data.get('holder_distribution_verified') is True and len(top)==5 and all(number(r.get('supply_pct')) is not None for r in top) and all(v is not None and v>0 for v in (supply,x,y)):
            delta=supply*sum(number(r['supply_pct']) for r in top)/100*.5
            model=dict(tokens_sold=round(delta),quote_out_sol=round(y*delta/(x+delta),4),
                       final_spot_drop_pct=round((1-(x/(x+delta))**2)*100,1),
                       math=['d = supply × sum(top5 %) / 100 × 0.5','quote out = Y × d / (X+d)','spot after / before = (X / (X+d))²'],
                       assumptions='Single CPMM, no fees/MEV/concurrent flow. Not a forecast of future graduation liquidity.')
        return dict(wallets_over_1_5pct=table,distribution_coverage=data.get('holder_distribution_verified','unverified'),dump_scenario=model)
    if mode=='zone':
        c=number(data.get('curve_progress_pct'))
        return dict(zone='unverified' if c is None else 'early <15%' if c<15 else 'configured window 15-75%' if c<=75 else 'late >75%' if c<100 else 'completed',
                    counterparty_type='unverified: price/holder spread alone cannot identify trader intent',
                    last_15m_coverage=data.get('trades_15m_complete','unverified'))
    if mode=='fake-check':
        ticker=str(data.get('symbol','')).casefold().strip();now=number(data.get('now_ms'))
        recent=[r for r in data.get('observed_tokens',[]) if now is not None and number(r.get('created_at_ms')) is not None and 0<=now-number(r['created_at_ms'])<=86400000]
        similar=[r for r in recent if ticker and difflib.SequenceMatcher(None,ticker,str(r.get('symbol','')).casefold().strip()).ratio()>=.85]
        return dict(official_relationship='unverified',verified_official_backlinks=data.get('verified_official_backlinks') or [],
                    observed_similar_tickers_24h=len({r.get('mint') for r in similar if r.get('mint')}),
                    older_rug_link=data.get('verified_prior_rug_link','unverified'),coverage='observed dataset only, not all launches')
    if mode=='exit':
        entry,current=number(data.get('entry_price')),number(data.get('current_price'))
        rule='unverified'
        if data.get('exit_policy_version')!='project-rules-v6-fixed': rule='use saved position policy; do not replace legacy exits'
        elif entry and current is not None:
            rule='stop: exit remaining position at -30% trigger' if current<=entry*.7 else 'take 40% at 2x' if current>=entry*2 and not data.get('tp_confirmed') else 'keep original stop; no new trailing/time exit'
        return dict(argument_for_exit='Observed gains can reverse; executable exit value and liquidity must be checked.',applicable_rule=rule,execution='none: analysis only')
    if mode=='tilt':
        stamp=number(data.get('now_ms')); rows=[r for r in data.get('trades',[]) if r.get('closed') is True and number(r.get('at')) is not None and number(r.get('net_pnl_sol')) is not None]
        rows.sort(key=lambda r:r['at'],reverse=True);streak=0
        for r in rows:
            if r['net_pnl_sol']>=0: break
            streak+=1
        if stamp is None: return dict(answer='NO',reason='unverified current time')
        hour=datetime.fromtimestamp(stamp/1000,timezone(timedelta(hours=7))).hour
        paused=bool(streak>=2 and rows and stamp<rows[0]['at']+3600000)
        return dict(answer='NO' if 1<=hour<8 or paused else 'YES',reason='quiet hours / two-loss cooldown' if 1<=hour<8 or paused else 'time gates permit evaluation, not a recommendation or order',historical_after_loss=data.get('verified_after_loss_statistics','unverified'),timezone='Asia/Ho_Chi_Minh')
    if mode=='narrative':
        return dict(stories=data.get('verified_stories_last_12h',[])[:6],ranking='unverified: no semantic model used; supply verified stories/metrics',note='Token names or copied metadata do not prove an official narrative.')
    if mode in ('sunday','rule-audit'):
        return weekly(data.get('trades',[]))
    raise ValueError('unsupported report mode')
