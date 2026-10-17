import {AUDIT_RULES,STRATEGY_VERSION} from './desk-rules.js';
export function auditDesk(s,now=Date.now()){
 const trades=s.trades.filter(t=>t.side==='SELL'&&t.closed&&Number.isFinite(t.positionPnlSol)&&t.at>=now-7*86400000&&t.at<=now),measured=trades.filter(t=>Number.isFinite(t.initialRiskSol)&&t.initialRiskSol>0);
 const count=trades.length,winRate=count?trades.filter(t=>t.positionPnlSol>0).length/count:null,expectancyR=measured.length?measured.reduce((sum,t)=>sum+t.positionPnlSol/t.initialRiskSol,0)/measured.length:null;
 const drawdown=Number.isFinite(s.maxDrawdownObservedPct)?s.maxDrawdownObservedPct:null;
 const complete=count>=AUDIT_RULES.minClosedTrades&&measured.length===count&&drawdown!==null;
 return {strategyVersion:STRATEGY_VERSION,windowDays:7,networkFeesSol:[...s.trades.filter(t=>Number.isFinite(t.networkFeeSol)).map(t=>({at:t.at,feeSol:t.networkFeeSol})),...(s.payouts??[]),...(s.expenses??[])].filter(t=>t.at>=now-7*86400000&&t.at<=now).reduce((sum,t)=>sum+(t.feeSol??0),0),unknownNetworkFees:s.trades.filter(t=>t.networkFeeSol==null).length,closedTrades:count,measuredTrades:measured.length,winRate,expectancyR,maxDrawdownPct:drawdown,status:!complete?'insufficient-data':winRate>=AUDIT_RULES.minWinRate&&expectancyR>=AUDIT_RULES.minExpectancyR&&drawdown<=AUDIT_RULES.maxDrawdownPct?'passed':'review',thresholds:AUDIT_RULES,stalePositions:s.positions.filter(p=>now-p.openedAt>=AUDIT_RULES.stalePositionMs).map(p=>p.mint),unmeasuredSlippage:s.trades.filter(t=>t.slippageBpsObserved==null).length};
}
