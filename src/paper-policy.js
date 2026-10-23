import {rankMarket} from './strategy.js';
import {TRADE_RULES} from './desk-rules.js';
import {SCALP_ENTRY_RULES,SCALP_V1_ENTRY_RULES,SCALP_V3_ENTRY_RULES,persistentContinuation,modeledNormalRoundTripPct} from './paper-scalp.js';
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
 state.paperObservations??={};const r=SCALP_ENTRY_RULES;
 const result=markets.map(m=>{
  const key=m.mint+':'+m.pairAddress,saved=state.paperObservations[key];
  const good=finite(m.updatedAt)&&m.updatedAt<=now&&now-m.updatedAt<=30000&&finite(m.priceUsd)&&m.priceUsd>0;
  // Completion times jitter around the 5s timer. Retain real observations so a
  // 4.99s interval cannot erase the only usable 5–15s confirmation anchor.
  const history=(Array.isArray(saved?.history)?saved.history:saved?[saved]:[]).filter(row=>finite(row.at)&&row.at<=now&&now-row.at<=r.maxPersistenceMs);
  const prior=good&&(!saved||m.updatedAt>saved.sourceAt)?[...history].reverse().find(row=>now-row.at>=r.confirmationGapMs&&m.updatedAt>row.sourceAt):null;
  const changed=!!prior&&[m.priceUsd,m.volume5mUsd,m.buys5m,m.sells5m].some((v,i)=>v!==prior.fingerprint?.[i]);
  const retains=(row,anchor)=>finite(row.priceUsd)&&row.priceUsd>=anchor.priceUsd*r.minPriceRetention&&finite(row.liquidityUsd)&&row.liquidityUsd>=anchor.liquidityUsd*r.minLiquidityRetention&&finite(row.change5mPct)&&row.change5mPct>=r.minChange5mPct;
  const sequence=prior?[prior,...history.filter(row=>row.at>prior.at),m]:[];
  const scalpV1Confirmed=!!prior&&changed&&finite(prior.priceUsd)&&finite(prior.liquidityUsd)&&prior.change5mPct>=r.minChange5mPct&&sequence.every((row,i)=>!i||retains(row,prior)&&retains(row,sequence[i-1]));
  const deltaBuys=prior&&Number.isSafeInteger(m.buys5m)&&Number.isSafeInteger(prior.fingerprint?.[2])?m.buys5m-prior.fingerprint[2]:null,deltaSells=prior&&Number.isSafeInteger(m.sells5m)&&Number.isSafeInteger(prior.fingerprint?.[3])?m.sells5m-prior.fingerprint[3]:null;
  const risePct=prior?(m.priceUsd/prior.priceUsd-1)*100:null;
  // Rolling 5m counts can decrease when old trades leave the window. Such a
  // delta is unknown flow, never evidence that new independent buyers arrived.
  const flowKnown=Number.isSafeInteger(deltaBuys)&&Number.isSafeInteger(deltaSells)&&deltaBuys>=0&&deltaSells>=0;
  const scalpV3Confirmed=scalpV1Confirmed&&risePct>0&&risePct<=r.maxConfirmationRisePct+1e-9&&flowKnown&&deltaBuys>deltaSells;
  const older=prior?[...history].reverse().find(row=>prior.at-row.at>=r.confirmationGapMs&&prior.at-row.at<=r.maxConfirmationGapMs&&row.sourceAt<prior.sourceAt):null;
  const view=row=>({at:row.at,sourceAt:row.sourceAt,priceUsd:row.priceUsd,liquidityUsd:row.liquidityUsd,buys5m:row.fingerprint[2],sells5m:row.fingerprint[3]});
  const persistence=older&&prior?[view(older),view(prior),{at:now,sourceAt:m.updatedAt,priceUsd:m.priceUsd,liquidityUsd:m.liquidityUsd,buys5m:m.buys5m,sells5m:m.sells5m}]:null;
  const fullSequence=older?[older,...history.filter(row=>row.at>older.at),m]:[];
  const pathSafe=!!older&&fullSequence.every((row,i)=>!i||retains(row,older)&&retains(row,fullSequence[i-1]));
  const scalpConfirmed=scalpV3Confirmed&&pathSafe&&persistentContinuation(persistence,now,r);
  if(!good)delete state.paperObservations[key];
  else if(!saved||m.updatedAt>saved.sourceAt){const current={at:now,sourceAt:m.updatedAt,priceUsd:m.priceUsd,liquidityUsd:m.liquidityUsd,change5mPct:m.change5mPct,fingerprint:[m.priceUsd,m.volume5mUsd,m.buys5m,m.sells5m]};state.paperObservations[key]={...current,history:[...history,current].slice(-8)};}
  return {...m,paperObservedTwice:!!prior,scalpConfirmed,scalpV1Confirmed,scalpV3Confirmed,scalpSetup:prior?{at:now,anchorAt:prior.at,anchorPriceUsd:prior.priceUsd,priceRetention:m.priceUsd/prior.priceUsd,liquidityRetention:m.liquidityUsd/prior.liquidityUsd,changed,risePct,deltaBuys,deltaSells,flowKnown,netNewBuys:flowKnown?deltaBuys-deltaSells:null,persistence}:null};
 });
 for(const [key,value]of Object.entries(state.paperObservations))if(now-value.at>30000)delete state.paperObservations[key];return result;
}

