import {TRADE_RULES,BUY_LAMPORTS} from './desk-rules.js';
import {SOL} from './engine.js';
async function quote(inputMint,outputMint,amount,slippageBps,fetcher){
 const url=new URL('https://lite-api.jup.ag/swap/v1/quote');for(const [k,v]of Object.entries({inputMint,outputMint,amount,slippageBps,swapMode:'ExactIn'}))url.searchParams.set(k,v);
 const r=await fetcher(url,{signal:AbortSignal.timeout(2500)}),q=await r.json();
 if(['COULD_NOT_FIND_ANY_ROUTE','TOKEN_NOT_TRADABLE'].includes(q.errorCode))return {failed:true};
 if(!r.ok)throw Error('Jupiter quote HTTP '+r.status);
 if(q.inputMint!==inputMint||q.outputMint!==outputMint||q.inAmount!==amount||q.swapMode!=='ExactIn'||!/^\d+$/.test(q.outAmount??'')||!/^\d+$/.test(q.otherAmountThreshold??'')||BigInt(q.outAmount)<=0n||BigInt(q.outAmount)>18446744073709551615n||BigInt(q.otherAmountThreshold)<BigInt(q.outAmount)*BigInt(10000-slippageBps)/10000n||BigInt(q.otherAmountThreshold)>BigInt(q.outAmount)||!Array.isArray(q.routePlan)||!q.routePlan.length||q.slippageBps!==slippageBps||!Number.isSafeInteger(q.contextSlot))throw Error('Jupiter quote không khớp hoặc thiếu dữ liệu.');
 return q;
}
/** Public quote requests only. Never obtains or signs a Jupiter swap transaction. */
export async function jupiterSellQuote({mint,rawAmount},fetcher=globalThis.fetch,now=Date.now()){
 const q=await quote(mint,SOL,rawAmount,300,fetcher);
 if(q.failed)return {mint,rawAmount,checkedAt:now,provider:'Jupiter',failed:true};
 const lamports=BigInt(q.otherAmountThreshold)-25000n;if(lamports<0n||lamports>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Báo giá ròng ngoài phạm vi.');
 return {mint,rawAmount,checkedAt:now,contextSlot:q.contextSlot,netSol:Number(lamports)/1e9,provider:'Jupiter',feeAllowanceSol:.000025,failed:false};
}
export async function jupiterRoundTrip(mint,fetcher=globalThis.fetch){
 const at=Date.now(),buy=await quote(SOL,mint,BUY_LAMPORTS,400,fetcher);if(buy.failed)throw Error('Không có route mua.');
 const sell=await quote(mint,SOL,buy.outAmount,300,fetcher);if(sell.failed)throw Error('Không có route bán.');
 const impact=q=>q.priceImpactPct==null?NaN:Number(q.priceImpactPct)*100,net=BigInt(sell.outAmount)-50000n;
 if(net<0n||net>BigInt(Number.MAX_SAFE_INTEGER)||![impact(buy),impact(sell)].every(Number.isFinite)||Date.now()-at>30000||Math.abs(sell.contextSlot-buy.contextSlot)>20)throw Error('Quote vòng thiếu impact/đã cũ.');
 return {roundTripQuoteOk:true,probeSol:TRADE_RULES.orderSol,roundTripLossPct:Math.max(0,(Number(BUY_LAMPORTS)-Number(net))/Number(BUY_LAMPORTS)*100),buyImpactPct:impact(buy),sellImpactPct:impact(sell),quoteCheckedAt:at,quoteContextSlot:Math.min(buy.contextSlot,sell.contextSlot)};
}
export async function jupiterEntryQuote(mint,amount,fetcher=globalThis.fetch){
 const at=Date.now(),q=await quote(SOL,mint,amount,400,fetcher);if(q.failed||Date.now()-at>30000)throw Error('Không có báo giá vào lệnh mới.');
 return {minOut:q.otherAmountThreshold,contextSlot:q.contextSlot,checkedAt:at};
}
