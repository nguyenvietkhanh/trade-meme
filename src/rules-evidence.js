import {planRulesOrder} from './rules-allocation.js';
import {momentumChecks} from './rules-momentum.js';
import {withRpcPriority} from './rpc-priority.js';
// An optional research-data adapter. It receives public mint/pool only, never wallet or signer data.
// Full research is optional in V5.2; absent histories are recorded as unknown, never certified clean.
const INPUT_KEYS=['market_cap','curve_progress_pct','holder_count','top10_pct','dev_wallet_pct','block0_buyer_count','volume_5m','volume_1h','buy_sell_ratio','liquidity_depth','graduation_dump_model','narrative_heat','holder_growth_rate','token_age_minutes','global_pumpfun_volume_24h_percentile','priority_fee_sol','protocol_fee_pct','expected_slippage_pct'];
function sanitize(data){const i=data.inputs??{},o=data.observations??{},inputs=Object.fromEntries(INPUT_KEYS.map(k=>[k,Number.isFinite(i[k])?i[k]:null]));
 inputs.dev_sell_history=Array.isArray(i.dev_sell_history)?i.dev_sell_history.map(t=>({age_minutes:t.age_minutes})):null;inputs.bundle_clusters=Array.isArray(i.bundle_clusters)?i.bundle_clusters.map(c=>({wallet_count:c.wallet_count??c.wallets?.length??null})):null;
 inputs.funding_source_trace={status:i.funding_source_trace?.status==='clean'?'clean':'unknown'};inputs.socials={presence:typeof i.socials?.presence==='boolean'?i.socials.presence:null,account_age_days:Array.isArray(i.socials?.account_age_days)?i.socials.account_age_days.map(n=>Number.isFinite(n)?n:null):null};
 const observations=Object.fromEntries(['curveMonotonic','volume5mStable','liquidityHealthy','newAthWithin120m','volume1hDeclining'].map(k=>[k,typeof o[k]==='boolean'?o[k]:null]));if(typeof o.dumpMath==='string'&&o.dumpMath.length<=200&&/^[0-9+*/().,% =-]+$/.test(o.dumpMath))observations.dumpMath=o.dumpMath;
 return {inputs,observations};}
