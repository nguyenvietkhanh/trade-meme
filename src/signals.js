import {isPumpCurve} from './venues.js';
/** Confirm a signal across separate observed quotes; never infer past fills. */
export function observeMarkets(state,markets,now=Date.now()){
 state.observations??={};
 const result=markets.map(m=>{
  const key=m.mint+':'+(m.pairAddress??''),rows=(state.observations[key]??[]).filter(r=>now-r.at<=900000);
  const previous=[...rows].reverse().find(r=>now-r.at>=10000&&now-r.at<=15000);
  const positive=r=>r.change5mPct>0&&(isPumpCurve(m)?r.change1mPct>0:r.change1hPct>0)&&r.buys5m>=8&&r.buys5m+r.sells5m>=15;
  const fresh=t=>Number.isFinite(t)&&t<=now&&now-t<=30000;
  const watermark=typeof m.activityWatermark==='string'&&m.activityWatermark.length<=256?m.activityWatermark:null;
  const independent=!!previous&&fresh(m.updatedAt)&&(isPumpCurve(m)?fresh(m.activityCheckedAt)&&!!watermark&&!!previous.watermark&&watermark!==previous.watermark&&m.activityCheckedAt>previous.sourceAt:Number.isFinite(previous.sourceAt)&&m.updatedAt>previous.sourceAt);
  const confirmed=independent&&positive(previous)&&positive(m)&&rows.filter(r=>r.at>previous.at).every(positive)&&m.liquidityUsd>=previous.liquidityUsd*.85&&m.priceUsd>=previous.priceUsd;
  if(!rows.length||rows.at(-1).at<now)rows.push({at:now,sourceAt:isPumpCurve(m)?m.activityCheckedAt:m.updatedAt,watermark,priceUsd:m.priceUsd,liquidityUsd:m.liquidityUsd,change5mPct:m.change5mPct,change1mPct:m.change1mPct,change1hPct:m.change1hPct,buys5m:m.buys5m,sells5m:m.sells5m});
  state.observations[key]=rows.slice(-20);
  return {...m,signalConfirmed:confirmed,setup:previous?{kind:'observed-momentum',anchorPriceUsd:previous.priceUsd,priceChangePct:(m.priceUsd/previous.priceUsd-1)*100,liquidityRetention:m.liquidityUsd/previous.liquidityUsd,observationGapMs:now-previous.at}:null};
 });
 const keys=Object.keys(state.observations).sort((a,b)=>(state.observations[b].at(-1)?.at??0)-(state.observations[a].at(-1)?.at??0));
 for(const key of keys)if(now-(state.observations[key].at(-1)?.at??0)>900000)delete state.observations[key];
 for(const key of keys.slice(300))delete state.observations[key];
 return result;
}