export const PAPER_ENTRY_POLICY=SCALP_ENTRY_RULES;
/** Active paper strategy: rank gainers on observed 5m changes; H1/H4 remain labels. */
function rankPaperRules(m,s=TRADE_RULES,now=Date.now(),r=PAPER_ENTRY_POLICY){
 m=m??{};const prior=rankExplorationMarket(m,s,now);
 const ignore=new Set(['LOW_ACTIVITY','NO_UPTREND','DUMP_OR_CHASE','UNCONFIRMED_SIGNAL','LOW_SCORE']);
 const flags=prior.red_flags.filter(f=>!ignore.has(f)),texts={};
 const fail=(ok,flag,text)=>{if(!ok){flags.push(flag);texts[flag]=text;}};
 fail(finite(m.change5mPct)&&m.change5mPct>=r.minChange5mPct&&m.change5mPct<=r.maxChange5mPct,'SCALP_5M_GAIN',finite(m.change5mPct)?`Gainers 5m cần tăng ${r.minChange5mPct}–${r.maxChange5mPct}%`:'Thiếu % thay đổi giá 5 phút hợp lệ');
 const counts=[m.buys5m,m.sells5m],valid=counts.every(v=>Number.isSafeInteger(v)&&v>=0),ratio=valid?m.buys5m/Math.max(1,m.sells5m):NaN;
 const context=[['buys1h',m.buys5m],['sells1h',m.sells5m]].every(([k,minimum])=>m[k]==null||Number.isSafeInteger(m[k])&&m[k]>=minimum);
 fail(valid&&context&&m.buys5m>=r.minBuys5m&&m.buys5m+m.sells5m>=r.minTrades5m&&ratio>=r.minBuySellRatio,'SCALP_5M_FLOW',`Cần ≥${r.minBuys5m} mua, ≥${r.minTrades5m} lệnh/5m và mua/bán ≥${r.minBuySellRatio}; số liệu nhất quán`);
 fail(finite(m.volume5mUsd)&&m.volume5mUsd>=r.minVolume5mUsd,'SCALP_5M_VOLUME',finite(m.volume5mUsd)?`Volume 5m cần ≥$${r.minVolume5mUsd}`:'Thiếu volume 5 phút hợp lệ');
 const normalCost=modeledNormalRoundTripPct(m.evidence?.roundTripLossPct);
 if(finite(r.maxModeledRoundTripPct)&&m.evidence?.roundTripQuoteOk===true&&finite(normalCost))fail(normalCost<=r.maxModeledRoundTripPct,'PAPER_COST_BUDGET',`Ước tính hao hụt quote vòng + mô hình 1,5% mỗi chiều ${normalCost.toFixed(2)}% vượt ${r.maxModeledRoundTripPct}%`);
 const clamp=v=>Math.max(0,Math.min(1,v)),acceleration=finite(m.volume1hUsd)&&m.volume1hUsd>m.volume5mUsd?m.volume5mUsd/((m.volume1hUsd-m.volume5mUsd)/11):null;
 const parts={momentum:finite(m.change5mPct)?30*clamp(m.change5mPct/50):0,flow:valid&&m.buys5m+m.sells5m>0?25*clamp((m.buys5m/(m.buys5m+m.sells5m)-.45)/.2):0,volume:finite(acceleration)?20*clamp(acceleration/1.5):10,depth:finite(m.liquidityUsd)&&m.valuationUsd>0?15*clamp(m.liquidityUsd/m.valuationUsd/.1):0,cost:finite(m.evidence?.roundTripLossPct)?10*clamp(1-m.evidence.roundTripLossPct/6):5};
 const score=Math.round(Math.max(0,Object.values(parts).reduce((a,b)=>a+b,0)-prior.washPenalty-prior.boostPenalty));
 fail(score>=r.minScore,'LOW_SCORE',`Paper gainers cần ≥${r.minScore} điểm`);
 if(m.evidence?.roundTripQuoteOk===true&&(!finite(m.evidence.quoteCheckedAt)||m.evidence.quoteCheckedAt>now||now-m.evidence.quoteCheckedAt>r.maxQuoteAgeMs)&&!flags.includes('QUOTE_STALE')){flags.push('QUOTE_STALE');texts.QUOTE_STALE='Quote vòng gainers quá 10 giây; chờ quote mới';}
 const setup=m.scalpSetup,continuing=!r.requireIncrementalBuyDominance||setup&&finite(setup.at)&&setup.at<=now&&now-setup.at<=r.maxConfirmationGapMs&&finite(setup.anchorAt)&&setup.at-setup.anchorAt>=r.confirmationGapMs&&setup.at-setup.anchorAt<=r.maxConfirmationGapMs&&finite(setup.risePct)&&setup.risePct>0&&setup.risePct<=r.maxConfirmationRisePct+1e-9&&setup.flowKnown===true&&Number.isSafeInteger(setup.deltaBuys)&&Number.isSafeInteger(setup.deltaSells)&&setup.deltaSells>=0&&setup.deltaBuys>setup.deltaSells;
 fail(m.scalpConfirmed===true&&!!continuing,'UNCONFIRMED_SIGNAL',r.requireIncrementalBuyDominance?'Chờ giá tăng tiếp 0–4%, số mua tăng thêm > số bán; dữ liệu mới cách 5–15s, thanh khoản giữ ≥90%':'Chờ 2 lần quét 5m có dữ liệu thay đổi; giá không tụt >0,5%, thanh khoản giữ ≥90%');
 if(r.minConfirmationObservations&&!persistentContinuation(setup?.persistence,now,r)&&!flags.includes('UNCONFIRMED_SIGNAL')){flags.push('UNCONFIRMED_SIGNAL');texts.UNCONFIRMED_SIGNAL='Chờ 3 quan sát mới trong 10–30s: giá tăng tiếp, dòng mua trội ở cả hai nhịp, thanh khoản giữ ≥90%';}
 if(r.minConfirmationObservations&&flags.includes('UNCONFIRMED_SIGNAL'))texts.UNCONFIRMED_SIGNAL='Chờ 3 quan sát mới trong 10–30s: giá tăng tiếp, dòng mua trội ở cả hai nhịp, thanh khoản giữ ≥90%';
 const safety=new Set(['VERIFICATION_PROVIDER_ERROR','MISSING_SAFETY_EVIDENCE','UNVERIFIED_QUOTE_RESERVE','ACTIVE_OR_UNKNOWN_AUTHORITY','UNSAFE_TOKEN_PROGRAM','LP_UNVERIFIED','HOLDER_CONCENTRATION','DEV_CONCENTRATION','RUG_WARNINGS','ROUND_TRIP_UNVERIFIED','QUOTE_STALE','PAPER_COST_BUDGET']);
 const cheap=flags.filter(f=>!safety.has(f)&&!['UNCONFIRMED_SIGNAL','LOW_SCORE'].includes(f));
 const originalCoarse=prior.baseline.blockingStage==='discovery'?prior.baseline.flags.filter(f=>prior.primaryFlags.includes(f)):[];
 const stage=originalCoarse.some(f=>flags.includes(f))?'discovery':cheap.length?'market':flags.some(f=>safety.has(f))?'safety':flags.includes('UNCONFIRMED_SIGNAL')?'confirmation':flags.includes('LOW_SCORE')?'score':'ready';
 const primary=stage==='discovery'?originalCoarse.filter(f=>flags.includes(f)):stage==='market'?cheap:stage==='safety'?flags.filter(f=>safety.has(f)):stage==='confirmation'?['UNCONFIRMED_SIGNAL']:stage==='score'?['LOW_SCORE']:[];
 const reason=f=>texts[f]??prior.reasons[prior.red_flags.indexOf(f)]??f;
 const missing=prior.missingData.filter(f=>flags.includes(f));for(const flag of ['UNCONFIRMED_SIGNAL','QUOTE_STALE',...(!finite(m.change5mPct)?['SCALP_5M_GAIN']:[]),...(!finite(m.volume5mUsd)?['SCALP_5M_VOLUME']:[]),...(!valid?['SCALP_5M_FLOW']:[])])if(flags.includes(flag)&&!missing.includes(flag))missing.push(flag);
 return {...prior,eligible:!flags.length,roughEligible:cheap.length===0,preQuoteEligible:cheap.length===0&&score>=r.minScore&&flags.every(f=>['ROUND_TRIP_UNVERIFIED','QUOTE_STALE','UNCONFIRMED_SIGNAL'].includes(f)),score,minScore:r.minScore,scoreParts:parts,estimatedNormalRoundTripPct:normalCost,missingScoreData:[...(!finite(acceleration)?['volume']:[]),...(!finite(m.evidence?.roundTripLossPct)?['cost']:[])],red_flags:flags,reasons:flags.map(reason),primaryFlags:primary,primaryReasons:primary.map(reason),missingData:missing,blockingStage:stage,blockingCategory:primary.some(f=>missing.includes(f))?'missing-data':primary.length?'rule-failed':'ready',relaxedFlags:prior.baseline.flags.filter(f=>!flags.includes(f)),policyVersion:r.version,gainerChange5mPct:finite(m.change5mPct)?m.change5mPct:null};
}


