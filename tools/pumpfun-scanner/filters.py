"""Pure, deterministic scanner and journal analysis. No execution interfaces."""
import math
from collections import Counter, defaultdict


def number(value):
    if isinstance(value, bool) or value is None:
        return None
    try:
        out = float(value)
        return out if math.isfinite(out) else None
    except (ValueError, TypeError):
        return None


def truth(value):
    return value is True or isinstance(value, str) and value.lower() == 'true'


def assess(d):
    checks = {}
    def check(code, known, passed):
        checks[code] = ('PASS' if passed else 'FAIL') if known else 'UNVERIFIED'
    top, dev, curve = (number(d.get(k)) for k in ('top10_pct', 'dev_pct', 'curve_progress_pct'))
    check('TOP10', top is not None and d.get('top10_excludes_curve') is True, top is not None and 0 <= top < 22)
    check('DEV_HOLD', dev is not None, dev is not None and 0 <= dev < 4)
    sold = d.get('dev_sold_first15m')
    check('DEV_EARLY_SALE', isinstance(sold, bool) and (d.get('dev_history_complete') is True or sold is True), sold is False)
    buyers = d.get('creation_block_buyers')
    valid = isinstance(buyers, list) and all(isinstance(b, dict) and isinstance(b.get('wallet'), str) and number(b.get('sol')) is not None and number(b['sol']) > 0 for b in buyers)
    count = len({b['wallet'] for b in buyers}) if valid else None
    check('CREATION_BLOCK', valid and (d.get('creation_block_complete') is True or count > 3), count is not None and count <= 3)
    check('CURVE', curve is not None, curve is not None and 15 <= curve <= 75)
    matches = d.get('blocked_wallet_matches')
    check('WALLETS_TXT', d.get('blacklist_loaded') is True and isinstance(d.get('top10_wallets'), list) and isinstance(matches, list), matches == [])
    age, followers = number(d.get('socials_age_hours')), number(d.get('socials_followers'))
    safe_social = age is not None and age >= 72 or followers is not None and followers >= 200
    complete_social = age is not None and age >= 0 and followers is not None and followers >= 0
    check('SOCIALS', d.get('socials_verified') is True and (safe_social or complete_social), safe_social)
    failed = [k for k,v in checks.items() if v == 'FAIL']
    missing = [k for k,v in checks.items() if v == 'UNVERIFIED']
    return dict(verdict='SKIP' if failed else 'WATCH' if missing else 'SETUP VALID',
                score=round(sum(v == 'PASS' for v in checks.values()) / len(checks) * 10, 1),
                checks=checks, failed=failed, missing=missing)


def zone(value):
    n = number(value)
    return 'unverified' if n is None else '<15' if n < 15 else '15-35' if n < 35 else '35-55' if n < 55 else '55-75' if n <= 75 else '>75'


def backtest(rows):
    alerts, outcomes = {}, {}
    for row in rows:
        mint = row.get('mint')
        if not mint:
            continue
        if row.get('verdict') == 'SETUP VALID' and mint not in alerts:
            alerts[mint] = row
        if truth(row.get('outcome_verified')) and row.get('outcome') in ('graduated','died_within_1h'):
            outcomes[mint] = row['outcome']
    totals = dict(passing_tokens=len(alerts), graduated=0, died_within_1h=0, unverified=0)
    groups = defaultdict(Counter)
    for mint,row in alerts.items():
        label = outcomes.get(mint, 'unverified')
        totals[label] += 1
        groups[zone(row.get('curve_progress_pct'))][label] += 1
    return {**totals, 'by_curve_at_first_alert':dict(groups),
            'note':'Replay of recorded filters, not simulated trades or profit. Missing outcomes stay unverified.'}


def weekly(rows):
    positions = {}
    for row in rows:
        key = row.get('position_id') or row.get('positionId')
        if key and truth(row.get('closed')):
            positions[key] = row
    known, missing = [], 0
    for key,row in positions.items():
        pnl = number(row.get('net_pnl_sol', row.get('positionPnlSol')))
        risk = number(row.get('risk_sol'))
        if pnl is None:
            missing += 1
            continue
        known.append(dict(position_id=key, mint=row.get('mint'), ticker=row.get('ticker',row.get('symbol')),
                          net_pnl_sol=pnl, R=pnl/risk if risk and risk > 0 else None,
                          hour=row.get('hour',row.get('utcHour','unverified')),
                          curve_zone=row.get('curve_zone', zone(row.get('curve_progress_pct'))),
                          narrative_age=row.get('narrative_age','unverified'),
                          mood=row.get('mood','unverified'), broken_rules=row.get('broken_rules','')))
    def grouped(field):
        buckets = defaultdict(list)
        for r in known:
            buckets[str(r[field])].append(r)
        return {k:dict(count=len(v),win_rate=sum(x['net_pnl_sol'] > 0 for x in v)/len(v),
                       net_pnl_sol=sum(x['net_pnl_sol'] for x in v),
                       average_R=sum(x['R'] for x in v if x['R'] is not None)/sum(x['R'] is not None for x in v) if any(x['R'] is not None for x in v) else None) for k,v in buckets.items()}
    violations = defaultdict(lambda: dict(count=0, associated_pnl_sol=0))
    for row in known:
        codes = str(row['broken_rules']).replace(';',',').split(',')
        for code in set(c.strip() for c in codes if c.strip()):
            if len(code) <= 64 and all(c.isalnum() or c in '_-' for c in code):
                violations[code]['count'] += 1
                violations[code]['associated_pnl_sol'] += row['net_pnl_sol']
    ordered = sorted(known,key=lambda x:x['net_pnl_sol'])
    def common(group):
        return {field:[dict(value=k,count=n) for k,n in Counter(str(r[field]) for r in group if r[field] not in (None,'unverified','')).items() if n >= 2] for field in ('hour','curve_zone','narrative_age','mood')}
    return dict(closed_positions=len(known),missing_net_pnl=missing,net_pnl_sol=sum(r['net_pnl_sol'] for r in known),
                by_hour=grouped('hour'),by_curve_zone=grouped('curve_zone'),by_narrative_age=grouped('narrative_age'),by_mood=grouped('mood'),
                rule_violations=dict(violations),worst_three=ordered[:3],best_three=ordered[-3:][::-1],
                worst_common=common(ordered[:3]),best_common=common(ordered[-3:]),
                rule_add_suggestion='unverified: needs counterfactual observations, not just executed trades',
                rule_remove_suggestion='unverified: do not remove safety limits from a small selected sample',
                market_or_me='unverified: journal alone cannot establish market-versus-decision causation',
                note='PnL must already include fees/slippage/rent; violation PnL is associated, not proven causal cost.')
