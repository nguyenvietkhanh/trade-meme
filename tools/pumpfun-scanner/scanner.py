"""Standalone read-only pump.fun observer. Never imports the trading application."""
import argparse
import base64
from collections import Counter, OrderedDict
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import queue
import re
import struct
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from filters import assess, backtest, weekly, number
from reports import report

PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
SOL = 'So11111111111111111111111111111111111111112'
PROGRAMS = {'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'}
READ_METHODS = {'getAccountInfo','getTokenSupply','getProgramAccounts'}
csv.field_size_limit(1048576)
MINT = re.compile(r'^[1-9A-HJ-NP-Za-km-z]{32,44}$')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        return None

class ReadError(Exception):
    def __init__(self, code, wait=0):
        super().__init__(code)
        self.wait = wait

def request_json(url, data=None, limit=8*1024*1024):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers={'Content-Type':'application/json','User-Agent':'pf-readonly-scanner/1'})
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=12) as response:
            raw = response.read(limit+1)
        if len(raw) > limit:
            raise ReadError('RESPONSE_TOO_LARGE')
        return json.loads(raw)
    except urllib.error.HTTPError as exc:
        raise ReadError('HTTP_'+str(exc.code), 60 if exc.code == 429 else 30) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ReadError('NETWORK_UNAVAILABLE',30) from None
    except (ValueError, UnicodeError):
        raise ReadError('INVALID_JSON',30) from None

class Rpc:
    def __init__(self, endpoint):
        if urllib.parse.urlparse(endpoint).scheme != 'https':
            raise ReadError('RPC_REQUIRES_HTTPS')
        self.endpoint, self.next_at = endpoint, 0
    def read(self, method, params):
        if method not in READ_METHODS:
            raise ReadError('READ_METHOD_NOT_ALLOWED')
        time.sleep(max(0,self.next_at-time.monotonic()))
        self.next_at = time.monotonic()+1
        result = request_json(self.endpoint,dict(jsonrpc='2.0',id=1,method=method,params=params))
        if not isinstance(result,dict) or result.get('error') or 'result' not in result:
            raise ReadError('RPC_READ_FAILED',30)
        return result['result']

def addresses():
    # Public-key arithmetic only; no account secrets or transaction types.
    from solders.pubkey import Pubkey
    return Pubkey

def onchain(rpc,mint):
    Pubkey = addresses()
    mint_key = Pubkey.from_string(mint)
    curve,_ = Pubkey.find_program_address([b'bonding-curve',bytes(mint_key)],Pubkey.from_string(PUMP))
    global_key,_ = Pubkey.find_program_address([b'global'],Pubkey.from_string(PUMP))
    def account(key):
        v = rpc.read('getAccountInfo',[str(key),dict(encoding='base64',commitment='confirmed')])['value']
        if not v or v.get('executable'):
            raise ReadError('ACCOUNT_UNAVAILABLE')
        return v,base64.b64decode(v['data'][0],validate=True)
    mint_info, mint_data = account(mint_key)
    if mint_info['owner'] not in PROGRAMS or len(mint_data) < 82:
        raise ReadError('TOKEN_PROGRAM_UNVERIFIED')
    info, data = account(curve)
    global_info, global_data = account(global_key)
    if info['owner'] != PUMP or global_info['owner'] != PUMP or len(data)<81 or len(global_data)<97:
        raise ReadError('CURVE_UNVERIFIED')
    if data[:8] != hashlib.sha256(b'account:BondingCurve').digest()[:8] or global_data[:8] != hashlib.sha256(b'account:Global').digest()[:8]:
        raise ReadError('CURVE_LAYOUT_UNVERIFIED')
    if len(data)>=115 and str(Pubkey.from_bytes(data[83:115])) not in (SOL,'11111111111111111111111111111111'):
        raise ReadError('NON_SOL_CURVE_UNVERIFIED')
    creator = str(Pubkey.from_bytes(data[49:81]))
    initial = struct.unpack_from('<Q',global_data,89)[0]
    remaining = struct.unpack_from('<Q',data,24)[0]
    progress = (1-remaining/initial)*100 if initial>0 and remaining<=initial else None
    virtual_tokens=struct.unpack_from('<Q',data,8)[0]; virtual_quote=struct.unpack_from('<Q',data,16)[0]
    spot_price_sol=(virtual_quote/1e9)/(virtual_tokens/(10**mint_data[44])) if virtual_tokens and not data[48] else None
    supply = int(rpc.read('getTokenSupply',[mint,dict(commitment='confirmed')])['value']['amount'])
    accounts = rpc.read('getProgramAccounts',[mint_info['owner'],dict(commitment='confirmed',encoding='base64',filters=[dict(memcmp=dict(offset=0,bytes=mint))],dataSlice=dict(offset=0,length=72))])
    if not isinstance(accounts,list) or len(accounts)>25000 or supply<=0:
        raise ReadError('HOLDER_COVERAGE_UNVERIFIED')
    owners, total = Counter(),0
    for entry in accounts:
        a=entry['account']; raw=base64.b64decode(a['data'][0],validate=True)
        if a['owner']!=mint_info['owner'] or len(raw)!=72 or raw[:32]!=bytes(mint_key):
            raise ReadError('HOLDER_IDENTITY_UNVERIFIED')
        amount=struct.unpack_from('<Q',raw,64)[0]; total+=amount
        owner=str(Pubkey.from_bytes(raw[32:64]))
        if owner!=str(curve) and amount>0:
            owners[owner]+=amount
    if total!=supply:
        raise ReadError('HOLDER_TOTAL_UNVERIFIED')
    top=owners.most_common(10)
    return dict(curve_address=str(curve),spot_price_sol=spot_price_sol,curve_progress_pct=progress,curve_complete=bool(data[48]),dev_wallet=creator,
                top10_pct=sum(v for _,v in top)/supply*100,top10_wallets=[k for k,_ in top],
                top10_excludes_curve=True,holder_count=len(owners),dev_pct=owners.get(creator,0)/supply*100,
                chain_source='confirmed Solana RPC',chain_observed_at=datetime.now(timezone.utc).isoformat())

