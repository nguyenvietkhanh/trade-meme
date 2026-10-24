import {TRADE_RULES} from './desk-rules.js';
// Research parameters only: no measured edge or promise of profit.
export const PAPER_NORMAL_HAIRCUT_BPS=150;
export const SCALP_V1_VERSION='paper-5m-scalp-v1';
export const SCALP_V2_VERSION='paper-5m-continuation-v2';
export const SCALP_V3_VERSION='paper-5m-multi-v3';
export const SCALP_V4_VERSION='paper-5m-persistence-v4';
export const SCALP_STRATEGY_VERSION='paper-5m-risk-v5';
export const isScalpVersion=version=>[SCALP_V1_VERSION,SCALP_V2_VERSION,SCALP_V3_VERSION,SCALP_V4_VERSION,SCALP_STRATEGY_VERSION].includes(version);
export const SCALP_V1_ENTRY_RULES=Object.freeze({version:SCALP_V1_VERSION,minScore:40,minChange5mPct:5,maxChange5mPct:100,minVolume5mUsd:500,minBuys5m:5,minTrades5m:10,minBuySellRatio:1.1,confirmationGapMs:5000,maxConfirmationGapMs:15000,minPriceRetention:.995,minLiquidityRetention:.9,maxQuoteAgeMs:10000});
export const SCALP_V3_ENTRY_RULES=Object.freeze({...SCALP_V1_ENTRY_RULES,version:SCALP_V3_VERSION,maxConfirmationRisePct:TRADE_RULES.buySlippageCapBps/100,requireIncrementalBuyDominance:true});
export const SCALP_ENTRY_RULES=Object.freeze({...SCALP_V3_ENTRY_RULES,version:SCALP_STRATEGY_VERSION,minConfirmationObservations:3,minPersistenceMs:10000,maxPersistenceMs:30000,maxModeledRoundTripPct:TRADE_RULES.maxRoundTripCostPct,reentryMs:TRADE_RULES.reentryMs});
// Screening estimate at unchanged route/price, not another executable quote.
// The verified exact-size quote gate still applies; AMM nonlinearity is not modeled here.
export function modeledNormalRoundTripPct(rawLossPct,haircutBps=PAPER_NORMAL_HAIRCUT_BPS){return Number.isFinite(rawLossPct)&&rawLossPct>=0?100*(1-(1-rawLossPct/100)*(1-haircutBps/10000)**2):null;}
export function persistentContinuation(rows,now=Date.now(),r=SCALP_ENTRY_RULES){
 if(!Array.isArray(rows)||rows.length!==r.minConfirmationObservations)return false;
 const first=rows[0],last=rows.at(-1),finite=Number.isFinite;
 if(!rows.every(x=>x&&[x.at,x.sourceAt,x.priceUsd,x.liquidityUsd].every(finite)&&x.priceUsd>0&&x.liquidityUsd>0&&x.sourceAt<=x.at&&x.at<=now&&Number.isSafeInteger(x.buys5m)&&x.buys5m>=0&&Number.isSafeInteger(x.sells5m)&&x.sells5m>=0))return false;
 if(now-last.at>r.maxConfirmationGapMs||last.at-first.at<r.minPersistenceMs||last.at-first.at>r.maxPersistenceMs||(last.priceUsd/first.priceUsd-1)*100>r.maxConfirmationRisePct+1e-9)return false;
 return rows.slice(1).every((x,i)=>{const p=rows[i],gap=x.at-p.at,db=x.buys5m-p.buys5m,ds=x.sells5m-p.sells5m;return gap>=r.confirmationGapMs&&gap<=r.maxConfirmationGapMs&&x.sourceAt>p.sourceAt&&x.priceUsd>p.priceUsd&&x.liquidityUsd>=p.liquidityUsd*r.minLiquidityRetention&&x.liquidityUsd>=first.liquidityUsd*r.minLiquidityRetention&&db>=0&&ds>=0&&db>ds;});
}
export function comparePaperEntries(a,b){return number(a.evidence?.roundTripLossPct,Infinity)-number(b.evidence?.roundTripLossPct,Infinity)||number(b.scalpSetup?.netNewBuys,0)-number(a.scalpSetup?.netNewBuys,0)||number(b.score,0)-number(a.score,0)||compare5m(a,b);}
export const SCALP_EXIT_RULES=Object.freeze({version:SCALP_STRATEGY_VERSION,stopLossPct:12,firstProfitPct:15,firstSellFraction:.5,finalProfitPct:30,trailingPct:8,stallMs:180000,stallGainPct:5,maxHoldMs:600000,maxQuoteAgeMs:10000});
const number=(x,fallback=-Infinity)=>Number.isFinite(x)?x:fallback;
export function compare5m(a,b){return number(b.change5mPct)-number(a.change5mPct)||number(b.score,0)-number(a.score,0)||number(b.volume5mUsd,0)-number(a.volume5mUsd,0)||String(a.mint??'').localeCompare(String(b.mint??''));}

