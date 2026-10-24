import {PaperDesk} from './paper-desk.js';
import {paperAgentSnapshot,recordAgentFill} from './paper-agents.js';
import {paperPortfolioAdmission} from './paper-portfolio.js';
import {paperOrderSol, paperCapitalSol} from './paper-sizing.js';
import {SCALP_EXIT_RULES} from './paper-scalp.js';
import {recordEvaluation} from './scanner.js';
import {event} from './engine.js';
import {PAPER_SIZING} from './paper-sizing.js';
import {stepIndependent,LAB_EXECUTION_VERSION} from './paper-lab-execution.js';
export const LAB_VERSION='paper-open-lab-v3';
export const LAB_POLICY=Object.freeze({version:LAB_VERSION,executionVersion:LAB_EXECUTION_VERSION,entryMode:'ranking-only',uniqueEntryMints:true,strategyGatesRequired:false,reentryCooldownMs:0,independentWorkers:true,certificationsRequired:false,mode:'paper-only',maxPositions:10,allocationFraction:.025,reserveSol:.1,note:'One entry owner per mint across holdings, pending BUYs and in-flight entry quotes. Each bot ranks its own candidates. Strategy thresholds remain ranking only; real execution data and shared capital remain required. Existing duplicate holdings retain their own exits.'});
const finite=Number.isFinite,fresh=(at,now,age=30000)=>finite(at)&&at<=now&&now-at<=age;
const rules=[
 ['nova','NOVA','Tiếp diễn','Hai giá mới tăng liên tiếp, M5 >0',{},'mint'],
 ['orin','ORIN','Lực mua','≥5 mua/5m; mua/bán ≥1,2', {stopLossPct:10,firstProfitPct:12,finalProfitPct:25,trailingPct:6,stallMs:120000,maxHoldMs:480000},'blue'],
 ['vela','VELA','Pool có chiều sâu','Thanh khoản Dex ≥$5.000; M5 −10–40%',{stopLossPct:8,firstProfitPct:10,finalProfitPct:20,trailingPct:5,stallMs:240000},'teal'],
 ['kade','KADE','Chi phí thấp','M5 ≥0; ưu tiên quote vòng ≤6%',{stopLossPct:7,firstProfitPct:8,finalProfitPct:16,trailingPct:4,stallMs:120000,maxHoldMs:300000},'amber'],
 ['rune','RUNE','Nhịp sớm','M5 +1–15%; giá mới tăng sau ≥5s',{stopLossPct:9,firstProfitPct:10,finalProfitPct:20,trailingPct:6,stallMs:90000,maxHoldMs:300000},'rose'],
 ['zara','ZARA','Breakout','M5 ≥10%; volume 5m ≥$500',{stopLossPct:12,firstProfitPct:18,finalProfitPct:40,trailingPct:10,stallMs:120000,maxHoldMs:480000},'violet'],
 ['atlas','ATLAS','Cùng xu hướng','H1 >0; M5 ≥0',{stopLossPct:10,firstProfitPct:15,finalProfitPct:35,trailingPct:7,stallMs:240000},'blue'],
 ['echo','ECHO','Hồi từ giảm','M5 −15–10%; giá tăng so với lần trước',{stopLossPct:8,firstProfitPct:10,finalProfitPct:22,trailingPct:5,stallMs:120000,maxHoldMs:360000},'rose'],
 ['nyx','NYX','Volume thức dậy','Volume 5m ≥$200 và ≥1,5× nền H1 hoặc ≥1,3× quan sát trước',{stopLossPct:10,firstProfitPct:12,finalProfitPct:28,trailingPct:6,stallMs:150000,maxHoldMs:420000},'teal'],
 ['sage','SAGE','Tích lũy yên','M5 −5–5%; thanh khoản ≥$5.000; mua ≥bán',{stopLossPct:7,firstProfitPct:8,finalProfitPct:18,trailingPct:4,stallMs:240000,maxHoldMs:480000},'amber']
];
export const LAB_AGENTS=Object.freeze(rules.map(([id,name,role,preference,exit,color])=>{const rule='Ưu tiên: '+preference+'; không chặn BUY';return Object.freeze({id,name,role,rule,description:rule,color,riskPolicy:Object.freeze({version:LAB_VERSION+':'+id,label:'LAB: xếp hạng, không chặn',certificationsRequired:false,maxImpactPct:null,allocationFraction:.025}),entryRules:Object.freeze({version:LAB_VERSION+':'+id,entryMode:'ranking-only',strategyGatesRequired:false,reentryCooldownMs:0,certificationsRequired:false,rule}),exitPolicy:Object.freeze({...SCALP_EXIT_RULES,...exit,maxQuoteAgeMs:30000,agentId:id,agentPolicyVersion:LAB_VERSION})});}));
export function observeLabMarkets(state,markets,now=Date.now()){
 state.labObservations??={};const result=markets.map(m=>{const key=m.mint+':'+m.pairAddress,prior=state.labObservations[key],old=fresh(prior?.at,now,60000)&&m.updatedAt>prior.sourceAt?(now-prior.at>=5000?prior:prior.anchor??null):prior?.anchor??null;
  if(fresh(m.updatedAt,now)&&m.priceUsd>0&&(!prior||m.updatedAt>prior.sourceAt)&&( !prior||now-prior.at>=5000))state.labObservations[key]={at:now,sourceAt:m.updatedAt,priceUsd:m.priceUsd,volume5mUsd:m.volume5mUsd,anchor:old?{at:old.at,sourceAt:old.sourceAt,priceUsd:old.priceUsd,volume5mUsd:old.volume5mUsd}:null};
  return {...m,labObservation:{at:now,prior:old,risePct:old?(m.priceUsd/old.priceUsd-1)*100:null}};});
 state.labObservations=Object.fromEntries(Object.entries(state.labObservations).filter(([,x])=>now-x.at<=60000).slice(-600));return result;
}
export function labSignal(id,m,now=Date.now()){
 const a=LAB_AGENTS.find(a=>a.id===id),e=m.evidence??{},p=m.change5mPct,v=m.volume5mUsd,b=m.buys5m,s=m.sells5m,prior=m.labObservation?.prior,history=fresh(m.labObservation?.at,now)&&fresh(prior?.at,now,60000),rising=history&&m.priceUsd>prior.priceUsd;
 const common=!!a&&m.dexId==='pumpswap'&&!!m.mint&&!!m.pairAddress&&fresh(m.updatedAt,now)&&finite(m.priceUsd)&&m.priceUsd>0;
 let matches=false;if(a)switch(id){
  case 'nova':matches=finite(p)&&p>0&&rising;break;
  case 'orin':matches=Number.isSafeInteger(b)&&Number.isSafeInteger(s)&&b>=5&&s>=0&&b/Math.max(1,s)>=1.2;break;
  case 'vela':matches=finite(m.liquidityUsd)&&m.liquidityUsd>=5000&&finite(p)&&p>=-10&&p<=40;break;
  case 'kade':matches=finite(p)&&p>=0&&(!e.roundTripQuoteOk||e.roundTripLossPct<=6);break;
  case 'rune':matches=finite(p)&&p>=1&&p<=15&&rising;break;
  case 'zara':matches=finite(p)&&p>=10&&finite(v)&&v>=500;break;
  case 'atlas':matches=finite(m.change1hPct)&&m.change1hPct>0&&finite(p)&&p>=0;break;
  case 'echo':matches=finite(p)&&p>=-15&&p<=10&&rising;break;
  case 'nyx':{const background=(m.volume1hUsd-v)/11;matches=finite(v)&&v>=200&&(finite(background)&&background>0&&v/background>=1.5||history&&finite(prior.volume5mUsd)&&prior.volume5mUsd>0&&v/prior.volume5mUsd>=1.3);break;}
  case 'sage':matches=finite(p)&&p>=-5&&p<=5&&finite(m.liquidityUsd)&&m.liquidityUsd>=5000&&Number.isSafeInteger(b)&&Number.isSafeInteger(s)&&b>=s&&b>0&&s>=0;break;
 }
 const proof=e.certificationMode==='bypassed-paper'&&e.mint===m.mint&&e.pairAddress===m.pairAddress&&e.roundTripQuoteOk===true&&fresh(e.quoteCheckedAt,now,10000)&&Number.isInteger(e.decimals)&&e.decimals>=0&&e.decimals<=18&&finite(e.probeSol)&&e.probeSol>0;
 const stage=!common?'discovery':!proof?'execution':'ready',reason=!common?'Thiếu giá mới, mint/pool hoặc không phải PumpSwap':!proof?'Chờ quote mua/bán thật và decimals; không chặn bằng ngưỡng chiến lược':'Đạt '+a.name+' · LAB chỉ xếp hạng, không chặn BUY';
 const flags=stage==='ready'?[]:[stage==='execution'?'LAB_EXECUTION_QUOTE':'LAB_MARKET_DATA'];
 const accel=finite(v)&&finite(m.volume1hUsd)&&m.volume1hUsd>v?v/((m.volume1hUsd-v)/11):null,rise=history?(m.priceUsd/prior.priceUsd-1)*100:null;
 const priorities={nova:rise===null?finite(p)?p:null:rise*20+(finite(p)?p*.2:0),orin:finite(b)&&finite(s)&&b+s>0?100*b/(b+s):null,vela:finite(m.liquidityUsd)&&m.liquidityUsd>0?Math.log10(m.liquidityUsd)*15:null,kade:finite(e.roundTripLossPct)?100-e.roundTripLossPct*10:null,rune:finite(p)?100-Math.abs(p-3)*5:null,zara:finite(p)?p+(finite(v)&&v>0?Math.log10(v)*5:0):null,atlas:finite(m.change1hPct)?m.change1hPct:null,echo:rise===null?finite(p)?50-p*2:null:50+rise*20-(finite(p)?p*2:0),nyx:accel===null?null:accel*20,sage:finite(p)?100-Math.abs(p)*10:null};const score=finite(priorities[id])?Math.round(Math.max(0,Math.min(100,priorities[id]))*.7+(matches?30:0)):0;
 const rank={agentId:id,eligible:common&&proof,roughEligible:common,preQuoteEligible:common,preferenceMatched:matches,preferenceOnly:true,scoreParts:{rawPriority:finite(priorities[id])?priorities[id]:null,preferenceMatched:matches,preferenceOnly:true},blockingStage:stage,red_flags:flags,primaryFlags:flags,primaryReasons:flags.length?[reason]:[],reasons:flags.length?[reason]:[],missingData:stage==='execution'?flags:[],score:common?score:0,minScore:0,baseline:{eligible:null,score:null,blockingStage:'not-requested',flags:[]},relaxedFlags:['CERTIFICATES_BYPASSED_PAPER','STRATEGY_THRESHOLDS_RANK_ONLY','REENTRY_COOLDOWN_DISABLED'],policyVersion:LAB_VERSION,certificationsRequired:false};
 return {eligible:rank.eligible,stage,reason,rank,m};
}
export function labTokenConflict(state,agentId,mint,claims=null){return (state.positions??[]).some(p=>p.mint===mint)||[state.pending,...(state.pendingEntries??[])].some(o=>o?.side==='BUY'&&o.mint===mint&&o.agentId!==agentId)||!!(claims?.has(mint)&&claims.get(mint).agentId!==agentId);}
function available(state,a,m,now,claims=null){const pending=[state.pending,...(state.pendingEntries??[])].filter(Boolean);return !state.positions.some(p=>p.agentId===a.id)&&!pending.some(o=>o.side==='BUY'&&o.agentId===a.id&&o.mint!==m.mint)&&!labTokenConflict(state,a.id,m.mint,claims);}
export function planLabCandidates(state,markets,now=Date.now(),{cursor=state.agentCursor??0,claims=null,requireQuote=false}={}){
 const out=[],chosen=new Set(),pending=[state.pending,...(state.pendingEntries??[])].filter(Boolean);
 for(let n=0;n<LAB_AGENTS.length;n++){
  const index=(cursor+n)%LAB_AGENTS.length,agent=LAB_AGENTS[index];
  if(state.positions.some(p=>p.agentId===agent.id)||pending.some(o=>o.side==='BUY'&&o.agentId===agent.id)||[...(claims?.values()??[])].some(c=>c.agentId===agent.id))continue;
  const rows=markets.filter(m=>!chosen.has(m.mint)&&available(state,agent,m,now,claims)).map(m=>({agent,index,m,r:labSignal(agent.id,m,now).rank})).filter(c=>requireQuote?c.r.eligible:c.r.preQuoteEligible).sort((x,y)=>y.r.score-x.r.score||String(x.m.mint).localeCompare(String(y.m.mint)));
  if(rows.length){out.push(rows[0]);chosen.add(rows[0].m.mint);}
 }
 return out;
}
export function labRank(m,_settings,now=Date.now(),state=null){const rows=LAB_AGENTS.filter(a=>!state||available(state,a,m,now)).map(a=>labSignal(a.id,m,now)),best=[...rows].sort((a,b)=>Number(b.eligible)-Number(a.eligible)||Number(b.rank.preQuoteEligible)-Number(a.rank.preQuoteEligible)||Number(b.rank.roughEligible)-Number(a.rank.roughEligible))[0]?.rank;
 return best?{...best,eligible:rows.some(d=>d.eligible),roughEligible:rows.some(d=>d.rank.roughEligible),preQuoteEligible:rows.some(d=>d.rank.preQuoteEligible),eligibleAgentIds:rows.filter(d=>d.eligible).map(d=>d.rank.agentId)}:{eligible:false,roughEligible:false,preQuoteEligible:false,score:0,blockingStage:'agent',red_flags:[],primaryFlags:[],primaryReasons:[],baseline:{eligible:null},missingData:[],relaxedFlags:[]};}
