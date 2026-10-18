import {coarseMarket} from './strategy.js';

export const SCAN_RULES=Object.freeze({intervalMs:5000,cycleLimit:10000,recentDecisions:300,skipDisplayMs:30000});
const displayCache=new WeakMap();
const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
function nextCycle(state,now){
 const stats=state.decisionStats;
 stats.evaluated=0;stats.rejected=0;stats.cycle++;stats.resetAt=now;
 state.decisions=[];displayCache.delete(state);
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
 // Deduplicate display only. Counters and the separate research journal retain every evaluation.
 let seen=displayCache.get(state);if(!seen){seen=new Map();displayCache.set(state,seen);}
 const key=decision.mint+':'+(decision.pairAddress??''),fingerprint=JSON.stringify([decision.action,decision.blockingStage,decision.primaryFlags??decision.reason,String(decision.reason??'').match(/HTTP\s+\d{3}/)?.[0]??null]),prior=seen.get(key);
 const duplicate=decision.action==='SKIP'&&prior?.fingerprint===fingerprint&&decision.at>=prior.at&&decision.at-prior.at<SCAN_RULES.skipDisplayMs;
 if(duplicate){const row=state.decisions.find(row=>row===prior.row);if(row){row.lastSeenAt=decision.at;row.repeats=(row.repeats??1)+1;row.score=decision.score;row.reason=decision.reason;row.decision=decision.decision;}}
 else{state.decisions.unshift(decision);state.decisions=state.decisions.slice(0,SCAN_RULES.recentDecisions);seen.set(key,{fingerprint,at:decision.at,row:decision});}
 for(const [key,v]of seen)if(decision.at-v.at>=SCAN_RULES.skipDisplayMs)seen.delete(key);
 while(seen.size>600)seen.delete(seen.keys().next().value);
 if(stats.evaluated>=SCAN_RULES.cycleLimit)nextCycle(state,decision.at);
}