/** Net quote returns, including allocated BUY costs and modeled SELL fee. Never use spot PnL. */
export function scalpExitPlan(position,market,now=Date.now()){
 const q=market?.exitQuote,r=position.exitPolicy;
 if(!isScalpVersion(r?.version))return null;
 const finite=Number.isFinite;
 const marketFresh=finite(market?.updatedAt)&&market.updatedAt<=now&&now-market.updatedAt<=30000;
 let emergency=false;if(marketFresh){position.peakLiquidityUsd=Math.max(position.peakLiquidityUsd??position.entryLiquidityUsd??0,finite(market.liquidityUsd)?market.liquidityUsd:0);
  emergency=finite(market.liquidityUsd)&&market.liquidityUsd<position.peakLiquidityUsd*.6||market.evidence?.lpWithdrawn===true||market.evidence?.largeHolderDump===true||market.evidence?.sellSimulationOk===false;
  if(emergency&&r.exitPriority!=='sl-tp-time-first')return {reason:'emergency-risk',fraction:1};
 }
 const fresh=q?.mint===position.mint&&q.rawAmount===position.rawQuantity&&finite(q.netSol)&&q.netSol>=0&&finite(q.checkedAt)&&q.checkedAt<=now&&now-q.checkedAt<=r.maxQuoteAgeMs;
 if(!fresh){if(now-position.openedAt>=r.maxHoldMs)return {reason:'scalp-max-hold',fraction:1};return emergency?{reason:'emergency-risk',fraction:1}:null;}
 if(!(position.quantity>0&&position.costSol>0))return null;
 const roi=(q.netSol/position.costSol-1)*100,unit=q.netSol/position.quantity;
 position.scalpPeakUnitSol=Math.max(position.scalpPeakUnitSol??unit,unit);
 position.scalpMaxGainPct=Math.max(position.scalpMaxGainPct??roi,roi);
 const trigger={at:now,quoteCheckedAt:q.checkedAt,expectedNetSol:q.netSol,remainingRaw:position.rawQuantity,roiPct:roi,provider:q.provider??null};
 const plan=(reason,fraction=1)=>({reason,fraction,trigger:{...trigger,expectedNetSol:trigger.expectedNetSol*fraction}});
 if(roi<=-r.stopLossPct+1e-9)return plan('stop-loss');
 if(r.exitPriority==='sl-tp-time-first'){
  if(roi>=r.finalProfitPct-1e-9)return plan('scalp-tp2');
  if(!position.scalpFirstTaken&&roi>=r.firstProfitPct-1e-9)return plan('scalp-tp1',r.firstSellFraction);
  if(now-position.openedAt>=r.maxHoldMs)return plan('scalp-max-hold');
  if(!position.scalpFirstTaken&&now-position.openedAt>=r.stallMs&&position.scalpMaxGainPct<r.stallGainPct)return plan('scalp-stall');
  if(position.scalpFirstTaken&&unit<=position.scalpPeakUnitSol*(1-r.trailingPct/100)*(1+1e-12))return plan('runner-trailing');
  return emergency?plan('emergency-risk'):null;
 }
 if(position.scalpFirstTaken&&unit<=position.scalpPeakUnitSol*(1-r.trailingPct/100)*(1+1e-12))return plan('runner-trailing');
 if(now-position.openedAt>=r.maxHoldMs)return plan('scalp-max-hold');
 if(roi>=r.finalProfitPct-1e-9)return plan('scalp-tp2');
 if(!position.scalpFirstTaken&&roi>=r.firstProfitPct-1e-9)return plan('scalp-tp1',r.firstSellFraction);
 if(!position.scalpFirstTaken&&now-position.openedAt>=r.stallMs&&position.scalpMaxGainPct<r.stallGainPct)return plan('scalp-stall');
 return null;
}