def load_wallets(file):
    try:
        text=Path(file).read_text(encoding='utf-8-sig')
        if len(text.encode())>262144:
            return None
        rows=[line.split()[0].split(',')[0] for line in text.splitlines() if line.strip() and not line.lstrip().startswith('#')]
        if any(not MINT.fullmatch(a) for a in rows) or len(rows)>4096:
            return None
        if not rows and not re.search(r'^#\s*allow-empty\s*$',text,re.M):
            return None
        return set(rows)
    except (OSError,ValueError):
        return None

FIELDS=['timestamp','mint','symbol','market_cap_usd','curve_progress_pct','top10_pct','dev_pct','verdict','reasons','missing','evidence','outcome','outcome_verified']
class Journal:
    def __init__(self,root,max_mib=32,days=3):
        self.root=Path(root); self.root.mkdir(parents=True,exist_ok=True)
        self.cap=max_mib*1024*1024; self.days=days; self.lock=threading.Lock(); self.sequence=0
    def write(self,row):
        with self.lock:
            day=datetime.now(timezone.utc).strftime('%Y-%m-%d')
            file=self.root/f'tokens-{day}-{self.sequence:04d}.csv'
            if file.exists() and file.stat().st_size>4*1024*1024:
                self.sequence+=1; file=self.root/f'tokens-{day}-{self.sequence:04d}.csv'
            def safe(v):
                text=json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else str(v) if v is not None else ''
                return "'"+text if isinstance(v,str) and text[:1] in ('=','+','-','@') else text
            new=not file.exists() or file.stat().st_size==0
            with file.open('a',newline='',encoding='utf-8') as handle:
                writer=csv.DictWriter(handle,fieldnames=FIELDS)
                if new: writer.writeheader()
                writer.writerow({k:safe(row.get(k)) for k in FIELDS})
            files=sorted((p for p in self.root.glob('tokens-????-??-??-????.csv') if p.is_file() and not p.is_symlink()),key=lambda p:p.stat().st_mtime)
            total=sum(p.stat().st_size for p in files)
            for p in files:
                if p==file: continue
                if total>self.cap or time.time()-p.stat().st_mtime>self.days*86400:
                    size=p.stat().st_size; p.unlink(); total-=size

def rows_from(path):
    files=sorted(Path(path).glob('tokens-*.csv')) if Path(path).is_dir() else [Path(path)]
    for file in files:
        with file.open(newline='',encoding='utf-8-sig') as f:
            yield from csv.DictReader(f)

class CreatorHistory:
    def __init__(self):
        self.tokens=OrderedDict()
    def observe(self,d,stamp=None):
        stamp=time.time() if stamp is None else stamp
        mint,creator=d.get('mint'),d.get('dev_wallet')
        if not mint or not creator:
            return {}
        old=self.tokens.get(mint,{})
        price=number(d.get('spot_price_sol'))
        first=old.get('first_price') or (price if price and price>0 else None)
        created=number(d.get('created_timestamp'))
        if created and created>1e12: created/=1000
        within=created is not None and 0<=stamp-created<=3600
        outcome=old.get('outcome')
        if d.get('curve_complete') is True: outcome='graduated'
        elif within and first and price is not None and price<=first*.1: outcome='died_within_1h'
        self.tokens[mint]=dict(creator=creator,first_price=first,outcome=outcome)
        while len(self.tokens)>4096: self.tokens.popitem(last=False)
        observed=[v for v in self.tokens.values() if v['creator']==creator]
        return dict(dev_observed_created_count=len(observed),dev_observed_died_within_1h=sum(v['outcome']=='died_within_1h' for v in observed),
                    repeat_creator=len(observed)>=2,creator_history_coverage='local observations, not complete creator history',
                    outcome=outcome or '',outcome_verified=outcome is not None,
                    outcome_definition='graduated: confirmed curve complete; died: observed >=90% spot decline within reported first hour; not proof of permanent death')

