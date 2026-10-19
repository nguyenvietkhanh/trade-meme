import {rankMarket} from './strategy.js';
import {TRADE_RULES} from './desk-rules.js';
import {SCALP_ENTRY_RULES} from './paper-scalp.js';
import {entryFeatures} from './training-records.js';
export const EXPLORATION_ENTRY_POLICY=Object.freeze({version:'paper-exploration-v1',minScore:40,minBuys5m:3,minTrades5m:8,minTrades1h:20,minChange5mPct:-20,maxChange1hPct:300,confirmationGapMs:5000,minimumObservations:2,baselineMinScore:60});
const finite=Number.isFinite;
/** Counterfactual entry experiment only. Never mutate prices/evidence to force a gate. */
export function rankExplorationMarket(m,s=TRADE_RULES,now=Date.now()){
 const original=rankMarket(m,s,now),relaxed=new Set();m=m??{};
 const counts=[m.buys5m,m.sells5m,m.buys1h,m.sells1h],consistent=counts.every(v=>Number.isSafeInteger(v)&&v>=0)&&m.buys1h>=m.buys5m&&m.sells1h>=m.sells5m;
 if(consistent&&m.buys5m>=3&&m.buys5m+m.sells5m>=8&&m.buys1h+m.sells1h>=20)relaxed.add('LOW_ACTIVITY');
 if(finite(m.change5mPct)&&finite(m.change1hPct))relaxed.add('NO_UPTREND');
 if(finite(m.change5mPct)&&m.change5mPct>=-20&&finite(m.change1hPct)&&m.change1hPct<=300)relaxed.add('DUMP_OR_CHASE');
 // H4 and direction are labels in the paper experiment, not assertions of safety.
 relaxed.add('H4_DUMP_PATTERN');if(m.paperObservedTwice===true||m.signalConfirmed===true)relaxed.add('UNCONFIRMED_SIGNAL');
 if(original.score>=EXPLORATION_ENTRY_POLICY.minScore)relaxed.add('LOW_SCORE');
 const flags=original.red_flags.filter(f=>!relaxed.has(f));if(original.score<EXPLORATION_ENTRY_POLICY.minScore&&!flags.includes('LOW_SCORE'))flags.push('LOW_SCORE');
 const unsafe=new Set(['VERIFICATION_PROVIDER_ERROR','MISSING_SAFETY_EVIDENCE','UNVERIFIED_QUOTE_RESERVE','ACTIVE_OR_UNKNOWN_AUTHORITY','UNSAFE_TOKEN_PROGRAM','LP_UNVERIFIED','HOLDER_CONCENTRATION','DEV_CONCENTRATION','RUG_WARNINGS','ROUND_TRIP_UNVERIFIED','QUOTE_STALE']);
 const originalCoarse=original.blockingStage==='discovery'?original.primaryFlags:[];
 const cheap=flags.filter(f=>!unsafe.has(f)&&!['UNCONFIRMED_SIGNAL','LOW_SCORE'].includes(f));
 const roughEligible=cheap.length===0,preQuoteEligible=roughEligible&&original.score>=40&&flags.every(f=>['ROUND_TRIP_UNVERIFIED','QUOTE_STALE','UNCONFIRMED_SIGNAL'].includes(f));
 const stage=originalCoarse.some(f=>flags.includes(f))?'discovery':!roughEligible?'market':flags.some(f=>unsafe.has(f))?'safety':flags.includes('UNCONFIRMED_SIGNAL')?'confirmation':flags.includes('LOW_SCORE')?'score':'ready';
 const primary=stage==='discovery'?originalCoarse.filter(f=>flags.includes(f)):stage==='market'?cheap:stage==='safety'?flags.filter(f=>unsafe.has(f)):stage==='confirmation'?['UNCONFIRMED_SIGNAL']:stage==='score'?['LOW_SCORE']:[];
 const reason=f=>f==='LOW_SCORE'?'Paper cần ≥40 điểm':f==='UNCONFIRMED_SIGNAL'?'Paper chờ 2 ảnh thị trường mới, cách ít nhất 5 giây':original.reasons[original.red_flags.indexOf(f)]??f;
 return {...original,eligible:flags.length===0,roughEligible,preQuoteEligible,score:original.score,minScore:40,red_flags:flags,reasons:flags.map(reason),primaryFlags:primary,primaryReasons:primary.map(reason),blockingStage:stage,missingData:original.missingData.filter(f=>flags.includes(f)),blockingCategory:primary.some(f=>original.missingData.includes(f))?'missing-data':primary.length?'rule-failed':'ready',baseline:{eligible:original.eligible,score:original.score,minScore:original.minScore,blockingStage:original.blockingStage,flags:original.red_flags},relaxedFlags:original.red_flags.filter(f=>relaxed.has(f)),policyVersion:EXPLORATION_ENTRY_POLICY.version};
}
export function observePaperEligibility(state,markets,now=Date.now()){
 state.paperObservations??={};
 const result=markets.map(m=>{const key=m.mint+':'+m.pairAddress,prior=state.paperObservations[key];const good=finite(m.updatedAt)&&m.updatedAt<=now&&now-m.updatedAt<=30000&&finite(m.priceUsd)&&m.priceUsd>0;
  const independent=good&&prior&&now-prior.at>=5000&&now-prior.at<=15000&&m.updatedAt>prior.sourceAt;
  const changed=!!prior&&[m.priceUsd,m.volume5mUsd,m.buys5m,m.sells5m].some((v,i)=>v!==prior.fingerprint?.[i]);
  const scalpConfirmed=!!independent&&changed&&finite(prior.priceUsd)&&m.priceUsd>=prior.priceUsd*SCALP_ENTRY_RULES.minPriceRetention&&finite(m.liquidityUsd)&&m.liquidityUsd>=prior.liquidityUsd*SCALP_ENTRY_RULES.minLiquidityRetention&&prior.change5mPct>=SCALP_ENTRY_RULES.minChange5mPct&&m.change5mPct>=SCALP_ENTRY_RULES.minChange5mPct;
  if(good&&(!prior||m.updatedAt>prior.sourceAt))state.paperObservations[key]={at:now,sourceAt:m.updatedAt,priceUsd:m.priceUsd,liquidityUsd:m.liquidityUsd,change5mPct:m.change5mPct,fingerprint:[m.priceUsd,m.volume5mUsd,m.buys5m,m.sells5m]};return {...m,paperObservedTwice:!!independent,scalpConfirmed,scalpSetup:independent?{at:now,anchorAt:prior.at,anchorPriceUsd:prior.priceUsd,priceRetention:m.priceUsd/prior.priceUsd,liquidityRetention:m.liquidityUsd/prior.liquidityUsd,changed}:null};});
 for(const [k,v]of Object.entries(state.paperObservations))if(now-v.at>30000)delete state.paperObservations[k];return result;
}


