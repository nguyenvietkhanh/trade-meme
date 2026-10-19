import {rankMarket} from './strategy.js';
import {TRADE_RULES} from './desk-rules.js';
export const PAPER_ENTRY_POLICY=Object.freeze({version:'paper-exploration-v1',minScore:40,minBuys5m:3,minTrades5m:8,minTrades1h:20,minChange5mPct:-20,maxChange1hPct:300,confirmationGapMs:5000,minimumObservations:2,baselineMinScore:60});
const finite=Number.isFinite;
/** Counterfactual entry experiment only. Never mutate prices/evidence to force a gate. */
export function rankPaperMarket(m,s=TRADE_RULES,now=Date.now()){
 const original=rankMarket(m,s,now),relaxed=new Set();m=m??{};
 const counts=[m.buys5m,m.sells5m,m.buys1h,m.sells1h],consistent=counts.every(v=>Number.isSafeInteger(v)&&v>=0)&&m.buys1h>=m.buys5m&&m.sells1h>=m.sells5m;
 if(consistent&&m.buys5m>=3&&m.buys5m+m.sells5m>=8&&m.buys1h+m.sells1h>=20)relaxed.add('LOW_ACTIVITY');
 if(finite(m.change5mPct)&&finite(m.change1hPct))relaxed.add('NO_UPTREND');
 if(finite(m.change5mPct)&&m.change5mPct>=-20&&finite(m.change1hPct)&&m.change1hPct<=300)relaxed.add('DUMP_OR_CHASE');
 // H4 and direction are labels in the paper experiment, not assertions of safety.
 relaxed.add('H4_DUMP_PATTERN');if(m.paperObservedTwice===true||m.signalConfirmed===true)relaxed.add('UNCONFIRMED_SIGNAL');
 if(original.score>=PAPER_ENTRY_POLICY.minScore)relaxed.add('LOW_SCORE');
 const flags=original.red_flags.filter(f=>!relaxed.has(f));if(original.score<PAPER_ENTRY_POLICY.minScore&&!flags.includes('LOW_SCORE'))flags.push('LOW_SCORE');
 const unsafe=new Set(['VERIFICATION_PROVIDER_ERROR','MISSING_SAFETY_EVIDENCE','UNVERIFIED_QUOTE_RESERVE','ACTIVE_OR_UNKNOWN_AUTHORITY','UNSAFE_TOKEN_PROGRAM','LP_UNVERIFIED','HOLDER_CONCENTRATION','DEV_CONCENTRATION','RUG_WARNINGS','ROUND_TRIP_UNVERIFIED','QUOTE_STALE']);
 const originalCoarse=original.blockingStage==='discovery'?original.primaryFlags:[];
 const cheap=flags.filter(f=>!unsafe.has(f)&&!['UNCONFIRMED_SIGNAL','LOW_SCORE'].includes(f));
 const roughEligible=cheap.length===0,preQuoteEligible=roughEligible&&original.score>=40&&flags.every(f=>['ROUND_TRIP_UNVERIFIED','QUOTE_STALE','UNCONFIRMED_SIGNAL'].includes(f));
 const stage=originalCoarse.some(f=>flags.includes(f))?'discovery':!roughEligible?'market':flags.some(f=>unsafe.has(f))?'safety':flags.includes('UNCONFIRMED_SIGNAL')?'confirmation':flags.includes('LOW_SCORE')?'score':'ready';
 const primary=stage==='discovery'?originalCoarse.filter(f=>flags.includes(f)):stage==='market'?cheap:stage==='safety'?flags.filter(f=>unsafe.has(f)):stage==='confirmation'?['UNCONFIRMED_SIGNAL']:stage==='score'?['LOW_SCORE']:[];
 const reason=f=>f==='LOW_SCORE'?'Paper cần ≥40 điểm':f==='UNCONFIRMED_SIGNAL'?'Paper chờ 2 ảnh thị trường mới, cách ít nhất 5 giây':original.reasons[original.red_flags.indexOf(f)]??f;
 return {...original,eligible:flags.length===0,roughEligible,preQuoteEligible,score:original.score,minScore:40,red_flags:flags,reasons:flags.map(reason),primaryFlags:primary,primaryReasons:primary.map(reason),blockingStage:stage,missingData:original.missingData.filter(f=>flags.includes(f)),blockingCategory:primary.some(f=>original.missingData.includes(f))?'missing-data':primary.length?'rule-failed':'ready',baseline:{eligible:original.eligible,score:original.score,minScore:original.minScore,blockingStage:original.blockingStage,flags:original.red_flags},relaxedFlags:original.red_flags.filter(f=>relaxed.has(f)),policyVersion:PAPER_ENTRY_POLICY.version};
}
export function observePaperEligibility(state,markets,now=Date.now()){
 state.paperObservations??={};
 const result=markets.map(m=>{const key=m.mint+':'+m.pairAddress,prior=state.paperObservations[key];const good=finite(m.updatedAt)&&m.updatedAt<=now&&now-m.updatedAt<=30000&&finite(m.priceUsd)&&m.priceUsd>0;
  const independent=good&&prior&&now-prior.at>=5000&&now-prior.at<=15000&&m.updatedAt>prior.sourceAt;
  if(good&&(!prior||m.updatedAt>prior.sourceAt))state.paperObservations[key]={at:now,sourceAt:m.updatedAt};return {...m,paperObservedTwice:!!independent};});
 for(const [k,v]of Object.entries(state.paperObservations))if(now-v.at>30000)delete state.paperObservations[k];return result;
}