def env_file(file):
    allowed={'HELIUS_API_KEY','SOLANA_RPC_URL','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','PROJECT_RESEARCH_URL'}
    result={}
    if file:
        for line in Path(file).read_text(encoding='utf-8-sig').splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                k,v=line.split('=',1)
                if k.strip() in allowed: result[k.strip()]=v.strip().strip('"').strip("'")
    for k in allowed:
        if k in os.environ: result[k]=os.environ[k]
    return result

def run(args):
    env=env_file(args.env)
    endpoint=env.get('SOLANA_RPC_URL') or ('https://mainnet.helius-rpc.com/?api-key='+urllib.parse.quote(env['HELIUS_API_KEY']) if env.get('HELIUS_API_KEY') else None)
    if not endpoint: raise ReadError('HELIUS_API_KEY_OR_SOLANA_RPC_URL_REQUIRED')
    rpc=Rpc(endpoint); journal=Journal(args.output,args.max_mib,args.days)
    history=CreatorHistory()
    for saved in rows_from(args.output):
        try:
            evidence=json.loads(saved.get('evidence') or '{}'); stamp=datetime.fromisoformat(saved['timestamp']).timestamp(); history.observe(evidence,stamp)
        except (ValueError,KeyError,TypeError): pass
    pending=queue.Queue(maxsize=64); stop=threading.Event(); seen=OrderedDict(); last=OrderedDict(); counts=Counter(); hour=int(time.time()//3600); retry_at=0
    def record(d,result):
        try:
            journal.write(dict(timestamp=datetime.now(timezone.utc).isoformat(),mint=d.get('mint'),symbol=d.get('symbol'),market_cap_usd=d.get('usd_market_cap'),curve_progress_pct=d.get('curve_progress_pct'),top10_pct=d.get('top10_pct'),dev_pct=d.get('dev_pct'),verdict=result['verdict'],reasons=result['failed'],missing=result['missing'],evidence=d,outcome=d.get('outcome',''),outcome_verified=d.get('outcome_verified',False)))
        except (OSError,ValueError,ReadError):
            print('OBSERVER STORAGE_UNAVAILABLE | record dropped')
    def worker():
        nonlocal retry_at
        while not stop.is_set() or not pending.empty():
            try: coin=pending.get(timeout=.5)
            except queue.Empty: continue
            mint=coin['mint']
            try:
                if time.monotonic()<retry_at: raise ReadError('PROVIDER_BACKOFF')
                evidence={**coin,**onchain(rpc,mint)}
                url=env.get('PROJECT_RESEARCH_URL')
                if url:
                    if urllib.parse.urlparse(url).scheme!='https': raise ReadError('RESEARCH_REQUIRES_HTTPS')
                    research=request_json(url+('&' if '?' in url else '?')+urllib.parse.urlencode(dict(mint=mint,pool=evidence['curve_address'])),limit=131072)
                    stamp=number(research.get('checkedAt'))
                    if research.get('mint')!=mint or research.get('pool')!=evidence['curve_address'] or not stamp or not 0<=time.time()*1000-stamp<=60000: raise ReadError('RESEARCH_IDENTITY_OR_TIME')
                    coverage=research.get('coverage',{});social=research.get('socials') or {}
                    evidence.update(dev_sold_first15m=research.get('devSoldFirst15m'),dev_history_complete=coverage.get('devFirst15m') is True,
                                    creation_block_buyers=research.get('creationBlockBuyers'),creation_block_complete=coverage.get('creationBlock') is True,
                                    socials_verified=social.get('verified') is True,socials_age_hours=social.get('ageHours'),socials_followers=social.get('followers'))
                wallets=load_wallets(args.wallets);evidence['blacklist_loaded']=wallets is not None
                evidence['blocked_wallet_matches']=[a for a in evidence['top10_wallets'] if a in wallets] if wallets is not None else None
                evidence.update(history.observe(evidence));result=assess(evidence);counts.update(result['failed']+['UNVERIFIED_'+x for x in result['missing']]);record(evidence,result)
                if result['verdict']=='SETUP VALID' and env.get('TELEGRAM_BOT_TOKEN') and env.get('TELEGRAM_CHAT_ID'):
                    text='SCANNER PASS — READ ONLY\nCA: '+mint+'\nMcap: '+str(coin.get('usd_market_cap'))+'\nCurve: '+str(evidence['curve_progress_pct'])+'%\nTop10: '+str(evidence['top10_pct'])+'%\nDev: '+str(evidence['dev_pct'])+'%\nBlock-0 buyers: '+str(len({b['wallet'] for b in evidence['creation_block_buyers']}))+'\nhttps://pump.fun/coin/'+mint
                    request_json('https://api.telegram.org/bot'+env['TELEGRAM_BOT_TOKEN']+'/sendMessage',dict(chat_id=env['TELEGRAM_CHAT_ID'],text=text),limit=131072)
            except ReadError as exc:
                retry_at=max(retry_at,time.monotonic()+exc.wait);counts.update([str(exc)]);record(coin,dict(verdict='WATCH',failed=[],missing=[str(exc)]))
            except Exception:
                counts.update(['UNAVAILABLE']);record(coin,dict(verdict='WATCH',failed=[],missing=['UNAVAILABLE']))
            finally:
                last[mint]=time.monotonic()
                while len(last)>4096: last.popitem(last=False)
                pending.task_done()
    thread=threading.Thread(target=worker,daemon=True);thread.start()
    print('READ ONLY | public pump.fun + configured RPC | no account connection | interval=10s')
    try:
        while True:
            started=time.monotonic();submitted=0
            if started>=retry_at:
                try:
                    coins=request_json('https://frontend-api-v3.pump.fun/coins?offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=false',limit=1048576)
                    if not isinstance(coins,list): raise ReadError('PUBLIC_FEED_INVALID')
                    for coin in coins:
                        coin={k:coin.get(k) for k in ('mint','symbol','created_timestamp','usd_market_cap','complete','bonding_curve','creator')}
                        mint=coin.get('mint')
                        if not isinstance(mint,str) or not MINT.fullmatch(mint): continue
                        if mint not in seen:
                            record(coin,dict(verdict='WATCH',failed=[],missing=['QUEUED_OR_DEFERRED']))
                            seen[mint]=True
                            while len(seen)>4096: seen.popitem(last=False)
                        if submitted<args.max_per_cycle and time.monotonic()-last.get(mint,-1000)>=60:
                            try: pending.put_nowait(coin);last[mint]=time.monotonic();submitted+=1
                            except queue.Full: counts.update(['QUEUE_FULL'])
                except ReadError as exc:
                    retry_at=time.monotonic()+max(10,exc.wait);print('FEED UNAVAILABLE | '+str(exc))
            current=int(time.time()//3600)
            if current!=hour:
                print('WHY FAILED UTC | '+json.dumps(counts.most_common(),ensure_ascii=False));counts.clear();hour=current
            if args.once: pending.join();break
            stop.wait(max(.1,10-(time.monotonic()-started)))
    except KeyboardInterrupt:
        print('Stopping observer.')
    finally:
        stop.set();thread.join(timeout=2)
        print('WHY FAILED UTC | '+json.dumps(counts.most_common(),ensure_ascii=False))

def main():
    parser=argparse.ArgumentParser(description='Read-only scanner; no trading interfaces')
    parser.add_argument('--env',help='dedicated scanner .env file, never a trading account file')
    parser.add_argument('--wallets',default='wallets.txt');parser.add_argument('--output',default='scanner-data')
    parser.add_argument('--max-mib',type=int,default=32);parser.add_argument('--days',type=int,default=3)
    parser.add_argument('--max-per-cycle',type=int,default=2);parser.add_argument('--once',action='store_true')
    parser.add_argument('--report',choices=['autopsy','borderline','dev-trace','curve','zone','fake-check','exit','tilt','narrative','sunday','rule-audit']);parser.add_argument('--input');
    parser.add_argument('--backtest');parser.add_argument('--trades');parser.add_argument('--analysis-output',default='analysis.json')
    args=parser.parse_args()
    if args.report:
        if not args.input: parser.error('--report requires --input JSON')
        value=report(args.report,json.loads(Path(args.input).read_text(encoding='utf-8-sig')));print(json.dumps(value,ensure_ascii=False,indent=2));return
    if args.backtest or args.trades:
        result=backtest(list(rows_from(args.backtest))) if args.backtest else weekly(list(rows_from(args.trades)))
        print(json.dumps(result,ensure_ascii=False,indent=2));Path(args.analysis_output).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');return
    if args.max_mib<8 or not 1<=args.days<=30 or not 1<=args.max_per_cycle<=5: parser.error('invalid storage/read limits')
    try: run(args)
    except ReadError as exc: print('STOP | '+str(exc))
    except Exception as exc: print('STOP | '+type(exc).__name__+' | inspect local configuration; secrets are not displayed')

if __name__=='__main__': main()
