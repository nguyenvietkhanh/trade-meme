"""Typed multi-market forecasts; prices, edge, sizing and selection are computed locally."""
import json
import re
from datetime import datetime,timezone
from decimal import Decimal,ROUND_DOWN
from .config import number
from .news_research import cited_evidence
from .pricing import Fees,levels

D=Decimal
MIN_EDGE=D('.08');MAX_SPREAD=D('.04');MIN_CONFIDENCE=D('.6');ORDER_CAP=D('2')


def _unique_object(pairs):
    value={}
    for key,item in pairs:
        if key in value:raise ValueError('DUPLICATE_MODEL_JSON_KEY')
        value[key]=item
    return value


def parse_json(text):
    if not isinstance(text,str) or len(text)>128000:raise ValueError('INVALID_MODEL_JSON')
    text=text.strip()
    if text.startswith('```'):
        match=re.fullmatch(r'```(?:json)?\s*([\s\S]*?)\s*```',text,flags=re.I)
        if not match:raise ValueError('INVALID_MODEL_JSON_FENCE')
        text=match.group(1)
    def constant(_):raise ValueError('NONFINITE_MODEL_JSON')
    raw=json.loads(text,parse_float=D,parse_constant=constant,object_pairs_hook=_unique_object)
    if not isinstance(raw,dict):raise ValueError('MODEL_JSON_OBJECT_REQUIRED')
    return raw


def enrich_market(m,now):
    m=dict(m);m['market_id']=str(m['market_id']);m['resolution_rules']=m.get('resolution_rules') or m.get('description','')
    m['days_left']=None;m['forecast_ready']=False
    try:
        end=datetime.fromisoformat(m['end_date'].replace('Z','+00:00'))
        if end.tzinfo is None:raise ValueError('NAIVE_END_DATE')
        m['days_left']=max((end-now).total_seconds()/86400,0)
        m['forecast_ready']=bool(m['resolution_rules'].strip() and m.get('resolution_source') and m['days_left']>0)
    except (ValueError,TypeError,KeyError,AttributeError):pass
    for side in ('yes','no'):
        m[side+'_spread']=None
        try:
            ask,bid=number(m[side+'_ask']),number(m[side+'_bid'])
            if not 0<bid<=ask<1:raise ValueError('INVALID_SPREAD')
            m[side+'_spread']=ask-bid
        except (ValueError,TypeError,KeyError):pass
    m['spread']=m['yes_spread']  # legacy alias; selection always uses the chosen side.
    return m


def _target(d,by_id,by_asset):
    asset=d.get('position_asset');mid=d.get('market_id')
    if asset is not None:
        if not isinstance(asset,str) or asset not in by_asset or d.get('action') not in ('SELL','HOLD'):
            raise ValueError('INVALID_OWNED_POSITION_TARGET')
        owned_mid=str(by_asset[asset]['market']['id'])
        if mid is not None and str(mid)!=owned_mid:raise ValueError('POSITION_MARKET_MISMATCH')
        return ('position',asset),by_id.get(owned_mid)
    if mid is None or str(mid) not in by_id or d.get('action') not in ('BUY_YES','BUY_NO','HOLD'):
        raise ValueError('INVALID_MARKET_FORECAST_TARGET')
    return ('market',str(mid)),by_id[str(mid)]


