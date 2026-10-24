import {workflowDecisionStage} from './paper-workflow.js';
import {updateAgentMetrics,agentMetricView} from './paper-agent-metrics.js';
import {paperPortfolioAdmission} from './paper-portfolio.js';
import {rankPaperRules,observePaperEligibility} from './paper-policy.js';
import {SCALP_ENTRY_RULES,SCALP_EXIT_RULES,comparePaperEntries,modeledNormalRoundTripPct} from './paper-scalp.js';

// Ten independent deterministic research strategies, shared market readers and
// atomic capital allocator. Not LLM reasoning or independently funded returns.
export const PAPER_AGENT_VERSION='paper-independent-risk-v3';
// Experimental policy appetites, not estimated probabilities of safety. Every
// profile stays INSIDE the common hard security / execution limits.
const risks={
 nova:['Tham chiếu',20,35,8,90,5,2,2],
 orin:['Dòng mua',30,30,6,95,4,1.5,1.5],
 vela:['Phòng thủ thanh khoản',100,20,4,98,2,1,.75],
 kade:['Ưu tiên chi phí',40,30,6,95,4,1,1],
 rune:['Nhịp sớm',25,35,7,90,5,1.75,1.75],
 zara:['Đà mạnh',25,33,7.5,92,4.5,1.9,1.8],
 atlas:['Xu hướng bền',60,25,5,98,3,1.25,1],
 echo:['Hồi có kiểm chứng',50,25,5,95,3,1.25,1],
 nyx:['Volume mở rộng',35,30,6,95,4,1.5,1.25],
 sage:['Thận trọng',75,20,4,99,2,1,.75]
};
function riskProfile(id){const [label,minReserveSol,maxTop10Pct,maxHolderPct,minLpSecuredPct,maxDevPct,maxImpactPct,maxOrderReservePct]=risks[id];return Object.freeze({version:PAPER_AGENT_VERSION+':'+id,label,minReserveSol,maxTop10Pct,maxHolderPct,minLpSecuredPct,maxDevPct,maxImpactPct,maxOrderReservePct,allocationFraction:.025});}
export function agentRiskChecks(policy,m){
 const e=m.evidence??{},checks=[];
 const require=(value,ok,reason,quote=false)=>{if(!Number.isFinite(value)||!ok(value))checks.push({reason,quote,missing:!Number.isFinite(value)});};
 require(e.quoteReserveSol,v=>v>=policy.minReserveSol,`Dự trữ xác minh cần ≥${policy.minReserveSol} SOL`);
 require(e.top10Pct,v=>v>=0&&v<=policy.maxTop10Pct,`Top 10 ngoài pool ≤${policy.maxTop10Pct}%`);
 require(e.largestHolderPct,v=>v>=0&&v<=policy.maxHolderPct,`Mỗi holder ≤${policy.maxHolderPct}%`);
 require(e.lpSecuredPct,v=>v>=policy.minLpSecuredPct,`LP burn/lock ≥${policy.minLpSecuredPct}%`);
 require(e.devPct,v=>v>=0&&v<=policy.maxDevPct,`Dev đã xác minh ≤${policy.maxDevPct}%`);
 require(e.buyImpactPct,v=>v>=0&&v<=policy.maxImpactPct,`Impact BUY ≤${policy.maxImpactPct}%`,true);
 require(e.sellImpactPct,v=>v>=0&&v<=policy.maxImpactPct,`Impact SELL ≤${policy.maxImpactPct}%`,true);
 const depth=Number.isFinite(e.probeSol)&&e.probeSol>0&&Number.isFinite(e.quoteReserveSol)&&e.quoteReserveSol>0?e.probeSol/e.quoteReserveSol*100:NaN;
 require(depth,v=>v<=policy.maxOrderReservePct,`Cỡ lệnh / dự trữ SOL ≤${policy.maxOrderReservePct}%`,true);
 return checks;
}

