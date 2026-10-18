// Explicit allowlists: training exports must never copy credentials or signed transactions.
import {STRATEGY_VERSION} from './desk-rules.js';
import {rankMarket} from './strategy.js';
const numeric=(o,keys)=>Object.fromEntries(keys.map(k=>[k,Number.isFinite(o?.[k])?o[k]:null]));
const text=v=>typeof v==='string'?v.slice(0,150):null;
export function entryFeatures(m,solUsd,proof){
 const evidence={...m.evidence,...proof},r=rankMarket({...m,evidence,solUsd});
 return {venue:m.venue??m.dexId??null,creatorRugHistory:'unknown',capturedAt:Date.now(),strategyVersion:STRATEGY_VERSION,solUsd,
  market:{...numeric(m,['updatedAt','pairCreatedAt','priceUsd','valuationUsd','liquidityUsd','liquidityQuoteSol','volume5mUsd','volume1hUsd','volume24hUsd','change5mPct','change1hPct','change6hPct','buys5m','sells5m','buys1h','sells1h','change1mPct','volume1mUsd','buys1m','sells1m','uniqueBuyers5m','activityCheckedAt']),dexId:text(m.dexId),valuationSource:text(m.valuationSource),hasProfile:typeof m.hasProfile==='boolean'?m.hasProfile:null,boosted:m.boosted===true},
  safety:{...numeric(evidence,['checkedAt','lpSecuredPct','top10Pct','largestHolderPct','devPct','holderCount','quoteReserveSol','probeSol','curveProgressPct','roundTripLossPct','buyImpactPct','sellImpactPct']),mintRevoked:evidence.mintRevoked===true,freezeRevoked:evidence.freezeRevoked===true,tokenProgram:text(evidence.tokenProgram),extensionsSafe:typeof evidence.extensionsSafe==='boolean'?evidence.extensionsSafe:null},
  structure:{...numeric(evidence,['pullback30mPct','candleLastClosedAt']),higherLows:typeof evidence.higherLows==='boolean'?evidence.higherLows:null,greenCandleConfirmed:typeof evidence.greenCandleConfirmed==='boolean'?evidence.greenCandleConfirmed:null,h4State:text(evidence.h4Risk?.state),h4: numeric(evidence.h4Risk,['checkedAt','barAt','redDropPct','retreatPct','upperWickFraction'])},
  signalConfirmed:m.signalConfirmed===true,score:r.score,scoreParts:r.scoreParts,missingScoreData:r.missingScoreData,penalties:numeric(r,['washPenalty','boostPenalty','h4Penalty'])};
}
export function trainingRecord(state,trade,intent={},position=null,result={}){
 if(trade.mode!=='live'||typeof trade.signature!=='string'||!trade.signature||!Number.isFinite(trade.at))return null;
 const entry=position?.trainingEntry??null;
 return {schemaVersion:1,owner:state.owner,id:trade.signature,strategyVersion:intent.strategyVersion??entry?.features?.strategyVersion??null,
  mint:text(trade.mint??intent.mint),pairAddress:text(intent.pairAddress??position?.pairAddress),symbol:text(trade.symbol),side:trade.side,at:trade.at,signature:trade.signature,venue:intent.venue??position?.venue??null,
  ...numeric(trade,['quantity','priceUsd','sol','pnlSol','networkFeeSol','fraction','positionPnlSol','remainingQuantity']),exitTrigger:intent.exitTrigger?{...numeric(intent.exitTrigger,['at','quoteCheckedAt','expectedNetSol']),provider:text(intent.exitTrigger.provider)}:null,executionVsTriggerPct:trade.side==='SELL'&&intent.exitTrigger?.expectedNetSol>0?(trade.sol/intent.exitTrigger.expectedNetSol-1)*100:null,reason:text(trade.reason),closed:trade.closed===true,
  slot:Number.isSafeInteger(result.slot)?result.slot:null,tokenDelta:typeof result.tokenDelta==='string'?result.tokenDelta:null,decimals:Number.isInteger(result.decimals)?result.decimals:null,
  positionRoiPct:trade.closed&&Number.isFinite(trade.positionPnlSol)&&position?.initialCostSol>0?100*trade.positionPnlSol/position.initialCostSol:null,holdingMs:position&&Number.isFinite(position.openedAt)?trade.at-position.openedAt:null,
  position:position?{...numeric(position,['openedAt','initialCostSol','initialQuantity','entryPriceUsd','entrySolUsd','maxGainPct','runnerSteps']),originVenue:position.venue??null,entrySignature:entry?.signature??null,entryFeatures:entry?.features??null,executions:position.trainingFills??[]}:null,
  entryFeatures:trade.side==='BUY'?intent.entryFeatures??null:entry?.features??null,
  dataQuality:trade.side==='BUY'?intent.entryFeatures?'entry-snapshot':'historical-incomplete':entry?.features?'entry-snapshot':'historical-incomplete'};
}
export function enqueueTrainingRecord(state,trade,intent,position,result){
 const record=trainingRecord(state,trade,intent,position,result);if(!record)return;
 state.trainingOutbox??=[];if(!state.trainingOutbox.some(r=>r.id===record.id))state.trainingOutbox.push(structuredClone(record));
}
