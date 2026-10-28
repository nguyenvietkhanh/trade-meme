import {aiMarketEligible,aiMarketCap,compareAIMarkets} from './autonomous-policy.js';
import {validMinuteBars} from './paper-ten-strategies.js';
import {SOL} from './engine.js';
const finite=Number.isFinite;
const positive=x=>finite(x)&&x>0;
export function earlyMomentumFeatures(m,now=Date.now()){
 const bars=m.strategyData?validMinuteBars(m.strategyData,m,now):null,last=bars?.at(-1),prior=bars?.slice(-16,-1),prior3=bars?.slice(-6,-3),last3=bars?.slice(-3);
 const base=prior?.length===15?prior:null,baseHigh=base?Math.max(...base.map(b=>b[2])):null,baseLow=base?Math.min(...base.map(b=>b[3])):null,mean=base?base.reduce((n,b)=>n+b[5],0)/base.length:null;
 const prior55=finite(m.volume1hUsd)&&finite(m.volume5mUsd)&&m.volume1hUsd>m.volume5mUsd&&m.volume5mUsd>=0?(m.volume1hUsd-m.volume5mUsd)/11:null;
 const buys=m.buys5m,sells=m.sells5m,counts=finite(buys)&&buys>=0&&finite(sells)&&sells>=0&&buys+sells>0;
 return {asOf:now,source:'derived observed M1 and rolling market aggregates; not a trade signal',closedM1Count:bars?.length??0,lastM1MovePct:last?100*(last[4]/last[1]-1):null,last3mMovePct:last3?.length===3?100*(last3.at(-1)[4]/last3[0][1]-1):null,prior15mRangePct:positive(baseLow)?100*(baseHigh/baseLow-1):null,lastCloseVsPrior15mHighPct:positive(baseHigh)&&last?100*(last[4]/baseHigh-1):null,lastM1VolumeVsPrior15Mean:positive(mean)&&last?last[5]/mean:null,last3mVolumeVsPrior3m:last3?.length===3&&prior3?.length===3&&prior3.reduce((n,b)=>n+b[5],0)>0?last3.reduce((n,b)=>n+b[5],0)/prior3.reduce((n,b)=>n+b[5],0):null,volume5mVsPrior55mMean:positive(prior55)?m.volume5mUsd/prior55:null,buyCountShare5m:counts?buys/(buys+sells):null,netBuyCount5m:counts?buys-sells:null,quoteMint:m.quoteMint??null,executionSupport:m.quoteMint==null?'unknown':m.quoteMint===SOL?'token_SOL_pool':'verified_route_required'};
}
// Diversify discovery/inference slots; never emits BUY or bypasses risk/quote checks.
export function selectMomentumCandidates(rows,limit=60){
 const eligible=rows.filter(aiMarketEligible),cap=m=>aiMarketCap(m),early=eligible.filter(m=>cap(m)>2000&&cap(m)<30000&&m.change5mPct<=100);
 const expansion=m=>{const prior=finite(m.volume1hUsd)&&finite(m.volume5mUsd)?m.volume1hUsd-m.volume5mUsd:null;return positive(prior)?m.volume5mUsd/(prior/11):0;};
 early.sort((a,b)=>expansion(b)-expansion(a)||(b.volume5mUsd??0)-(a.volume5mUsd??0)||compareAIMarkets(a,b));
 const mixed=[...early.slice(0,Math.ceil(limit/2)),...eligible.sort(compareAIMarkets)],seen=new Set(),out=[];
 for(const m of mixed){if(seen.has(m.mint))continue;seen.add(m.mint);out.push(m);if(out.length>=limit)break;}return limit>0?out:[];
}