const profile=(id,name,role,description,entry,exit,rule,color)=>Object.freeze({id,name,role,description,rule,color,riskPolicy:riskProfile(id),entryRules:Object.freeze({...SCALP_ENTRY_RULES,...entry,version:PAPER_AGENT_VERSION+':'+id}),exitPolicy:Object.freeze({...SCALP_EXIT_RULES,...exit,agentPolicyVersion:PAPER_AGENT_VERSION,agentId:id})});
export const PAPER_AGENTS=Object.freeze([
 profile('nova','NOVA','Continuation','Tiếp diễn ba quan sát; nhóm tham chiếu v5.',{}, {},'5m +5–100%; xác nhận 3 quan sát', 'mint'),
 profile('orin','ORIN','Order flow','Dòng giao dịch mua trội; số đếm giao dịch không phải số ví độc lập.',{minChange5mPct:1,maxChange5mPct:45,minBuys5m:10,minBuySellRatio:1.8,minVolume5mUsd:1000},{stopLossPct:10,firstProfitPct:12,finalProfitPct:25,trailingPct:6,stallMs:120000,maxHoldMs:480000},'5m +1–45%; mua/bán ≥1,8; Δmua ≥2×max(1, Δbán)', 'blue'),
 profile('vela','VELA','Deep liquidity','Tăng vừa phải trên pool sâu; không cần NOVA duyệt.',{minChange5mPct:.5,maxChange5mPct:25},{stopLossPct:8,firstProfitPct:10,finalProfitPct:20,trailingPct:5,stallMs:240000},'5m +0,5–25%; dự trữ SOL xác minh ≥75', 'teal'),
 profile('kade','KADE','Cost efficiency','Tìm nhịp nhỏ có chi phí khứ hồi thấp.',{minChange5mPct:1,maxChange5mPct:30,maxModeledRoundTripPct:4.5},{stopLossPct:8,firstProfitPct:8,finalProfitPct:16,trailingPct:5,stallMs:120000,maxHoldMs:300000},'5m +1–30%; quote + haircut mô hình ≤4,5%', 'amber'),
 profile('rune','RUNE','Early acceleration','Nhận nhịp sớm qua hai quan sát mới, vẫn yêu cầu giá và dòng mua tăng.',{minChange5mPct:1,maxChange5mPct:15,minBuySellRatio:1.2,minConfirmationObservations:2,minPersistenceMs:5000},{stopLossPct:9,firstProfitPct:10,finalProfitPct:20,trailingPct:6,stallMs:90000,maxHoldMs:300000},'5m +1–15%; 2 quan sát ≥5s, giá và dòng mua tăng', 'rose'),
 profile('zara','ZARA','Momentum breakout','Đà tăng mạnh với volume; vẫn kiểm tra chống đuổi giá trong xác nhận.',{minChange5mPct:20,maxChange5mPct:100,minVolume5mUsd:2000,minBuys5m:10,minTrades5m:15,minBuySellRatio:1.4},{firstProfitPct:18,finalProfitPct:36,stallMs:120000,maxHoldMs:480000},'5m +20–100%; volume ≥$2.000; mua/bán ≥1,4', 'violet'),
 profile('atlas','ATLAS','Trend alignment','Nhịp ngắn cùng chiều xu hướng H1 đã quan sát.',{minChange5mPct:0,maxChange5mPct:20,minVolume5mUsd:750},{stopLossPct:10,firstProfitPct:15,finalProfitPct:30,trailingPct:7,stallMs:240000},'5m 0–20%; H1 >0 và ≤60%', 'blue'),
 profile('echo','ECHO','Pullback recovery','Hồi có xác nhận trong xu hướng H1 dương; không mua chỉ vì đang giảm.',{minChange5mPct:-5,maxChange5mPct:5,maxConfirmationRisePct:2},{stopLossPct:8,firstProfitPct:10,finalProfitPct:20,trailingPct:5,stallMs:120000,maxHoldMs:360000},'5m −5–5%; H1 >0; xác nhận hồi +0,25–2%', 'rose'),
 profile('nyx','NYX','Volume expansion','Volume 5m tăng so với trung bình 55 phút trước; không suy thành dòng tiền ví độc lập.',{minChange5mPct:1,maxChange5mPct:30,minVolume5mUsd:2000},{stopLossPct:10,firstProfitPct:12,finalProfitPct:24,trailingPct:6,stallMs:150000,maxHoldMs:420000},'5m +1–30%; volume ≥$2.000, gấp ≥2× nền 55m', 'teal'),
 profile('sage','SAGE','Quiet accumulation','Tích lũy chậm, pool sâu và chi phí thấp; tránh nhịp tăng nóng.',{minChange5mPct:0,maxChange5mPct:10,maxModeledRoundTripPct:5},{stopLossPct:7,firstProfitPct:8,finalProfitPct:16,trailingPct:4,stallMs:240000,maxHoldMs:480000},'5m 0–10%; H1 −5–10%; dự trữ ≥50 SOL; chi phí ≤5%', 'amber')
]);
export function agentMarket(agentId,m){const view=m.agentViews?.[agentId];return view?{...m,...view,evidence:m.evidence,verificationError:m.verificationError}:m;}
export function observeAgentMarkets(state,markets,now=Date.now()){
 if(state.agentObservationVersion!==PAPER_AGENT_VERSION){state.agentObservationStates={};state.agentObservationVersion=PAPER_AGENT_VERSION;}
 const views={};for(const a of PAPER_AGENTS){const own=state.agentObservationStates[a.id]??={};views[a.id]=observePaperEligibility(own,markets,now,a.entryRules);}
 return markets.map((m,i)=>({...m,agentViews:Object.fromEntries(PAPER_AGENTS.map(a=>{const x=views[a.id][i];return [a.id,{scalpConfirmed:x.scalpConfirmed,scalpV1Confirmed:x.scalpV1Confirmed,scalpV3Confirmed:x.scalpV3Confirmed,scalpSetup:x.scalpSetup,paperObservedTwice:x.paperObservedTwice}];}))}));
}
export function agentSignal(agentId,market,_legacyBase=null,now=Date.now(),settings=undefined){
 const agent=PAPER_AGENTS.find(a=>a.id===agentId);if(!agent)return {eligible:false,stage:'agent',reason:'Unknown agent',rank:null};
 const m=agentMarket(agentId,market),r=rankPaperRules(m,settings,now,agent.entryRules);let accepts=true;
 switch(agentId){
 case 'orin':accepts=m.scalpSetup?.flowKnown===true&&m.scalpSetup.deltaBuys>=2*Math.max(1,m.scalpSetup.deltaSells);break;
 case 'vela':accepts=Number.isFinite(m.evidence?.quoteReserveSol)&&m.evidence.quoteReserveSol>=75;break;
 case 'atlas':accepts=Number.isFinite(m.change1hPct)&&m.change1hPct>0&&m.change1hPct<=60;break;
 case 'echo':accepts=Number.isFinite(m.change1hPct)&&m.change1hPct>0&&m.scalpSetup?.risePct>=.25&&m.scalpSetup?.risePct<=2;break;
 case 'nyx':{const volume=m.volume5mUsd,previous=m.volume1hUsd-volume;accepts=Number.isFinite(volume)&&Number.isFinite(previous)&&previous>0&&volume/(previous/11)>=2;break;}
 case 'sage':accepts=Number.isFinite(m.change1hPct)&&m.change1hPct>=-5&&m.change1hPct<=10&&Number.isFinite(m.evidence?.quoteReserveSol)&&m.evidence.quoteReserveSol>=50;break;
 }
 const contextPass=agentId==='atlas'||agentId==='nyx'?accepts:agentId==='echo'?Number.isFinite(m.change1hPct)&&m.change1hPct>0:agentId==='sage'?Number.isFinite(m.change1hPct)&&m.change1hPct>=-5&&m.change1hPct<=10:true;
 const risk=agentRiskChecks(agent.riskPolicy,m),riskReasons=risk.map(x=>agent.name+': '+x.reason),riskBlocked=risk.length>0;
 // Missing proof never passes a final BUY. Quote-dependent checks are deferred
 // only at the pre-quote stage, so they cannot prevent their own data fetch.
 const flags=[...r.red_flags,...(!accepts?['AGENT_HYPOTHESIS']:[]),...(riskBlocked?['AGENT_RISK']:[])];
 const ownStage=!contextPass?'market':['discovery','market'].includes(r.blockingStage)?r.blockingStage:riskBlocked?'safety':!r.eligible?r.blockingStage:!accepts?'hypothesis':'ready';
 const ownPrimary=ownStage==='safety'&&riskBlocked;
 const rank={...r,eligible:r.eligible&&accepts&&!riskBlocked,roughEligible:r.roughEligible&&contextPass,preQuoteEligible:r.preQuoteEligible&&accepts&&!risk.some(x=>!x.quote),red_flags:flags,reasons:[...r.reasons,...(!accepts?[agent.rule]:[]),...riskReasons],primaryFlags:ownPrimary?[...r.primaryFlags,'AGENT_RISK']:ownStage!==r.blockingStage&&!accepts?['AGENT_HYPOTHESIS']:r.primaryFlags,primaryReasons:ownPrimary?[...r.primaryReasons,...riskReasons]:ownStage!==r.blockingStage&&!accepts?[agent.rule]:r.primaryReasons,missingData:[...r.missingData,...(risk.some(x=>x.missing)?['AGENT_RISK']:[])],blockingStage:ownStage,agentId};
 return {eligible:rank.eligible,stage:rank.blockingStage,reason:rank.eligible?'Đạt tín hiệu '+agent.name:rank.primaryReasons.join('; ')||agent.rule,rank,m};
}
function rankAgentRows(rows){
 const order={ready:0,confirmation:1,safety:2,score:3,hypothesis:4,market:5,discovery:6};
 const best=[...rows].sort((a,b)=>Number(b.rank.preQuoteEligible&&!b.rank.red_flags.includes('UNCONFIRMED_SIGNAL'))-Number(a.rank.preQuoteEligible&&!a.rank.red_flags.includes('UNCONFIRMED_SIGNAL'))||Number(b.rank.preQuoteEligible)-Number(a.rank.preQuoteEligible)||Number(b.rank.roughEligible)-Number(a.rank.roughEligible)||(order[a.stage]??9)-(order[b.stage]??9)||b.rank.score-a.rank.score)[0]?.rank;
 return best?{...best,eligible:rows.some(x=>x.eligible),roughEligible:rows.some(x=>x.rank.roughEligible),preQuoteEligible:rows.some(x=>x.rank.preQuoteEligible),eligibleAgentIds:rows.filter(x=>x.eligible).map(x=>x.rank.agentId),previousPaper:undefined}:{eligible:false,roughEligible:false,preQuoteEligible:false,eligibleAgentIds:[],red_flags:['NO_AVAILABLE_AGENT'],blockingStage:'agent',score:0};
}
export function rankAgentUniverse(m,settings,now=Date.now()){
 return rankAgentRows(PAPER_AGENTS.map(a=>agentSignal(a.id,m,null,now,settings)));
}
// Research eligibility is per bot/lot, not per mint or current portfolio quota.
// An existing owner's signal must not stand in for another bot's confirmation.
export function rankAgentEntryUniverse(state,m,settings=state.settings,now=Date.now()){
 const orders=[state.pending,...(state.pendingEntries??[]),...(state.pendingExits??[])].filter(Boolean);
 const available=PAPER_AGENTS.filter(a=>!state.positions.some(p=>p.agentId===a.id||!p.agentId&&p.mint===m.mint)
  &&!orders.some(o=>o.side==='BUY'&&o.agentId===a.id&&o.mint!==m.mint)
  &&!((state.agentCooldowns?.[a.id]?.[m.mint]??(!state.agentCooldowns?state.cooldowns?.[m.mint]:0))>now));
 return rankAgentRows(available.map(a=>agentSignal(a.id,m,null,now,settings)));
}
export function agentCandidates(state,markets,now=Date.now()){
 const cursor=Number.isSafeInteger(state.agentCursor)?state.agentCursor%PAPER_AGENTS.length:0,out=[];
 for(let offset=0;offset<PAPER_AGENTS.length;offset++){
  const index=(cursor+offset)%PAPER_AGENTS.length,agent=PAPER_AGENTS[index];
  if(state.positions.some(p=>p.agentId===agent.id))continue;
  const rows=markets.filter(m=>!state.positions.some(p=>p.mint===m.mint&&(!p.agentId||p.agentId===agent.id))&&!((state.agentCooldowns?.[agent.id]?.[m.mint]??(!state.agentCooldowns?state.cooldowns[m.mint]:0))>now)).map(m=>{const d=agentSignal(agent.id,m,null,now,state.settings);return {m:d.m,r:d.rank};}).filter(x=>x.r.eligible);
  const compare=(a,b)=>agent.id==='zara'?b.m.change5mPct-a.m.change5mPct:agent.id==='vela'?b.m.evidence.quoteReserveSol-a.m.evidence.quoteReserveSol:agent.id==='orin'?(b.m.scalpSetup.netNewBuys??0)-(a.m.scalpSetup.netNewBuys??0):agent.id==='nyx'?b.m.volume5mUsd-a.m.volume5mUsd:agent.id==='rune'||agent.id==='sage'?a.m.change5mPct-b.m.change5mPct:comparePaperEntries({...a.m,...a.r},{...b.m,...b.r});
  for(const row of rows.sort((a,b)=>compare(a,b)||comparePaperEntries({...a.m,...a.r},{...b.m,...b.r})))out.push({...row,agent,index});
 }
 return out;
}
export function observeAgentSignals(state,markets,now=Date.now()){
 const agents={};state.agentIntents??={};const cycle=(state.agentSignals?.cycle??0)+1;
 for(const agent of PAPER_AGENTS){const stages={},decisions=[];let eligible=0;for(const m of markets){const d=agentSignal(agent.id,m,null,now,state.settings);eligible+=Number(d.eligible);stages[d.stage]=(stages[d.stage]??0)+1;decisions.push({mint:m.mint,symbol:m.symbol,taskStage:workflowDecisionStage(d.stage),taskResult:d.eligible?'pass':'skip',stage:d.stage,eligible:d.eligible,reason:d.reason,score:d.rank.score});}agents[agent.id]={at:now,cycle,evaluated:markets.length,eligible,stages,decisions:decisions.slice(0,60)};}
 // All ten publish proposals from the SAME snapshot, even while another bot's
 // quote/fill is waiting. Proposals reserve no money and never fabricate fills.
 const candidates=agentCandidates(state,markets,now);for(const a of PAPER_AGENTS){const pick=candidates.find(x=>x.agent.id===a.id),old=state.agentIntents[a.id];if(pick)state.agentIntents[a.id]={agentId:a.id,policyVersion:PAPER_AGENT_VERSION,mint:pick.m.mint,pairAddress:pick.m.pairAddress,score:pick.r.score,createdAt:old?.mint===pick.m.mint?old.createdAt:now,observedAt:now,expiresAt:now+15000};else delete state.agentIntents[a.id];}
 state.agentSignals={version:PAPER_AGENT_VERSION,at:now,cycle,agents};return state.agentSignals;
}
export function recordAgentFill(state,trade){
 const id=trade.agentId??'legacy',stats=state.agentStats??={};
 const g=stats[id]??={fills:0,buys:0,sells:0,closed:0,wins:0,losses:0,realizedPnlSol:0,closedPnlSol:0,grossProfitSol:0,grossLossSol:0,modeledFeesSol:0};
 g.fills++;g[trade.side==='BUY'?'buys':'sells']++;g.modeledFeesSol+=trade.modeledFeeSol??0;
 if(trade.side==='SELL'){g.realizedPnlSol+=trade.pnlSol??0;if(trade.closed&&Number.isFinite(trade.positionPnlSol)){g.closed++;g.closedPnlSol+=trade.positionPnlSol;if(trade.positionPnlSol>0){g.wins++;g.grossProfitSol+=trade.positionPnlSol;}if(trade.positionPnlSol<0){g.losses++;g.grossLossSol-=trade.positionPnlSol;}}}
 updateAgentMetrics(g,trade);
 g.lastFill={at:trade.at,side:trade.side,symbol:trade.symbol,mint:trade.mint,pnlSol:trade.pnlSol,reason:trade.reason};
 if(!state._recordingAgentCohort){const version=trade.agentPolicyVersion??PAPER_AGENT_VERSION,cohorts=state.agentPolicyStats??={};const holder={agentStats:cohorts[version]??={},_recordingAgentCohort:true};recordAgentFill(holder,trade);}
}
export function paperAgentSnapshot(state,now=Date.now()){
 const admission=paperPortfolioAdmission(state,{now});
 return {admission,sharedMarketData:true,independentDecisions:true,version:PAPER_AGENT_VERSION,sharedCapital:true,initialVirtualSol:20,comparison:'Attributed trades in one shared portfolio; not independently funded returns. Older unattributed fills remain legacy.',agents:PAPER_AGENTS.map(agent=>{
  const stats=state.agentPolicyStats?.[PAPER_AGENT_VERSION]?.[agent.id]??{},signal=state.agentSignals?.agents?.[agent.id]??null,positions=state.positions.filter(p=>p.agentId===agent.id),pending=[state.pending,...(state.pendingExits??[]),...(state.pendingEntries??[])].filter(o=>o?.agentId===agent.id),fresh=Number.isFinite(state.agentSignals?.at)&&state.agentSignals.at<=now&&now-state.agentSignals.at<=30000;
  const intent=state.agentIntents?.[agent.id],intentFresh=intent?.policyVersion===PAPER_AGENT_VERSION&&intent.observedAt<=now&&intent.expiresAt>=now;const lastDecision=state.agentExecutionStatus?.[agent.id]??null;
  return {...agent,activePolicyVersion:PAPER_AGENT_VERSION,ownIntent:intentFresh?intent:null,lastDecision,lifetimeStats:state.agentStats?.[agent.id]??null,stats:{...stats,...agentMetricView(stats),closed:stats.closed??0,realizedPnlSol:stats.realizedPnlSol??0,expectancySol:stats.closed?stats.closedPnlSol/stats.closed:null,winRate:stats.closed?stats.wins/stats.closed:null,profitFactor:stats.grossLossSol>0?stats.grossProfitSol/stats.grossLossSol:null,insufficientSample:(stats.closed??0)<100},signal:fresh?signal:null,signalAt:signal?.at??state.agentSignals?.at??null,signalStale:!fresh,openPositions:positions.length,pending:pending.map(o=>({side:o.side,mint:o.mint})),phase:pending.some(o=>o.side==='SELL')?'exit-pending':pending.some(o=>o.side==='BUY')?'entry-pending':positions.length?'monitoring':!state.running?'paused':!fresh?'waiting-data':intentFresh?admission.allowed?'signal-ready':'portfolio-wait':'scanning'};
 }),legacyOpenPositions:state.positions.filter(p=>!p.agentId).length};
}