function availableCash(state,ignorePendingId=null){const reserved=[state.pending,...(state.pendingEntries??[])].filter(o=>o?.side==='BUY'&&o.id!==ignorePendingId).reduce((sum,o)=>sum+Number(o.amount)/1e9+PAPER_SIZING.overheadSol,0);return state.cashSol-PAPER_SIZING.reserveSol-PAPER_SIZING.overheadSol-reserved;}
export function labAdmission(state,options={}){const base=paperPortfolioAdmission(state,options),count=state.positions.length+base.reservedEntries,capacity=LAB_POLICY.maxPositions,invalid=base.code==='PORTFOLIO_DATA_INVALID',cash=base.orderSol>0&&base.orderSol<=availableCash(state,options.ignorePendingId)+1e-9;const code=invalid?'PORTFOLIO_DATA_INVALID':!cash?'INSUFFICIENT_CASH':count>=capacity?'EXIT_CAPACITY':'READY';return {...base,allowed:code==='READY',code,policyVersion:LAB_VERSION,operationalCapacity:capacity,openRiskBudgetSol:null,remainingRiskBudgetSol:null,certificationsRequired:false,message:code==='READY'?'LAB: còn chỗ và vốn; từng bot tự xét luật, quote thật vẫn bắt buộc.':code==='EXIT_CAPACITY'?'LAB: 10 vị thế/BUY giữ chỗ đã đầy.':code==='INSUFFICIENT_CASH'?'Không đủ SOL ảo sau dự phòng và các BUY giữ chỗ.':'Dữ liệu sổ chưa hợp lệ.',warning:base.allowed?null:base.message};}
export class LabPaperDesk extends PaperDesk{
 get agents(){return LAB_AGENTS;}get agentVersion(){return LAB_VERSION;}get monitorFailureBlocksEntries(){return false;}
 async load(){await super.load();const s=this.state,seen=new Set(s.positions.map(p=>p.mint)),keep=new Set();for(const o of this.pendingOrders().filter(o=>o.side==='BUY').sort((a,b)=>a.decisionAt-b.decisionAt||a.id.localeCompare(b.id))){if(!seen.has(o.mint)){seen.add(o.mint);keep.add(o.id);}}
  const dropped=this.pendingOrders().filter(o=>o.side==='BUY'&&!keep.has(o.id));if(dropped.length){if(s.pending?.side==='BUY'&&!keep.has(s.pending.id))s.pending=null;s.pendingEntries=s.pendingEntries.filter(o=>keep.has(o.id));event(s,'LAB: hủy '+dropped.length+' BUY chưa khớp trùng token; giữ nguyên SOL và vị thế đã mở.',this.clock());}
  s.experiment=LAB_POLICY;s.entryPolicy={version:LAB_VERSION,entryMode:'ranking-only',uniqueEntryMints:true,strategyGatesRequired:false,reentryCooldownMs:0,certificationsRequired:false};s.portfolioPolicy=LAB_POLICY;s.labObservations??={};await this.save();}
 admission(options={}){return labAdmission(this.state,options);}
 claimEntryToken(agentId,mint,pairAddress){this.entryClaims??=new Map();if(labTokenConflict(this.state,agentId,mint,this.entryClaims)||this.entryClaims.has(mint))return null;const claim={agentId,mint,pairAddress,at:this.clock()};this.entryClaims.set(mint,claim);return claim;}
 releaseEntryToken(claim){if(this.entryClaims?.get(claim.mint)===claim)this.entryClaims.delete(claim.mint);}
 quoteCandidates(markets,now,cursor=0){return planLabCandidates(this.state,markets,now,{cursor,claims:this.entryClaims}).map(c=>({...c.m,labQuoteAgentId:c.agent.id}));}
 step(feed){return stepIndependent(this,feed);}
 settleExits(feed){return stepIndependent(this,feed,{exitsOnly:true});}
 buySizeMatches(o){const size=Number(o.amount)/1e9;return Number.isFinite(o.sizing?.capitalSol)&&size===o.sizing.orderSol&&size<=Math.floor(o.sizing.capitalSol*1e9/40)/1e9&&size>0&&size<=availableCash(this.state,o.id)+1e-9;}
 entrySignal(id,m,now){const d=labSignal(id,m,now);if(!labTokenConflict(this.state,id,m.mint,this.entryClaims))return d;const reason='Token đã có vị thế hoặc BUY/quote của bot khác; chọn token khác.';return {...d,eligible:false,stage:'allocation',reason,rank:{...d.rank,eligible:false,roughEligible:false,preQuoteEligible:false,blockingStage:'allocation',primaryFlags:['TOKEN_ALREADY_CLAIMED'],red_flags:['TOKEN_ALREADY_CLAIMED'],primaryReasons:[reason]}};}
 entryRank(o,m,now){return this.entrySignal(o.agentId,m,now).rank;}
 entryCandidates(markets,now){return planLabCandidates(this.state,markets,now,{claims:this.entryClaims,requireQuote:true});}
 probeAllowed(m,size){return !!size&&m.evidence?.certificationMode==='bypassed-paper'&&Math.abs(m.evidence.probeSol-size)<=1e-9&&Number.isInteger(m.evidence.decimals);}
 fillAllowed(o,m,q,size){return this.buySizeMatches(o)&&q.inAmount===o.amount&&this.entrySignal(o.agentId,m,this.clock()).eligible&&m.evidence.decimals===o.decimals;}
 entryFeatures(m,solUsd,now){return {capturedAt:now,mint:m.mint,pairAddress:m.pairAddress,solUsd,certificationMode:'bypassed-paper',unverifiedCertificates:['RugCheck','mint/freeze','token extensions','LP lock/burn','holders','dev','on-chain reserves'],safety:{roundTripLossPct:m.evidence?.roundTripLossPct,quoteReserveSol:null},rank5m:{changePct:m.change5mPct,volumeUsd:m.volume5mUsd},labObservation:m.labObservation??null};}
 evaluate(markets,now=this.clock()){
  const s=this.state,b=this.bucket(now),agents={},cycle=(s.agentSignals?.cycle??0)+1;s.agentIntents??={};
  for(const a of LAB_AGENTS){const decisions=markets.map(m=>{const d=this.entrySignal(a.id,m,now);return {mint:m.mint,symbol:m.symbol,eligible:d.eligible,stage:d.stage,reason:d.reason,score:d.rank.score,scoreParts:d.rank.scoreParts,preferenceMatched:d.rank.preferenceMatched,preferenceOnly:true,taskStage:d.stage==='execution'?'EXECUTE':'SCAN',taskResult:d.eligible?'pass':'skip'};}),stages={};for(const d of decisions)stages[d.stage]=(stages[d.stage]??0)+1;agents[a.id]={at:now,cycle,evaluated:markets.length,eligible:decisions.filter(d=>d.eligible).length,stages,decisions:decisions.slice(0,60)};const g=(b.agentSignals??={})[a.id]??={evaluated:0,eligible:0,stages:{}};g.evaluated+=markets.length;g.eligible+=agents[a.id].eligible;for(const [stage,count] of Object.entries(stages))g.stages[stage]=(g.stages[stage]??0)+count;}
  s.agentSignals={at:now,cycle,version:LAB_VERSION,agents};const candidates=planLabCandidates(s,markets,now,{claims:this.entryClaims});for(const a of LAB_AGENTS){const c=candidates.find(c=>c.agent.id===a.id);if(c)s.agentIntents[a.id]={agentId:a.id,policyVersion:LAB_VERSION,mint:c.m.mint,pairAddress:c.m.pairAddress,observedAt:now,createdAt:now,expiresAt:now+15000};else delete s.agentIntents[a.id];}
  for(const m of markets){const r=labRank(m,undefined,now),p=this.admission({now}),blocked=r.eligible&&!p.allowed,stage=blocked?'portfolio':r.blockingStage;b.evaluations++;b[r.eligible&&!blocked?'ready':'skips']++;b.stages[stage]=(b.stages[stage]??0)+1;recordEvaluation(s,{at:now,mint:m.mint,pairAddress:m.pairAddress,symbol:m.symbol,score:r.score,minScore:0,blockingStage:stage,reason:blocked?p.message:r.primaryReasons.join('; '),action:r.eligible&&!blocked?'WATCH':'SKIP',relaxedFlags:r.relaxedFlags,policyVersion:LAB_VERSION});}s.lastEvaluationAt=now;this.research?.enqueue({type:'paper_agent_signals',...s.agentSignals,experiment:LAB_POLICY});
 }
 snapshot(now=this.clock()){return {...paperAgentSnapshot(this.state,now,{agents:LAB_AGENTS,version:LAB_VERSION,admission:this.admission({now})}),execution:{version:LAB_EXECUTION_VERSION,uniqueEntryMints:true,independentWorkers:true,activeBotIds:[...(this.executionJobs?.keys()??[])],entryClaims:[...(this.entryClaims?.values()??[])]}};}
}

export function selectLabMarkets(markets,limit=60){
 const lists=LAB_AGENTS.map(a=>markets.map(m=>({m,r:labSignal(a.id,m).rank})).filter(x=>x.r.roughEligible).sort((x,y)=>y.r.score-x.r.score||String(x.m.mint).localeCompare(String(y.m.mint))).map(x=>x.m)),picked=new Map();let progress=true;
 while(picked.size<limit&&progress){progress=false;for(const list of lists){while(list.length&&picked.has(list[0].mint))list.shift();if(list.length&&picked.size<limit){const m=list.shift();picked.set(m.mint,m);progress=true;}}}
 for(const m of markets)if(picked.size<limit&&!picked.has(m.mint))picked.set(m.mint,m);return [...picked.values()];
}