export class RulesEvidence{
 constructor({url=process.env.RULES_EVIDENCE_URL,fetcher=globalThis.fetch,clock=Date.now,execution=null}={}){this.execution=execution;this.nextReadAt=0;this.history=new Map();this.url=url;this.fetcher=fetcher;this.clock=clock;this.cache=new Map();this.factsCache=new Map();if(url&&new URL(url).protocol!=='https:')throw Error('RULES_EVIDENCE_URL_REQUIRES_HTTPS');}
 async readAvailableFacts(c){
  const m=c.rawMarket,now=this.clock(),missingResearch=['dev history from launch','full block0 / bundle history','global volume percentile','graduation dump model','funding / social history'];
  if(!this.execution||!m)return {error:'RULES_EVIDENCE_NOT_CONFIGURED',missing:['RPC execution and current market']};
  const priceAt=m.priceAt??m.updatedAt,activityAt=m.activityCheckedAt??m.marketObservedAt??m.updatedAt;
  if(!Number.isFinite(priceAt)||priceAt>now||now-priceAt>5000||!Number.isFinite(activityAt)||activityAt>now||now-activityAt>30000)return {error:'RULES_MARKET_STALE',missing:['price <=5s and activity <=30s']};
  const inputs={volume_5m:m.volume5mUsd??null,volume_1h:m.volume1hUsd??null,volume_5m_sol:m.volume5mSol??(m.volume5mUsd>0&&c.solUsd>0?m.volume5mUsd/c.solUsd:null),buys_5m:m.buys5m,sells_5m:m.sells5m,change_5m_pct:m.change5mPct,quote_reserve_sol:m.liquidityQuoteSol??null,holder_count:null,token_age_minutes:Number.isFinite(m.pairCreatedAt)&&m.pairCreatedAt>0?(now-m.pairCreatedAt)/60000:null};
  const observations={evidenceProfile:'onchain-momentum',creatorSoldRecently:m.creatorSoldRecently===true,suspectedBundle:m.suspectedBundle===true};
  const checks=momentumChecks({...inputs,quote_reserve_sol:Infinity,holder_count:Infinity},observations),blocked=Object.entries(checks).filter(([,ok])=>!ok).map(([k])=>k);
  if(blocked.length)return {error:'RULES_MOMENTUM_NOT_READY',missing:blocked,inputs,checkedAt:now};
  if(!c.account&&!(c.probeSol>0))return {error:'RULES_CAPITAL_NOT_READY',missing:['positive wallet-sized quote amount']};
  const key=c.mint+':'+c.pool,prior=this.cache.get(key);
  // The cached quote is usable only for the same account and the same requested amount.
  const accountKey=JSON.stringify(c.account??null);
  if(prior?.accountKey===accountKey&&(!c.probeSol||prior.probeSol===c.probeSol)&&now-prior.checkedAt<=2500)return prior;
  let factsRow=this.factsCache.get(key);
  if(!factsRow||now-factsRow.at>30000){
   if(now<this.nextReadAt)return {error:'RULES_FACTS_READ_SCHEDULED',missing:['waiting for RPC holder scan']};this.nextReadAt=now+2500;
   try{const facts=await withRpcPriority('background',()=>m.dexId==='pumpfun'?this.execution.inspectCurveMarket(m,undefined,{includeQuote:false}):this.execution.inspectMarketFacts(m));factsRow={facts,at:this.clock()};this.factsCache.set(key,factsRow);}
   catch{return {error:'RULES_ONCHAIN_FACTS_UNAVAILABLE',missing:['verified mint/pool, complete holders and creator balance']};}
  }
  const {facts}=factsRow;
  Object.assign(inputs,{top10_pct:facts.top10ExcludesPool===true?facts.top10Pct:null,dev_wallet_pct:facts.devPct,holder_count:facts.holderCount,quote_reserve_sol:facts.quoteReserveSol,curve_progress_pct:facts.curveProgressPct??null});
  if(!Number.isFinite(inputs.top10_pct)||!Number.isFinite(inputs.dev_wallet_pct))return {error:'RULES_DATA_MISSING',missing:['verified top10 excluding LP / curve and creator balance'],inputs};
  if(inputs.top10_pct>25||inputs.dev_wallet_pct>5)return {error:'RULES_HOLDER_REJECTED',missing:['top10 <=25%, dev <=5%'],inputs};
  const remaining=Object.entries(momentumChecks(inputs,observations)).filter(([,ok])=>!ok).map(([k])=>k);
  if(remaining.length)return {error:'RULES_MOMENTUM_NOT_READY',missing:remaining,inputs};
  Object.assign(inputs,{priority_fee_sol:.000025});
  const probeSol=c.probeSol??planRulesOrder({...inputs,...c.account},observations).size;
  if(!(probeSol>=.0025))return {error:'RULES_CAPITAL_NOT_READY',missing:['spendable order >=0.0025 SOL after gas / reservations']};
  try{
   const q=await withRpcPriority('background',()=>this.execution.roundTripQuote(c.mint,String(Math.floor(probeSol*1e9)),m)),at=this.clock();
   if(q.roundTripQuoteOk!==true||q.probeSol!==probeSol||!Number.isFinite(q.roundTripLossPct)||q.roundTripLossPct<0||q.roundTripLossPct>6||!Number.isFinite(q.quoteCheckedAt)||q.quoteCheckedAt>at||at-q.quoteCheckedAt>5000||![q.buyImpactPct,q.sellImpactPct].every(x=>Number.isFinite(x)&&x>=0&&x<=2))throw Error('quote');
   // 0.000025 SOL is the enforced per-transaction network fee ceiling, not an invented protocol fee.
   Object.assign(inputs,{round_trip_quote_loss_pct:q.roundTripLossPct,quote_probe_sol:probeSol,priority_fee_sol:.000025});
   const row={inputs,observations,checkedAt:at,holdersCheckedAt:factsRow.at,probeSol,accountKey,source:'RPC holders + observed market momentum + executable roundtrip quote',researchUnknowns:missingResearch};
   this.cache.set(key,row);for(const map of [this.cache,this.factsCache])while(map.size>500)map.delete(map.keys().next().value);return row;
  }catch{return {error:'RULES_QUOTE_UNAVAILABLE',missing:['fresh size-matched roundtrip quote, loss <=6%, impact <=2%'],inputs};}
 }

 async read(c){
  if(!this.url)return this.readAvailableFacts(c);
  const old=this.cache.get(c.mint+':'+c.pool);if(old&&this.clock()-old.checkedAt<=2500)return old;
  try{const url=new URL(this.url);url.searchParams.set('mint',c.mint);url.searchParams.set('pool',c.pool);const r=await this.fetcher(url,{redirect:'error',signal:AbortSignal.timeout(2500)});if(!r.ok)throw Error('provider unavailable');const text=await r.text();if(text.length>128000)throw Error('oversize');const data=JSON.parse(text),v=data.coverage;
   if(data.mint!==c.mint||data.pool!==c.pool||!Number.isFinite(data.checkedAt)||data.checkedAt>this.clock()||this.clock()-data.checkedAt>5000||!data.source||v?.top10ExcludesLpAndCurve!==true||v?.devHistoryFromLaunch!==true||v?.block0Complete!==true||v?.bundlesComplete!==true||v?.volumePercentileAsOfVerified!==true)throw Error('coverage unverified');
   const row={...sanitize(data),checkedAt:data.checkedAt,source:String(data.source).slice(0,200)};this.cache.set(c.mint+':'+c.pool,row);return row;
  }catch{return {error:'RULES_EVIDENCE_UNVERIFIED',missing:['fresh, complete, same-mint evidence']};}
 }
}