def pick_best(decisions,user_data,positions):
    from .ai_model import validate_decision
    by_id={m['market_id']:m for m in user_data['markets']}
    by_asset={p['asset']:p for p in positions}
    expected={('market',mid) for mid in by_id}|{('position',asset) for asset in by_asset}
    if not isinstance(decisions,list) or len(decisions)!=len(expected):raise ValueError('FORECAST_COVERAGE_MISMATCH')
    seen=set();evaluations=[];candidates=[]
    for raw in decisions:
        if not isinstance(raw,dict):raise ValueError('INVALID_FORECAST_ENTRY')
        target,market=_target(raw,by_id,by_asset)
        if target in seen or market is None:raise ValueError('DUPLICATE_OR_MISSING_FORECAST_TARGET')
        seen.add(target)
        p,c=number(raw.get('probability_yes')),number(raw.get('confidence'))
        fraction=number(raw.get('size_fraction'))
        if not D('.01')<=p<=D('.99') or not 0<=c<=1 or not 0<=fraction<=1:
            raise ValueError('INVALID_FORECAST_NUMBERS')
        basis=raw.get('basis')
        if basis not in ('news','base_rate','none') or type(raw.get('uses_external_facts')) is not bool:
            raise ValueError('INVALID_FORECAST_BASIS')
        sources=cited_evidence(raw,market)
        if basis=='base_rate' and raw['uses_external_facts']:raise ValueError('BASE_RATE_CANNOT_CLAIM_EXTERNAL_FACTS')
        if basis=='news' and not raw['uses_external_facts']:raise ValueError('NEWS_BASIS_REQUIRES_EXTERNAL_FACTS')
        reason=raw.get('reason')
        if not isinstance(reason,str) or not reason.strip():raise ValueError('AI_REASON_MISSING')
        evaluation={'market_id':market['market_id'],'position_asset':raw.get('position_asset'),
                    'proposed_action':raw['action'],'action':'HOLD','probability_yes':p,'confidence':c,
                    'basis':basis,'edge':D(0),'size_fraction':fraction,'all_in_usd':D(0),
                    'uses_external_facts':raw['uses_external_facts'],'cited_source_ids':[s['id'] for s in sources],
                    'risk_changed':raw.get('risk_changed') is True,'reason':reason[:1500]}
        evaluations.append(evaluation)
        if raw['action']=='HOLD':continue
        if basis=='none':raise ValueError('ACTION_REQUIRES_FORECAST_BASIS')
        candidate=dict(raw,probability_yes=p,confidence=c,basis=basis,size_fraction=fraction)
        if raw['action']=='SELL':
            pos=by_asset[raw['position_asset']];side='yes' if pos['outcome']=='YES' else 'no'
            try:bid=number(market[side+'_bid'])
            except (ValueError,KeyError,TypeError):evaluation['blocked_by']='MISSING_SELL_BID';continue
            if not 0<bid<1:evaluation['blocked_by']='MISSING_SELL_BID';continue
            fair=p if side=='yes' else 1-p
            risk=raw.get('risk_changed',False)
            if type(risk) is not bool:raise ValueError('INVALID_RISK_CHANGED')
            edge=bid-fair
            if edge<=0 and not risk:evaluation['blocked_by']='SELL_BID_NOT_ABOVE_FAIR_AND_NO_RISK_CHANGE';continue
            candidate.update(all_in_usd=D(0),edge=edge,risk_changed=risk,market_id=market['market_id'])
            selected=validate_decision(candidate,user_data['markets'],positions)
            selected.update(edge=edge,risk_changed=risk,all_in_usd=D(0),market_id=market['market_id'])
        else:
            if len(positions)>=user_data['max_open_positions']:evaluation['blocked_by']='MAX_OPEN_POSITIONS';continue
            if not market.get('forecast_ready'):evaluation['blocked_by']='MISSING_RULES_SOURCE_OR_VALID_HORIZON';continue
            side='yes' if raw['action']=='BUY_YES' else 'no'
            if market.get(side+'_asset') in by_asset:evaluation['blocked_by']='ASSET_ALREADY_HELD';continue
            spread=market.get(side+'_spread')
            if spread is None or number(spread)>number(user_data['max_spread']):evaluation['blocked_by']='SPREAD';continue
            ask=number(market[side+'_ask']);fair=p if side=='yes' else 1-p
            edge=fair-ask;evaluation['edge']=edge
            if edge<number(user_data['min_edge']) or c<number(user_data['min_confidence']):
                evaluation['blocked_by']='EDGE_OR_CONFIDENCE';continue
            if basis=='news' and len({s['publisher_host'] for s in sources})<2:
                evaluation['blocked_by']='NEWS_REQUIRES_TWO_PUBLISHERS';continue
            cash=max(D(0),min(number(user_data['available_usd']),number(user_data['remaining_test_spend_usd'])))
            amount=min(cash*fraction,ORDER_CAP,number(user_data['max_usd_per_trade'])).quantize(D('.000001'),rounding=ROUND_DOWN)
            if amount<=0:evaluation['blocked_by']='ZERO_SIZE_OR_CASH';continue
            # Reuse the same fee/depth/min-size sizing guard as execution. The
            # real account allowance and fresh book are checked again before signing.
            from .ai_engine import buy_plan
            from .secure_bridge import GuardError
            from types import SimpleNamespace
            try:
                fees=Fees(number(market['fee_rate']),int(market['fee_exponent']))
                book={'asks':market[side+'_asks'],'bids':market[side+'_bids'],'min_order_size':market['minimum_shares']}
                policy=SimpleNamespace(max_trade=number(user_data['max_usd_per_trade']),
                    min_edge=number(user_data['min_edge'])*100,confidence=number(user_data['min_confidence']),
                    max_spread=number(user_data['max_spread']))
                asset_pair=SimpleNamespace(yes=market['yes_asset'],no=market['no_asset'])
                candidate['all_in_usd']=amount
                plan=buy_plan(policy,candidate,asset_pair,book,fees,int(cash*1000000),
                              number(user_data['remaining_test_spend_usd']),cash)
            except GuardError as exc:
                evaluation['blocked_by']=str(exc);continue
            except (KeyError,ValueError,TypeError):
                evaluation['blocked_by']='INVALID_FEE_OR_DEPTH_INPUT';continue
            selected=validate_decision(candidate,user_data['markets'],positions)
            selected.update(edge=edge,net_edge=plan['edge_pct']/100,size_fraction=fraction)
        evaluation.update(action=raw['action'],edge=selected['edge'])
        evaluation['all_in_usd']=selected['all_in_usd']
        if 'net_edge' in selected:evaluation['net_edge']=selected['net_edge']
        candidates.append(selected)
    if seen!=expected:raise ValueError('FORECAST_COVERAGE_MISMATCH')
    if not candidates:return {'action':'HOLD','reason':'Không có quyết định nào vượt kiểm tra giá, edge, nguồn và cỡ lệnh.','evaluations':evaluations}
    # A valid exit must not be displaced by a new entry. SELL edge is computed
    # from owned-side bid/fair value; the model-supplied edge is never trusted.
    exits=[c for c in candidates if c['action']=='SELL']
    best=max(exits or candidates,key=lambda d:d['edge']*d['confidence'])
    return dict(best,evaluations=evaluations)