export const PAPER_ENTRY_POLICY=SCALP_ENTRY_RULES;
/** Active paper strategy: rank gainers on observed 5m changes; H1/H4 remain labels. */
export function rankPaperMarket(m,s=TRADE_RULES,now=Date.now()){
 m=m??{};const prior=rankExplorationMarket(m,s,now),r=PAPER_ENTRY_POLICY;
 const ignore=new Set(['LOW_ACTIVITY','NO_UPTREND','DUMP_OR_CHASE','UNCONFIRMED_SIGNAL','LOW_SCORE']);
 const flags=prior.red_flags.filter(f=>!ignore.has(f)),texts={};
 const fail=(ok,flag,text)=>{if(!ok){flags.push(flag);texts[flag]=text;}};
 fail(finite(m.change5mPct)&&m.change5mPct>=r.minChange5mPct&&m.change5mPct<=r.maxChange5mPct,'SCALP_5M_GAIN',finite(m.change5mPct)?`Gainers 5m cần tăng ${r.minChange5mPct}–${r.maxChange5mPct}%`:'Thiếu % thay đổi giá 5 phút hợp lệ');
 const counts=[m.buys5m,m.sells5m],valid=counts.every(v=>Number.isSafeInteger(v)&&v>=0),ratio=valid?m.buys5m/Math.max(1,m.sells5m):NaN;
 const context=[['buys1h',m.buys5m],['sells1h',m.sells5m]].every(([k,minimum])=>m[k]==null||Number.isSafeInteger(m[k])&&m[k]>=minimum);
 fail(valid&&context&&m.buys5m>=r.minBuys5m&&m.buys5m+m.sells5m>=r.minTrades5m&&ratio>=r.minBuySellRatio,'SCALP_5M_FLOW',`Cần ≥${r.minBuys5m} mua, ≥${r.minTrades5m} lệnh/5m và mua/bán ≥${r.minBuySellRatio}; số liệu nhất quán`);
 fail(finite(m.volume5mUsd)&&m.volume5mUsd>=r.minVolume5mUsd,'SCALP_5M_VOLUME',finite(m.volume5mUsd)?`Volume 5m cần ≥$${r.minVolume5mUsd}`:'Thiếu volume 5 phút hợp lệ');
 const clamp=v=>Math.max(0,Math.min(1,v)),acceleration=finite(m.volume1hUsd)&&m.volume1hUsd>m.volume5mUsd?m.volume5mUsd/((m.volume1hUsd-m.volume5mUsd)/11):null;
 const parts={momentum:finite(m.change5mPct)?30*clamp(m.change5mPct/50):0,flow:valid&&m.buys5m+m.sells5m>0?25*clamp((m.buys5m/(m.buys5m+m.sells5m)-.45)/.2):0,volume:finite(acceleration)?20*clamp(acceleration/1.5):10,depth:finite(m.liquidityUsd)&&m.valuationUsd>0?15*clamp(m.liquidityUsd/m.valuationUsd/.1):0,cost:finite(m.evidence?.roundTripLossPct)?10*clamp(1-m.evidence.roundTripLossPct/6):5};
 const score=Math.round(Math.max(0,Object.values(parts).reduce((a,b)=>a+b,0)-prior.washPenalty-prior.boostPenalty));
 fail(score>=r.minScore,'LOW_SCORE',`Paper gainers cần ≥${r.minScore} điểm`);
 if(m.evidence?.roundTripQuoteOk===true&&(!finite(m.evidence.quoteCheckedAt)||m.evidence.quoteCheckedAt>now||now-m.evidence.quoteCheckedAt>r.maxQuoteAgeMs)&&!flags.includes('QUOTE_STALE')){flags.push('QUOTE_STALE');texts.QUOTE_STALE='Quote vòng gainers quá 10 giây; chờ quote mới';}
 fail(m.scalpConfirmed===true,'UNCONFIRMED_SIGNAL','Chờ 2 lần quét 5m có dữ liệu thay đổi; giá không tụt >0,5%, thanh khoản giữ ≥90%');
 const safety=new Set(['VERIFICATION_PROVIDER_ERROR','MISSING_SAFETY_EVIDENCE','UNVERIFIED_QUOTE_RESERVE','ACTIVE_OR_UNKNOWN_AUTHORITY','UNSAFE_TOKEN_PROGRAM','LP_UNVERIFIED','HOLDER_CONCENTRATION','DEV_CONCENTRATION','RUG_WARNINGS','ROUND_TRIP_UNVERIFIED','QUOTE_STALE']);
 const cheap=flags.filter(f=>!safety.has(f)&&!['UNCONFIRMED_SIGNAL','LOW_SCORE'].includes(f));
 const originalCoarse=prior.baseline.blockingStage==='discovery'?prior.baseline.flags.filter(f=>prior.primaryFlags.includes(f)):[];
 const stage=originalCoarse.some(f=>flags.includes(f))?'discovery':cheap.length?'market':flags.some(f=>safety.has(f))?'safety':flags.includes('UNCONFIRMED_SIGNAL')?'confirmation':flags.includes('LOW_SCORE')?'score':'ready';
 const primary=stage==='discovery'?originalCoarse.filter(f=>flags.includes(f)):stage==='market'?cheap:stage==='safety'?flags.filter(f=>safety.has(f)):stage==='confirmation'?['UNCONFIRMED_SIGNAL']:stage==='score'?['LOW_SCORE']:[];
 const reason=f=>texts[f]??prior.reasons[prior.red_flags.indexOf(f)]??f;
 const missing=prior.missingData.filter(f=>flags.includes(f));for(const flag of ['UNCONFIRMED_SIGNAL','QUOTE_STALE',...(!finite(m.change5mPct)?['SCALP_5M_GAIN']:[]),...(!finite(m.volume5mUsd)?['SCALP_5M_VOLUME']:[]),...(!valid?['SCALP_5M_FLOW']:[])])if(flags.includes(flag)&&!missing.includes(flag))missing.push(flag);
 return {...prior,eligible:!flags.length,roughEligible:cheap.length===0,preQuoteEligible:cheap.length===0&&score>=r.minScore&&flags.every(f=>['ROUND_TRIP_UNVERIFIED','QUOTE_STALE','UNCONFIRMED_SIGNAL'].includes(f)),score,minScore:r.minScore,scoreParts:parts,missingScoreData:[...(!finite(acceleration)?['volume']:[]),...(!finite(m.evidence?.roundTripLossPct)?['cost']:[])],red_flags:flags,reasons:flags.map(reason),primaryFlags:primary,primaryReasons:primary.map(reason),missingData:missing,blockingStage:stage,blockingCategory:primary.some(f=>missing.includes(f))?'missing-data':primary.length?'rule-failed':'ready',relaxedFlags:prior.baseline.flags.filter(f=>!flags.includes(f)),policyVersion:r.version,gainerChange5mPct:finite(m.change5mPct)?m.change5mPct:null};
}


export function paperEntryFeatures(m,solUsd,now=Date.now()){
 const baseline=entryFeatures(m,solUsd),rank=rankPaperMarket(m,undefined,now);
 return {...baseline,capturedAt:now,baselineScore:rank.baseline.score,baselinePenalties:baseline.penalties,baselineMissingScoreData:baseline.missingScoreData,penalties:{washPenalty:rank.washPenalty,boostPenalty:rank.boostPenalty,h4Penalty:0},missingScoreData:rank.missingScoreData,baselineStrategyVersion:baseline.strategyVersion,score:rank.score,scoreParts:rank.scoreParts,strategyVersion:PAPER_ENTRY_POLICY.version,policyVersion:PAPER_ENTRY_POLICY.version,scalpSetup:m.scalpSetup??null,rank5m:{changePct:m.change5mPct,volumeUsd:m.volume5mUsd,buys:m.buys5m,sells:m.sells5m,ordering:'5m percent change desc within discovered PumpSwap pools'}};
}
