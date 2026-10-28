// V5.2 entry alternative: only observed RPC/market/quote facts; unknown research stays unknown.
export const ENTRY_RULES_VERSION='pumpfun-rules-v5.2';
export const MIN_RULES_SCORE=6;
export const MOMENTUM_LIMITS=Object.freeze({minQuoteReserveSol:5,minHolders:20,minBuys5m:5,minTrades5m:8,minBuySellRatio:1.1,minVolume5mSol:.5,maxChange5mPct:100});
export function momentumChecks(i,o={}){
 const l=MOMENTUM_LIMITS;
 return {positive_momentum:Number.isFinite(i.change_5m_pct)&&i.change_5m_pct>0&&i.change_5m_pct<=l.maxChange5mPct,
  active_flow:Number.isFinite(i.buys_5m)&&Number.isFinite(i.sells_5m)&&i.buys_5m>=l.minBuys5m&&i.buys_5m+i.sells_5m>=l.minTrades5m&&i.buys_5m/Math.max(1,i.sells_5m)>=l.minBuySellRatio&&i.volume_5m_sol>=l.minVolume5mSol,
  real_depth:i.quote_reserve_sol>=l.minQuoteReserveSol&&i.holder_count>=l.minHolders,
  no_observed_creator_sell:o.creatorSoldRecently!==true,no_observed_bundle:o.suspectedBundle!==true};
}
export function momentumScore(i,z){
 const pos=[],neg=[];
 const add=(points,reason)=>(points>0?pos:neg).push({points,reason});
 if(i.top10_pct<15)add(3,'top10 <15%');else if(i.top10_pct<=20)add(2,'top10 <=20%');else if(i.top10_pct<=25)add(1,'top10 <=25%');
 if(i.dev_wallet_pct<3)add(2,'dev <3%');else if(i.dev_wallet_pct<=5)add(1,'dev <=5%');
 if(i.change_5m_pct>0&&i.change_5m_pct<=100)add(2,'positive 5m momentum, not >100%');
 if(i.buys_5m/Math.max(1,i.sells_5m)>=1.2)add(1,'5m buy/sell >=1.2');
 if(i.volume_5m_sol>=2)add(1,'5m traded volume >=2 SOL');
 if(i.quote_reserve_sol>=10)add(1,'real quote reserve >=10 SOL');
 if(z.friction>6)add(-2,'roundtrip >6%');
 return {pos,neg};
}
