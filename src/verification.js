import {fetchStructure} from './candles.js';
import {rankMarket} from './strategy.js';
import {SCAN_RULES} from './scanner.js';
// Provider messages can contain URLs/credentials. Expose only a fixed label and HTTP status.
function providerFailure(provider,error){
 const status=String(error?.message??'').match(/\bHTTP\s+(\d{3})\b/)?.[1];
 const detail=status?'HTTP '+status:['TimeoutError','AbortError'].includes(error?.name)?'hết thời gian chờ':'dữ liệu chưa xác minh';
 return `${provider}: ${detail}; khóa BUY, thử lại ở vòng quét sau.`;
}
const reusable=(cached,now)=>cached&&now-cached.at<(cached.value.verificationError?SCAN_RULES.intervalMs:20000);
/** RugCheck supplies only part of the mandatory evidence. Never fill absent facts with zero/true. */
export function rugEvidence(report,market,now=Date.now()){
 if(report?.mint!==market.mint||!report.token||typeof report.token!=='object')throw Error('RugCheck trả sai token hoặc thiếu cấu trúc.');
 const out={...(typeof report.creator==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(report.creator)?{creatorAddress:report.creator}:{}),mint:market.mint,pairAddress:market.pairAddress,checkedAt:now,source:'rugcheck-partial',rugFetchedAt:now};
 if(Object.hasOwn(report.token,'mintAuthority'))out.mintRevoked=report.token.mintAuthority===null;
 if(Object.hasOwn(report.token,'freezeAuthority'))out.freezeRevoked=report.token.freezeAuthority===null;
 const pool=Array.isArray(report.markets)?report.markets.find(p=>p.pubkey===market.pairAddress):null;
 // lpLockedPct is used conservatively on its own, never summed with possibly overlapping burned LP.
 const secured=[pool?.lp?.lpLockedPct,pool?.lp?.lpBurnedPct].filter(v=>Number.isFinite(v)&&v>=0&&v<=100);if(secured.length)out.lpSecuredPct=Math.max(...secured);
 if(Array.isArray(report.risks)&&report.risks.every(r=>typeof r.name==='string'&&['danger','warn','info'].includes(r.level))){out.riskWarningsChecked=true;out.criticalWarnings=report.risks.filter(r=>r.level==='danger').map(r=>r.name.slice(0,120));}
 // Account-level topHolders are not an owner-aggregated, pool-excluded distribution.
 // Report scores / an empty risks list cannot prove sellability, unique buyers or absence of bundles.
 return out;
}
export class VerificationFeed{
 constructor(fetcher=globalThis.fetch,execution=null){this.fetcher=fetcher;this.execution=execution;this.cache=new Map();this.jobs=new Map();}
 async enrichCached(markets,tracked=[],now=Date.now()){
  // Rotate candidates by oldest check so two failing high-volume tokens cannot monopolize both jobs.
  const checkedAt=m=>this.cache.get(m.mint+':'+m.pairAddress)?.at??0;
  const targets=markets.filter(m=>tracked.includes(m.mint)||rankMarket(m,undefined,now).roughEligible).sort((a,b)=>Number(tracked.includes(b.mint))-Number(tracked.includes(a.mint))||checkedAt(a)-checkedAt(b)||b.volume5mUsd-a.volume5mUsd).slice(0,6);
  for(const m of targets){
   const key=m.mint+':'+m.pairAddress,cached=this.cache.get(key);
   if(this.jobs.size>=2)break;
   if(this.jobs.has(key)||reusable(cached,now))continue;
   const job=this.enrich([m],[m.mint],now).catch(()=>{}).finally(()=>this.jobs.delete(key));this.jobs.set(key,job);
  }
  return markets.map(m=>({...m,...this.cache.get(m.mint+':'+m.pairAddress)?.value}));
 }
 async enrich(markets,tracked=[],now=Date.now()){
  const targets=markets.filter(m=>(tracked.includes(m.mint)||rankMarket(m,undefined,now).roughEligible)&&(tracked.includes(m.mint)||(now-m.pairCreatedAt>=900000&&now-m.pairCreatedAt<=86400000&&m.liquidityUsd>=20*m.solUsd))).sort((a,b)=>Number(tracked.includes(b.mint))-Number(tracked.includes(a.mint))||b.volume5mUsd-a.volume5mUsd).slice(0,6);
  const results=new Map();
  // Bounded requests and short deadlines keep safety-provider outages from blocking every scan.
  for(let i=0;i<targets.length;i+=2)await Promise.all(targets.slice(i,i+2).map(async m=>{
   if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m.mint))return;
   const key=m.mint+':'+m.pairAddress,cached=this.cache.get(key);
   if(reusable(cached,now)){results.set(key,cached.value);return;}
   let value;
   try{const response=await this.fetcher('https://api.rugcheck.xyz/v1/tokens/'+encodeURIComponent(m.mint)+'/report',{signal:AbortSignal.timeout(2000)});if(!response.ok)throw Error('HTTP '+response.status);value={evidence:rugEvidence(await response.json(),m,now)};}
   catch(error){value={verificationError:providerFailure('RugCheck',error)};}
   if(this.execution)try{const structure=await fetchStructure(m,this.fetcher);value.evidence={...value.evidence,...structure};}catch{}
   if(this.execution?.inspectMarket&&value.evidence?.riskWarningsChecked===true&&value.evidence?.criticalWarnings?.length===0&&value.evidence?.lpSecuredPct>=90)try{const chain=await this.execution.inspectMarket({...m,creatorAddress:value.evidence?.creatorAddress});value.evidence={...value.evidence,...chain,source:'rugcheck+solana-rpc+jupiter',mint:m.mint,pairAddress:m.pairAddress,checkedAt:now};}catch(error){value.verificationError=providerFailure('On-chain / quote Jupiter',error);}
   this.cache.set(key,{at:now,value});results.set(key,value);
  }));
  for(const [k,v]of this.cache)if(now-v.at>300000)this.cache.delete(k);
  return markets.map(m=>({...m,...results.get(m.mint+':'+m.pairAddress)}));
 }
}
