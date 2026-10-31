import {backoffFetch} from '../src/provider-fetch.js';
const ORIGIN='https://frontend-api-v3.pump.fun',MINT=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const number=v=>v!=null&&Number.isFinite(Number(v))?Number(v):null;
const failureCode=e=>Number.isInteger(e?.status)?'HTTP_'+e.status:e?.name==='TimeoutError'||e?.name==='AbortError'?'TIMEOUT':e instanceof SyntaxError?'INVALID_JSON':e?.code==='INVALID_RESPONSE'?'INVALID_RESPONSE':e?.code==='PROVIDER_BACKOFF'?'PROVIDER_BACKOFF':'REQUEST_FAILED';
export function curveActivity(rows,mint,now=Date.now(),limit=200){
 if(!Array.isArray(rows)||rows.some(t=>t.mint!==mint||typeof t.signature!=='string'||!t.signature||t.signature.length>128||!Number.isSafeInteger(number(t.slot))||number(t.slot)<0||typeof t.is_buy!=='boolean'||!MINT.test(t.user)||!Number.isSafeInteger(number(t.sol_amount))||number(t.sol_amount)<=0||!Number.isSafeInteger(number(t.token_amount))||number(t.token_amount)<=0||!Number.isSafeInteger(number(t.timestamp))||number(t.timestamp)*1000>now))throw Object.assign(Error('Lịch sử pump.fun thiếu dữ liệu giao dịch thực.'),{code:'INVALID_RESPONSE'});
 const unique=new Map(rows.map(t=>[t.signature+':'+(t.tx_index??'')+':'+t.user+':'+t.is_buy,{...t,slot:Number(t.slot),at:Number(t.timestamp)*1000,priceSol:Number(t.sol_amount)/1e9/(Number(t.token_amount)/1e6)}]));
 const all=[...unique.values()].sort((a,b)=>a.at-b.at||a.slot-b.slot||Number(a.tx_index??0)-Number(b.tx_index??0)||a.signature.localeCompare(b.signature)),historyComplete=rows.length<limit||all[0]?.at<=now-300000;
 const window=ms=>all.filter(t=>t.at>=now-ms),m1=window(60000),m5=window(300000),h1=window(3600000),volume=a=>a.reduce((n,t)=>n+Number(t.sol_amount)/1e9,0),buys=a=>a.filter(t=>t.is_buy).length;
 const anchor=ms=>[...all].reverse().find(t=>t.at<=now-ms)??all[0];
 const change=ms=>{const a=anchor(ms),last=all.at(-1);return a&&last&&a.priceSol>0?(last.priceSol/a.priceSol-1)*100:null;};
 const last=all.at(-1);
 return {historyComplete,activityCheckedAt:now,activityWatermark:last?`${last.slot}:${last.signature}:${last.tx_index??0}`:null,buys1m:buys(m1),sells1m:m1.length-buys(m1),buys5m:buys(m5),sells5m:m5.length-buys(m5),buys1h:buys(h1),sells1h:h1.length-buys(h1),volume1mSol:volume(m1),volume5mSol:volume(m5),volume1hSol:volume(h1),change1mPct:change(60000),change5mPct:change(300000),change1hPct:change(3600000),uniqueBuyers5m:new Set(m5.filter(t=>t.is_buy).map(t=>t.user)).size,lastTradeAt:last?.at??null,trades:all};
}
export class ScalpCurveMarkets{
 constructor(execution,fetcher=globalThis.fetch,{rulesMode=false,tuning={}}={}){this.tuning=tuning;this.rulesMode=rulesMode;this.execution=execution;this.fetcher=backoffFetch(fetcher,{provider:'pump.fun'});this.coins=new Map();this.activities=new Map();this.prices=new Map();this.lastDiscoveryAt=0;this.lastTrades=new Map();this.cursor=0;this.stages={discovery:{status:'idle'},curveRpc:{status:'idle'},activity:{status:'idle'}};this.counts={verifiedCurves:0,liquidCurves:0};}
 note(stage,error=null){const before=this.stages[stage];this.stages[stage]={status:error?'error':'ok',checkedAt:Date.now(),lastSuccessAt:error?before.lastSuccessAt??null:Date.now(),errorCode:error?failureCode(error):null};}
 diagnostics(markets=[]){
  const now=Date.now(),fresh=markets.filter(m=>now-m.updatedAt<=30000),stages=Object.fromEntries(Object.entries(this.stages).map(([k,v])=>[k,{...v,status:v.status==='ok'&&now-v.checkedAt>(k==='discovery'?60000:30000)?'stale':v.status}]));
  const failed=Object.values(stages).some(s=>s.status==='error'),status=fresh.length?(failed?'degraded':'ready'):failed?'unavailable':stages.discovery.status==='idle'?'connecting':Object.values(stages).some(s=>s.status==='stale')?'stale':this.coins.size?'waiting':'empty';
  const problem=stages.discovery.status==='error'?`Không lấy được danh sách token (${stages.discovery.errorCode}).`:stages.curveRpc.status==='error'?`Không đọc được bonding curve qua RPC (${stages.curveRpc.errorCode}).`:stages.activity.status==='error'?`Chưa lấy được lịch sử giao dịch (${stages.activity.errorCode}).`:null;
  const detail=fresh.length?`${fresh.length} ứng viên có giá và lịch sử giao dịch mới.`:status==='stale'?'Dữ liệu nguồn đã cũ; chưa có ứng viên mới.':!this.coins.size?'Chưa có token trước migrate từ nguồn khám phá.':!this.counts.verifiedCurves?'Chưa đọc được curve SOL chưa migrate hợp lệ.':!this.counts.liquidCurves?'Curve đã đọc chưa đạt thanh khoản 20 SOL và vốn hóa $3k–$5m.':'Đang lấy lịch sử giao dịch cho các curve đạt lọc thô.';
  return {status,message:'pump.fun trước migrate: '+(problem??detail),...this.counts,discoveredMints:this.coins.size,freshMarkets:fresh.length,completeActivityMarkets:fresh.filter(m=>m.historyComplete).length,stages};
 }
 result(markets=[]){const diagnostics=this.diagnostics(markets),warnings=[];
  if(diagnostics.stages.discovery.status==='error')warnings.push('Nguồn pump.fun trước migrate chưa khả dụng; không dựng dữ liệu thay thế.');
  if(diagnostics.stages.curveRpc.status==='error')warnings.push('Nguồn curve chưa lấy được dữ liệu mới qua RPC; PumpSwap vẫn hoạt động.');
  if(diagnostics.stages.activity.status==='error')warnings.push('Chưa lấy được lịch sử giao dịch pump.fun cho một ứng viên; chưa xét BUY.');
  return {markets:markets.filter(m=>Date.now()-m.updatedAt<=30000),warnings,diagnostics};
 }
 async json(url){const r=await this.fetcher(url,{signal:AbortSignal.timeout(2500)});if(!r.ok)throw Object.assign(Error('pump.fun HTTP '+r.status),{status:r.status});return r.json();}
 async activity(mint){
  const rows=[];let requested=0;for(let offset=0;offset<1000;offset+=200){const page=await this.json(ORIGIN+'/trades/all/'+mint+'?limit=200&offset='+offset+'&minimumSize=0');if(!Array.isArray(page))throw Object.assign(Error('Lịch sử curve không hợp lệ.'),{code:'INVALID_RESPONSE'});requested+=200;rows.push(...page);if(page.length<200||Math.min(...page.map(t=>Number(t.timestamp)*1000))<=Date.now()-300000)break;}
  return curveActivity(rows,mint,Date.now(),requested);
 }
 cachedMarkets(solUsd,tracked=[]){
  if(!this.job)this.job=this.markets(solUsd,tracked).then(value=>{this.latest=value;}).catch(error=>{this.note('curveRpc',error);this.latest=this.result();}).finally(()=>{this.job=null;});
  return this.latest?this.result(this.latest.markets):{...this.result(),warnings:['Đang kết nối nguồn pump.fun trước migrate.']};
 }
 async markets(solUsd,tracked=[]){
  const now=Date.now();
  if(now-this.lastDiscoveryAt>=(this.tuning.scanMs??(this.rulesMode?10000:30000))){this.lastDiscoveryAt=now;try{const rows=await this.json(ORIGIN+'/coins?offset=0&limit=50&sort=last_trade_timestamp&order=DESC&includeNsfw=false');if(!Array.isArray(rows))throw Object.assign(Error('Không có danh sách pump.fun.'),{code:'INVALID_RESPONSE'});try{this.onObserved?.(rows);}catch{/* Optional public observer only. */}for(const c of rows)if(MINT.test(c.mint)&&c.complete===false)this.coins.set(c.mint,c);else if(MINT.test(c.mint)&&c.complete===true)this.coins.delete(c.mint);for(const mint of [...this.coins.keys()].slice(0,Math.max(0,this.coins.size-300)))this.coins.delete(mint);this.note('discovery');}catch(error){this.note('discovery',error);}}
  for(const mint of this.prices.keys())if(!this.coins.has(mint)){this.prices.delete(mint);this.activities.delete(mint);this.lastTrades.delete(mint);}
  const mints=[...this.coins.keys()];if(!mints.length)return this.result();
  // Revisit at most two promising curves in the confirmation window; a full
  // discovery rotation can otherwise take longer than the 10–15 second window.
  const followups=[...this.activities].filter(([mint,a])=>this.coins.has(mint)&&now-a.activityCheckedAt>=10000&&now-a.activityCheckedAt<=15000&&a.change1mPct>0&&a.change5mPct>0&&a.buys5m>=8&&a.buys5m+a.sells5m>=15).slice(0,2).map(([mint])=>mint);
  const chosen=[...new Set([...tracked.filter(m=>this.coins.has(m)),...followups,...Array.from({length:Math.min(this.tuning.curveLimit??6,mints.length)},(_,i)=>mints[(this.cursor+i)%mints.length])])].slice(0,this.tuning.curveLimit??8);this.cursor=(this.cursor+(this.tuning.curveLimit??6))%mints.length;
  let slots;try{slots=await this.execution.curveMarketData(chosen,solUsd);this.note('curveRpc');this.counts.verifiedCurves=slots.length;}catch(error){this.note('curveRpc',error);return this.result();}
  for(const state of slots){const c=this.coins.get(state.mint);this.prices.set(state.mint,{...state,symbol:String(c.symbol??'?').slice(0,60),name:String(c.name??'').slice(0,120),pairCreatedAt:number(c.created_timestamp)>1e12?number(c.created_timestamp):number(c.created_timestamp)>1e9?number(c.created_timestamp)*1000:null,hasProfile:!!(c.website||c.twitter||c.telegram),boosted:false});}
  const liquid=this.rulesMode?slots:slots.filter(m=>m.liquidityQuoteSol>=20&&m.valuationUsd>=3000&&m.valuationUsd<=5000000);this.counts.liquidCurves=liquid.length;
  const targets=liquid.sort((a,b)=>Number(followups.includes(b.mint))-Number(followups.includes(a.mint))||(this.lastTrades.get(a.mint)??0)-(this.lastTrades.get(b.mint)??0)).slice(0,this.tuning.curveActivityBatch??2).filter(m=>now-(this.lastTrades.get(m.mint)??0)>=(this.tuning.scanMs??10000));
  const results=await Promise.allSettled(targets.map(async m=>{this.lastTrades.set(m.mint,now);this.activities.set(m.mint,await this.activity(m.mint));}));
  if(results.length)this.note('activity',results.find(r=>r.status==='rejected')?.reason);
  const markets=[];
  for(const [mint,price]of this.prices){const a=this.activities.get(mint);if(now-price.updatedAt>30000||!a||now-a.activityCheckedAt>30000)continue;const creatorTrades=a.trades.filter(t=>t.user===price.creatorAddress),firstSlot=new Map();for(const t of a.trades.filter(t=>t.is_buy&&Number.isSafeInteger(t.slot))){const k=t.slot;firstSlot.set(k,(firstSlot.get(k)??[]).concat(t));}const suspectedBundle=[...firstSlot.values()].some(g=>new Set(g.map(t=>t.user)).size>=3&&g.reduce((n,t)=>n+Number(t.token_amount),0)>price.tokenSupplyRaw*.05);
   const {trades,...activity}=a;markets.push({...price,...activity,updatedAt:Math.min(price.updatedAt,a.activityCheckedAt),activityLastPriceSol:trades.at(-1)?.priceSol??null,creatorSoldRecently:creatorTrades.some(t=>!t.is_buy&&t.at>=now-300000),suspectedBundle,volume1mUsd:a.volume1mSol*solUsd,volume5mUsd:a.volume5mSol*solUsd,volume1hUsd:a.volume1hSol*solUsd,volume24hUsd:null});
  }
  return this.result(markets);
 }
}
