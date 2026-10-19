import {rankMarket} from './strategy.js';
import {rankPaperMarket} from './paper-policy.js';
const HORIZONS=[60000,300000,900000,1800000],MAX_PENDING=4000;
/** Passive price labels use only already-fetched snapshots. No extra quotes/RPC, no fills. */
export function observePaperOutcomes(state,markets,journal,now=Date.now()){
 state.paperOutcomes??=[];state.paperOutcomeSeeds??={};state.paperOutcomeStats??={created:0,labeled:0,missing:0,dropped:0};
 const index=new Map(markets.map(m=>[m.mint+':'+m.pairAddress,m])),remaining=[];
 for(const row of state.paperOutcomes){const m=index.get(row.key);for(const horizon of HORIZONS){if(row.done.includes(horizon)||now<row.at+horizon)continue;const valid=m&&m.updatedAt>=row.at+horizon&&m.updatedAt<=row.at+horizon+15000&&now-m.updatedAt<=30000&&m.priceUsd>0;
   if(valid){journal.enqueue({type:'paper_forward_label',at:now,mint:row.mint,pairAddress:row.pairAddress,seedAt:row.at,horizonMs:horizon,observedAt:m.updatedAt,delayMs:m.updatedAt-(row.at+horizon),spotReturnPct:(m.priceUsd/row.priceUsd-1)*100,initialLiquidityUsd:row.liquidityUsd,observedLiquidityUsd:m.liquidityUsd,baseline:row.baseline,paper:row.paper,notExecutablePnl:true});state.paperOutcomeStats.labeled++;row.done.push(horizon);}
   else if(now>row.at+horizon+15000){journal.enqueue({type:'paper_forward_label_missing',at:now,mint:row.mint,pairAddress:row.pairAddress,seedAt:row.at,horizonMs:horizon,reason:'No independently timestamped market snapshot in the 15s horizon window; never infer a return.'});state.paperOutcomeStats.missing++;row.done.push(horizon);}
  }if(row.done.length<HORIZONS.length)remaining.push(row);
 }
 state.paperOutcomes=remaining;
 for(const m of markets){if(m.dexId!=='pumpswap'||!Number.isFinite(m.priceUsd)||m.priceUsd<=0||!Number.isFinite(m.updatedAt)||m.updatedAt>now||now-m.updatedAt>30000)continue;const key=m.mint+':'+m.pairAddress,last=state.paperOutcomeSeeds[key];if(last&&now-last<60000)continue;
  if(state.paperOutcomes.length>=MAX_PENDING){state.paperOutcomeStats.dropped++;continue;}const a=rankMarket(m,undefined,now),b=rankPaperMarket(m,undefined,now);
  state.paperOutcomes.push({key,mint:m.mint,pairAddress:m.pairAddress,at:now,priceUsd:m.priceUsd,liquidityUsd:m.liquidityUsd,baseline:{eligible:a.eligible,score:a.score,stage:a.blockingStage,flags:a.red_flags},paper:{eligible:b.eligible,score:b.score,stage:b.blockingStage,relaxedFlags:b.relaxedFlags},done:[]});state.paperOutcomeSeeds[key]=now;state.paperOutcomeStats.created++;
 }
 for(const [key,at]of Object.entries(state.paperOutcomeSeeds))if(now-at>1800000)delete state.paperOutcomeSeeds[key];
}
