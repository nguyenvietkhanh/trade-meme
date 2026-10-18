import {validBuyLamports} from './desk-rules.js';
import {SOL} from './engine.js';
// Exact-request cache, successful validated responses only. Original observation time is retained.
// Per execution/fetcher isolation prevents sharing a quote across providers or test/live instances.
const quoteCaches=new WeakMap(),QUOTE_CACHE_MS=2000;
async function quote(inputMint,outputMint,amount,slippageBps,fetcher){
 let cache=quoteCaches.get(fetcher);if(!cache){cache=new Map();quoteCaches.set(fetcher,cache);}
 const key=[inputMint,outputMint,amount,slippageBps,'ExactIn'].join(':'),now=Date.now(),prior=cache.get(key);
 if(prior&&(!prior.settled||now>=prior.at&&now-prior.at<QUOTE_CACHE_MS))return prior.task;
 const entry={at:now,task:null,settled:false};
 const read=()=>requestQuote(inputMint,outputMint,amount,slippageBps,fetcher,Date.now());
 entry.task=(fetcher.scheduleQuote?fetcher.scheduleQuote(read):read()).then(q=>{entry.settled=true;if(q.failed&&cache.get(key)===entry)cache.delete(key);return q;}).catch(error=>{entry.settled=true;if(cache.get(key)===entry)cache.delete(key);throw error;});
 cache.set(key,entry);for(const [k,v]of cache)if(v.settled&&now-v.at>=QUOTE_CACHE_MS)cache.delete(k);
 while(cache.size>256)cache.delete(cache.keys().next().value);
 return entry.task;
}
async function requestQuote(inputMint,outputMint,amount,slippageBps,fetcher,observedAt){
 const url=new URL('https://lite-api.jup.ag/swap/v1/quote');for(const [k,v]of Object.entries({inputMint,outputMint,amount,slippageBps,swapMode:'ExactIn'}))url.searchParams.set(k,v);
 const r=await fetcher(url,{signal:AbortSignal.timeout(2500)});let q;try{q=await r.json();}catch{throw Error(r.ok?'Jupiter quote thiếu JSON hợp lệ.':'Jupiter quote HTTP '+r.status);}
 if(['COULD_NOT_FIND_ANY_ROUTE','TOKEN_NOT_TRADABLE'].includes(q.errorCode))return {failed:true};
 if(!r.ok)throw Error('Jupiter quote HTTP '+r.status);
 if(q.inputMint!==inputMint||q.outputMint!==outputMint||q.inAmount!==amount||q.swapMode!=='ExactIn'||!/^\d+$/.test(q.outAmount??'')||!/^\d+$/.test(q.otherAmountThreshold??'')||BigInt(q.outAmount)<=0n||BigInt(q.outAmount)>18446744073709551615n||BigInt(q.otherAmountThreshold)<BigInt(q.outAmount)*BigInt(10000-slippageBps)/10000n||BigInt(q.otherAmountThreshold)>BigInt(q.outAmount)||!Array.isArray(q.routePlan)||!q.routePlan.length||q.slippageBps!==slippageBps||!Number.isSafeInteger(q.contextSlot))throw Error('Jupiter quote không khớp hoặc thiếu dữ liệu.');
 return {...q,observedAt};
}
/** Public quote requests only. Never obtains or signs a Jupiter swap transaction. */
export async function jupiterSellQuote({mint,rawAmount},fetcher=globalThis.fetch,now=Date.now()){
 const q=await quote(mint,SOL,rawAmount,300,fetcher);now=Math.min(now,q.observedAt??now);
 if(q.failed)return {mint,rawAmount,checkedAt:now,provider:'Jupiter',failed:true};
 const lamports=BigInt(q.otherAmountThreshold)-25000n;if(lamports<0n||lamports>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Báo giá ròng ngoài phạm vi.');
 return {mint,rawAmount,checkedAt:now,contextSlot:q.contextSlot,netSol:Number(lamports)/1e9,provider:'Jupiter',feeAllowanceSol:.000025,failed:false};
}
export async function jupiterRoundTrip(mint,fetcher=globalThis.fetch,orderSol){
 const input=String(Math.round(orderSol*1e9));if(!validBuyLamports(input))throw Error('Cần cỡ lệnh SOL hợp lệ để kiểm tra quote vòng.');
 const at=Date.now(),buy=await quote(SOL,mint,input,400,fetcher);if(buy.failed)throw Error('Không có route mua.');
 const sell=await quote(mint,SOL,buy.outAmount,300,fetcher);if(sell.failed)throw Error('Không có route bán.');
 const impact=q=>q.priceImpactPct==null?NaN:Number(q.priceImpactPct)*100,net=BigInt(sell.outAmount)-50000n;
 if(net<0n||net>BigInt(Number.MAX_SAFE_INTEGER)||![impact(buy),impact(sell)].every(Number.isFinite)||Date.now()-at>30000||Math.abs(sell.contextSlot-buy.contextSlot)>20)throw Error('Quote vòng thiếu impact/đã cũ.');
 return {roundTripQuoteOk:true,probeSol:orderSol,roundTripLossPct:Math.max(0,(Number(input)-Number(net))/Number(input)*100),buyImpactPct:impact(buy),sellImpactPct:impact(sell),quoteCheckedAt:Math.min(at,buy.observedAt,sell.observedAt),quoteContextSlot:Math.min(buy.contextSlot,sell.contextSlot)};
}
export async function jupiterEntryQuote(mint,amount,fetcher=globalThis.fetch){
 const at=Date.now(),q=await quote(SOL,mint,amount,400,fetcher);if(q.failed||Date.now()-at>30000)throw Error('Không có báo giá vào lệnh mới.');
 return {minOut:q.otherAmountThreshold,contextSlot:q.contextSlot,checkedAt:Math.min(at,q.observedAt)};
}
