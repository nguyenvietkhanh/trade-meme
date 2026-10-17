/** Confirm a signal across separate observed quotes; never infer past fills. */
export function observeMarkets(state,markets,now=Date.now()){
 state.observations??={};
 const result=markets.map(m=>{
  const key=m.mint+':'+(m.pairAddress??''),rows=(state.observations[key]??[]).filter(r=>now-r.at<=900000);
  const previous=[...rows].reverse().find(r=>now-r.at>=30000&&now-r.at<=180000);
  const positive=r=>r.change5mPct>=1&&r.change5mPct<=12&&r.buys5m>=10&&r.buys5m>r.sells5m*1.3;
  const confirmed=!!previous&&positive(previous)&&positive(m)&&m.liquidityUsd>=previous.liquidityUsd*.85&&m.priceUsd>=previous.priceUsd*.98;
  if(!rows.length||rows.at(-1).at<now)rows.push({at:now,priceUsd:m.priceUsd,liquidityUsd:m.liquidityUsd,change5mPct:m.change5mPct,buys5m:m.buys5m,sells5m:m.sells5m});
  state.observations[key]=rows.slice(-20);
  return {...m,signalConfirmed:confirmed};
 });
 const keys=Object.keys(state.observations).sort((a,b)=>(state.observations[b].at(-1)?.at??0)-(state.observations[a].at(-1)?.at??0));
 for(const key of keys)if(now-(state.observations[key].at(-1)?.at??0)>900000)delete state.observations[key];
 for(const key of keys.slice(300))delete state.observations[key];
 return result;
}
