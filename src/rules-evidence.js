import {withRpcPriority} from './rpc-priority.js';
// An optional research-data adapter. It receives public mint/pool only, never wallet or signer data.
// No missing holder/bundle/dev history is turned into a clean certificate.
const INPUT_KEYS=['market_cap','curve_progress_pct','holder_count','top10_pct','dev_wallet_pct','block0_buyer_count','volume_5m','volume_1h','buy_sell_ratio','liquidity_depth','graduation_dump_model','narrative_heat','holder_growth_rate','token_age_minutes','global_pumpfun_volume_24h_percentile','priority_fee_sol','protocol_fee_pct','expected_slippage_pct'];
function sanitize(data){const i=data.inputs??{},o=data.observations??{},inputs=Object.fromEntries(INPUT_KEYS.map(k=>[k,Number.isFinite(i[k])?i[k]:null]));
 inputs.dev_sell_history=Array.isArray(i.dev_sell_history)?i.dev_sell_history.map(t=>({age_minutes:t.age_minutes})):null;inputs.bundle_clusters=Array.isArray(i.bundle_clusters)?i.bundle_clusters.map(c=>({wallet_count:c.wallet_count??c.wallets?.length??null})):null;
 inputs.funding_source_trace={status:i.funding_source_trace?.status==='clean'?'clean':'unknown'};inputs.socials={presence:typeof i.socials?.presence==='boolean'?i.socials.presence:null,account_age_days:Array.isArray(i.socials?.account_age_days)?i.socials.account_age_days.map(n=>Number.isFinite(n)?n:null):null};
 const observations=Object.fromEntries(['curveMonotonic','volume5mStable','liquidityHealthy','newAthWithin120m','volume1hDeclining'].map(k=>[k,typeof o[k]==='boolean'?o[k]:null]));if(typeof o.dumpMath==='string'&&o.dumpMath.length<=200&&/^[0-9+*/().,% =-]+$/.test(o.dumpMath))observations.dumpMath=o.dumpMath;
 return {inputs,observations};}
export class RulesEvidence{
 constructor({url=process.env.RULES_EVIDENCE_URL,fetcher=globalThis.fetch,clock=Date.now,execution=null}={}){this.execution=execution;this.nextReadAt=0;this.history=new Map();this.url=url;this.fetcher=fetcher;this.clock=clock;this.cache=new Map();if(url&&new URL(url).protocol!=='https:')throw Error('RULES_EVIDENCE_URL_REQUIRES_HTTPS');}
 async readAvailableFacts(c){
  const missing=['dev sell history with full launch coverage','block0 buyer count with creation slot','complete bundle clusters','global pumpfun volume percentile','graduation dump model'];
  if(!this.execution||!c.rawMarket)return {error:'RULES_EVIDENCE_NOT_CONFIGURED',missing};
  const prior=this.cache.get(c.mint+':'+c.pool);if(prior&&this.clock()-prior.checkedAt<30000)return {...prior,error:'RULES_DATA_MISSING',missing};
  if(this.clock()<this.nextReadAt)return {error:'RULES_FACTS_READ_SCHEDULED',missing};this.nextReadAt=this.clock()+2500;
  try{const m=c.rawMarket,facts=await withRpcPriority('background',()=>m.dexId==='pumpfun'?this.execution.inspectCurveMarket(m,undefined,{includeQuote:false}):this.execution.inspectMarketFacts(m)),inputs={top10_pct:facts.top10ExcludesPool?facts.top10Pct:null,dev_wallet_pct:facts.devPct,holder_count:facts.holderCount,curve_progress_pct:facts.curveProgressPct??null,volume_5m:m.volume5mUsd??null,volume_1h:m.volume1hUsd??null,buy_sell_ratio:m.sells5m>0?m.buys5m/m.sells5m:null,token_age_minutes:Number.isFinite(m.pairCreatedAt)&&m.pairCreatedAt>0?(this.clock()-m.pairCreatedAt)/60000:null};const row={inputs,checkedAt:this.clock(),source:'RPC verified mint/pool and owner-aggregated holders; market feed volume',observations:{},error:'RULES_DATA_MISSING',missing};this.cache.set(c.mint+':'+c.pool,row);return row;
  }catch{return {error:'RULES_ONCHAIN_FACTS_UNAVAILABLE',missing};}
 }

 async read(c){
  const old=this.cache.get(c.mint+':'+c.pool);if(old&&this.clock()-old.checkedAt<=2500)return old;
  if(!this.url)return this.readAvailableFacts(c);
  try{const url=new URL(this.url);url.searchParams.set('mint',c.mint);url.searchParams.set('pool',c.pool);const r=await this.fetcher(url,{redirect:'error',signal:AbortSignal.timeout(2500)});if(!r.ok)throw Error('provider unavailable');const text=await r.text();if(text.length>128000)throw Error('oversize');const data=JSON.parse(text),v=data.coverage;
   if(data.mint!==c.mint||data.pool!==c.pool||!Number.isFinite(data.checkedAt)||data.checkedAt>this.clock()||this.clock()-data.checkedAt>5000||!data.source||v?.top10ExcludesLpAndCurve!==true||v?.devHistoryFromLaunch!==true||v?.block0Complete!==true||v?.bundlesComplete!==true||v?.volumePercentileAsOfVerified!==true)throw Error('coverage unverified');
   const row={...sanitize(data),checkedAt:data.checkedAt,source:String(data.source).slice(0,200)};this.cache.set(c.mint+':'+c.pool,row);return row;
  }catch{return {error:'RULES_EVIDENCE_UNVERIFIED',missing:['fresh, complete, same-mint evidence']};}
 }
}