export function rankPaperMarketV1(m,s=TRADE_RULES,now=Date.now()){return rankPaperRules({...m,scalpConfirmed:m?.scalpV1Confirmed??m?.scalpConfirmed},s,now,SCALP_V1_ENTRY_RULES);}
export function rankPaperMarketV3(m,s=TRADE_RULES,now=Date.now()){return rankPaperRules({...m,scalpConfirmed:m?.scalpV3Confirmed??m?.scalpConfirmed},s,now,SCALP_V3_ENTRY_RULES);}
export function rankPaperMarket(m,s=TRADE_RULES,now=Date.now()){const result=rankPaperRules(m,s,now),old=rankPaperMarketV3(m,s,now);return {...result,previousPaper:{version:SCALP_V3_ENTRY_RULES.version,eligible:old.eligible,blockingStage:old.blockingStage,flags:old.red_flags}};}

export function paperEntryFeatures(m,solUsd,now=Date.now()){
 const baseline=entryFeatures(m,solUsd),rank=rankPaperMarket(m,undefined,now);
 return {...baseline,capturedAt:now,baselineScore:rank.baseline.score,baselinePenalties:baseline.penalties,baselineMissingScoreData:baseline.missingScoreData,penalties:{washPenalty:rank.washPenalty,boostPenalty:rank.boostPenalty,h4Penalty:0},missingScoreData:rank.missingScoreData,baselineStrategyVersion:baseline.strategyVersion,score:rank.score,scoreParts:rank.scoreParts,strategyVersion:PAPER_ENTRY_POLICY.version,policyVersion:PAPER_ENTRY_POLICY.version,previousPaper:rank.previousPaper,scalpSetup:m.scalpSetup??null,rank5m:{changePct:m.change5mPct,volumeUsd:m.volume5mUsd,buys:m.buys5m,sells:m.sells5m,ordering:'5m percent change desc within discovered PumpSwap pools'}};
}
