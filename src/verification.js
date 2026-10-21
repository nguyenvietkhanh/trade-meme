import {isPumpCurve} from './venues.js';
import {fetchStructure} from './candles.js';
import {rankMarket} from './strategy.js';
import {SCAN_RULES} from './scanner.js';
import {TREND_RULES} from './desk-rules.js';
import {backoffFetch} from './provider-fetch.js';
// Mutable reports, reserves and holder distributions must not become 15-minute BUY evidence.
export const VERIFICATION_CACHE_MS=20000;
function providerFailure(provider,error){
 if(error?.code==='QUOTE_QUEUE_BUSY')return 'Jupiter: đang chờ hạn mức quote; chưa có bằng chứng bán mới.';
 if(error?.code==='HOLDER_SCAN_UNAVAILABLE')return 'RPC không cung cấp được toàn bộ holder; chưa thể xác minh phân bổ, khóa BUY.';
 const status=String(error?.message??'').match(/\bHTTP\s+(\d{3})\b/)?.[1];
 const known=new Map([
  ['Token program không hỗ trợ.','TOKEN_PROGRAM_UNSUPPORTED: token program không hỗ trợ'],
  ['Token còn quyền mint/freeze hoặc chưa kiểm chứng.','AUTHORITY_NOT_REVOKED: mint/freeze còn quyền hoặc chưa kiểm chứng'],
  ['Thông tin mint không hợp lệ.','MINT_DATA_INVALID: thông tin mint không hợp lệ'],
  ['Token-2022 có transferFee/transferHook/permanentDelegate hoặc extension chưa hỗ trợ.','TOKEN_EXTENSION_UNSUPPORTED: extension Token-2022 bị chặn'],
  ['Pool không khớp mint/PDA.','POOL_IDENTITY_MISMATCH: pool không khớp mint/PDA'],
  ['Không có route mua.','NO_BUY_ROUTE: Jupiter không có đường mua'],
  ['Không có route bán.','NO_SELL_ROUTE: Jupiter không có đường bán'],
  ['Quote vòng thiếu impact/đã cũ.','ROUND_TRIP_INVALID: quote vòng thiếu impact hoặc đã cũ'],
  ['Jupiter quote slot không còn mới.','QUOTE_SLOT_STALE: slot quote đã cũ'],
  ['Các RPC đã cấu hình đang lỗi hoặc giới hạn lượt gọi; thử kết nối lại sau.','RPC_UNAVAILABLE: RPC lỗi hoặc đang giới hạn lượt gọi']
 ]);
 const network={ENOTFOUND:'DNS không phân giải được',EAI_AGAIN:'DNS tạm thời không phản hồi',ECONNRESET:'kết nối bị ngắt',ECONNREFUSED:'kết nối bị từ chối',UND_ERR_CONNECT_TIMEOUT:'hết thời gian kết nối'};
 const code=error?.cause?.code??error?.code;
 const detail=status?'HTTP '+status:known.get(error?.message)??(typeof code==='string'&&Object.hasOwn(network,code)?`${code}: ${network[code]}`:['TimeoutError','AbortError'].includes(error?.name)?'TIMEOUT: hết thời gian chờ':error instanceof SyntaxError?'INVALID_JSON: phản hồi JSON không hợp lệ':'UNCLASSIFIED: dữ liệu chưa xác minh');
 return `${provider}: ${detail}; khóa BUY, thử lại ở vòng quét sau.`;
}
const reusable=(cached,now,ttl=VERIFICATION_CACHE_MS)=>cached&&cached.at<=now&&now-cached.at<(cached.value?.verificationError?SCAN_RULES.intervalMs:ttl);
/** Partial RugCheck facts; absent information never becomes zero/true. */
export function rugEvidence(report,market,now=Date.now()){
 if(report?.mint!==market.mint||!report.token||typeof report.token!=='object')throw Error('RugCheck trả sai token hoặc thiếu cấu trúc.');
 const out={...(typeof report.creator==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(report.creator)?{creatorAddress:report.creator}:{}),mint:market.mint,pairAddress:market.pairAddress,checkedAt:now,source:'rugcheck-partial',rugFetchedAt:now};
 if(Object.hasOwn(report.token,'mintAuthority'))out.mintRevoked=report.token.mintAuthority===null;
 if(Object.hasOwn(report.token,'freezeAuthority'))out.freezeRevoked=report.token.freezeAuthority===null;
 const pool=Array.isArray(report.markets)?report.markets.find(p=>p.pubkey===market.pairAddress):null;
 const secured=[pool?.lp?.lpLockedPct,pool?.lp?.lpBurnedPct].filter(v=>Number.isFinite(v)&&v>=0&&v<=100);if(secured.length)out.lpSecuredPct=Math.max(...secured);
 if(Array.isArray(report.risks)&&report.risks.every(r=>typeof r.name==='string'&&['danger','warn','info'].includes(r.level))){out.riskWarningsChecked=true;out.criticalWarnings=report.risks.filter(r=>r.level==='danger').map(r=>r.name.slice(0,120));}
 return out;
}
export class VerificationFeed{
 constructor(fetcher=globalThis.fetch,execution=null,options={}){
  const {rankMarket:analyst=rankMarket,ignoreH4=false,compareCandidates=null,cacheMs=VERIFICATION_CACHE_MS,quoteTracked=true,requireConfirmedQuote=false,...providerOptions}=options;this.rank=analyst;this.ignoreH4=ignoreH4;this.quoteTracked=quoteTracked;this.requireConfirmedQuote=requireConfirmedQuote;this.compareCandidates=compareCandidates;if(!Number.isFinite(cacheMs)||cacheMs<SCAN_RULES.intervalMs||cacheMs>VERIFICATION_CACHE_MS)throw Error('Invalid verification cache lifetime');this.cacheMs=cacheMs;
  this.fetcher=fetcher;this.reportFetch=backoffFetch(fetcher,{provider:'RugCheck',...providerOptions});this.structureFetch=backoffFetch(fetcher,{provider:'OHLCV',...providerOptions});this.execution=execution;
  this.cache=new Map();this.reports=new Map();this.facts=new Map();this.structures=new Map();this.jobs=new Map();this.h4Memory=new Map();
 }
 targets(markets,tracked,now){return markets.filter(m=>m.dexId==='pumpswap'&&!isPumpCurve(m)&&(tracked.includes(m.mint)||this.rank(m,undefined,now).roughEligible));}
 // Read completed metadata only; keep the market's own price/source timestamps.
 quoteReady(m,value,now){if(!this.requireConfirmedQuote||value?.verificationError)return false;const r=this.rank({...m,...value},undefined,now),size=this.execution?.currentProbeSol,changed=Number.isFinite(size)&&size>0&&Math.abs((value?.evidence?.probeSol??0)-size)>1e-9;return r.preQuoteEligible&&!r.red_flags.includes('UNCONFIRMED_SIGNAL')&&(changed||r.red_flags.some(f=>['ROUND_TRIP_UNVERIFIED','QUOTE_STALE'].includes(f)));}
 applyCached(markets){return markets.map(m=>{const value=this.cache.get(m.mint+':'+m.pairAddress)?.value;return value?{...m,verificationError:null,...value}:{...m};});}
 async enrichCached(markets,tracked=[],now=Date.now()){
  const checkedAt=m=>this.cache.get(m.mint+':'+m.pairAddress)?.at??0;
  const targets=this.targets(markets,tracked,now).sort((a,b)=>checkedAt(a)-checkedAt(b)||Number(tracked.includes(b.mint))-Number(tracked.includes(a.mint))||(this.compareCandidates?.(a,b)??b.volume5mUsd-a.volume5mUsd));
  for(const m of targets){
   const key=m.mint+':'+m.pairAddress,cached=this.cache.get(key);if(this.jobs.size>=2)break;
   if(this.jobs.has(key)||reusable(cached,now,this.cacheMs)&&(!this.quoteTracked&&tracked.includes(m.mint)||!this.quoteReady(m,cached?.value,now)))continue;
   // A candidate is not a tracked holding. Recheck its cheap gates inside the worker.
   const job=this.enrich([m],tracked.includes(m.mint)?[m.mint]:[],now).catch(()=>{}).finally(()=>this.jobs.delete(key));this.jobs.set(key,job);
  }
  return this.applyCached(markets);
 }
 async enrich(markets,tracked=[],now=Date.now()){
  const targets=this.targets(markets,tracked,now).filter(m=>tracked.includes(m.mint)||m.liquidityUsd>=20*m.solUsd).sort((a,b)=>Number(tracked.includes(b.mint))-Number(tracked.includes(a.mint))||(this.compareCandidates?.(a,b)??b.volume5mUsd-a.volume5mUsd)).slice(0,6),results=new Map();
  for(let i=0;i<targets.length;i+=2)await Promise.all(targets.slice(i,i+2).map(async m=>{
   if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m.mint))return;
   const key=m.mint+':'+m.pairAddress,cached=this.cache.get(key);if(reusable(cached,now,this.cacheMs)&&(!this.quoteTracked&&tracked.includes(m.mint)||!this.quoteReady(m,cached?.value,now))){results.set(key,cached.value);return;}
   let value;
   try{
    // Retain a successful report even when the later Jupiter stage fails.
    let report=this.reports.get(m.mint);
    if(!reusable(report,now)){const response=await this.reportFetch('https://api.rugcheck.xyz/v1/tokens/'+encodeURIComponent(m.mint)+'/report',{signal:AbortSignal.timeout(2000)});if(!response.ok)throw Error('HTTP '+response.status);const raw=await response.json();rugEvidence(raw,m,now);report={at:now,value:raw};this.reports.set(m.mint,report);}
    value={evidence:rugEvidence(report.value,m,report.at)};
   }catch(error){value={verificationError:providerFailure('RugCheck',error)};}
   const rugOk=value.evidence?.riskWarningsChecked===true&&value.evidence?.criticalWarnings?.length===0&&value.evidence?.lpSecuredPct>=90;
   if(this.execution&&rugOk){
    let structure=this.structures.get(key);
    if(!reusable(structure,now))try{structure={at:now,value:await fetchStructure(m,this.structureFetch)};this.structures.set(key,structure);}catch{}
    value.evidence={...value.evidence,...structure?.value};
    const current=value.evidence.h4Risk,previous=this.h4Memory.get(key);
    if(current&&['clear','reject'].includes(current.state))this.h4Memory.set(key,current);
    else if(previous?.state==='reject'&&now-previous.checkedAt<=TREND_RULES.h4RejectMemoryMs)value.evidence.h4Risk=previous;
    const h4=value.evidence.h4Risk,h4Rejected=h4?.state==='reject'&&h4.mint===m.mint&&h4.pairAddress===m.pairAddress&&h4.checkedAt<=now&&now-h4.checkedAt<=TREND_RULES.h4RejectMemoryMs;
    let failureStage='On-chain';
    if(!h4Rejected||this.ignoreH4)try{
     // Production separates full owner aggregation/program checks from the quote stage.
     let facts=this.facts.get(key);const creator=value.evidence.creatorAddress;
     if(!reusable(facts,now)||facts.creator!==creator){const inspect=this.execution.inspectMarketFacts??this.execution.inspectMarket;if(inspect){facts={at:now,creator,value:await inspect.call(this.execution,{...m,creatorAddress:creator})};this.facts.set(key,facts);}}
     if(facts)value.evidence={...value.evidence,...facts.value,checkedAt:Math.min(value.evidence.rugFetchedAt,facts.at),mint:m.mint,pairAddress:m.pairAddress,source:'rugcheck+solana-rpc'};
     // No quote for a cheap-filter failure, unsafe holders/LP/program, or a score below entry.
     const quoteRank=this.rank({...m,evidence:value.evidence,verificationError:null},undefined,Date.now());
     if((this.quoteTracked||!tracked.includes(m.mint))&&this.execution.inspectMarketQuote&&quoteRank.preQuoteEligible&&(!this.requireConfirmedQuote||!quoteRank.red_flags.includes('UNCONFIRMED_SIGNAL'))){
      failureStage='Jupiter quote vòng';const proof=await this.execution.inspectMarketQuote(m);value.evidence={...value.evidence,...proof,source:'rugcheck+solana-rpc+jupiter'};
     }
    }catch(error){value.verificationError=providerFailure(failureStage,error);}
   }
   this.cache.set(key,{at:now,value});results.set(key,value);
  }));
  for(const map of [this.cache,this.reports,this.facts,this.structures])for(const [key,v]of map)if(now-v.at>300000)map.delete(key);
  for(const [key,v]of this.h4Memory)if(now-v.checkedAt>TREND_RULES.h4RejectMemoryMs)this.h4Memory.delete(key);
  return markets.map(m=>({...m,...results.get(m.mint+':'+m.pairAddress)}));
 }
}
