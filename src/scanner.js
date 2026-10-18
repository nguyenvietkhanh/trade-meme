import {coarseMarket} from './strategy.js';

export const SCAN_RULES=Object.freeze({intervalMs:5000,cycleLimit:10000,recentDecisions:300});
const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
function nextCycle(state,now){
 const stats=state.decisionStats;
 stats.evaluated=0;stats.rejected=0;stats.cycle++;stats.resetAt=now;
 state.decisions=[];
}
/** Scanner housekeeping must never reset positions, signatures or trading risk limits. */
export function initializeScanner(state,now=Date.now()){
 delete state.coarseCooldowns;
 state.decisions??=[];
 const stats=state.decisionStats??={};
 stats.evaluated=count(stats.evaluated);stats.rejected=count(stats.rejected);stats.bought=count(stats.bought);
 stats.totalEvaluated=Math.max(count(stats.totalEvaluated),stats.evaluated);
 stats.cycle=Math.max(1,count(stats.cycle));
 if(stats.evaluated>=SCAN_RULES.cycleLimit)nextCycle(state,now);
}
export function scannerMarkets(state,markets){
 delete state.coarseCooldowns;
 state.blacklistedMints??={};
 return markets.map(m=>{
  const {coarseCooldownUntil,...market}=m;
  if(coarseMarket(market).red_flags.includes('MAJOR_TOKEN_OR_IMPERSONATOR'))state.blacklistedMints[market.mint]=true;
  return {...market,blacklisted:state.blacklistedMints[market.mint]===true};
 });
}
export function recordEvaluation(state,decision){
 initializeScanner(state,decision.at);
 const stats=state.decisionStats;
 stats.evaluated++;stats.totalEvaluated++;
 if(decision.action==='SKIP')stats.rejected++;
 state.decisions.unshift(decision);state.decisions=state.decisions.slice(0,SCAN_RULES.recentDecisions);
 if(stats.evaluated>=SCAN_RULES.cycleLimit)nextCycle(state,decision.at);
}
