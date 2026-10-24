import {PaperDesk} from './paper-desk.js';
import {paperAgentSnapshot,recordAgentFill} from './paper-agents.js';
import {paperPortfolioAdmission} from './paper-portfolio.js';
import {paperOrderSol, paperCapitalSol} from './paper-sizing.js';
import {SCALP_EXIT_RULES} from './paper-scalp.js';
import {recordEvaluation} from './scanner.js';
import {PAPER_SIZING} from './paper-sizing.js';
import {stepIndependent,LAB_EXECUTION_VERSION} from './paper-lab-execution.js';
export const LAB_VERSION='paper-open-lab-v1';
export const LAB_POLICY=Object.freeze({version:LAB_VERSION,executionVersion:LAB_EXECUTION_VERSION,independentWorkers:true,certificationsRequired:false,mode:'paper-only',maxPositions:10,allocationFraction:.025,reserveSol:.1,note:'Ten independent execution workers; only shared capital commits and provider rate limits are coordinated. Real quotes, decimals, fees and delay remain required.'});
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
export const LAB_AGENTS=Object.freeze(rules.map(([id,name,role,rule,exit,color])=>Object.freeze({id,name,role,rule,description:rule,color,riskPolicy:Object.freeze({version:LAB_VERSION+':'+id,label:'LAB: bỏ chứng nhận',certificationsRequired:false,maxImpactPct:null,allocationFraction:.025}),entryRules:Object.freeze({version:LAB_VERSION+':'+id,certificationsRequired:false,rule}),exitPolicy:Object.freeze({...SCALP_EXIT_RULES,...exit,maxQuoteAgeMs:30000,agentId:id,agentPolicyVersion:LAB_VERSION})})));
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
 const context= id==='nova'?finite(p)&&p>0:id==='rune'?finite(p)&&p>=1&&p<=15:id==='echo'?finite(p)&&p>=-15&&p<=10:matches;
 const proof=e.certificationMode==='bypassed-paper'&&e.mint===m.mint&&e.pairAddress===m.pairAddress&&e.roundTripQuoteOk===true&&fresh(e.quoteCheckedAt,now,10000)&&Number.isInteger(e.decimals)&&e.decimals>=0&&e.decimals<=18&&finite(e.probeSol)&&e.probeSol>0;
 const stage=!common?'discovery':!matches?'market':!proof?'execution':'ready',reason=!common?'Thiếu giá mới, mint/pool hoặc không phải PumpSwap':!matches?a?.rule??'Bot không hợp lệ':!proof?'Chờ quote mua/bán thật và decimals; không yêu cầu chứng nhận an toàn':'Đạt '+a.name+' · LAB bỏ chứng nhận';
 const flags=stage==='ready'?[]:[stage==='execution'?'LAB_EXECUTION_QUOTE':stage==='market'?'LAB_HYPOTHESIS':'LAB_MARKET_DATA'];
 const accel=finite(v)&&finite(m.volume1hUsd)&&m.volume1hUsd>v?v/((m.volume1hUsd-v)/11):null,rise=history?(m.priceUsd/prior.priceUsd-1)*100:null;
 const priorities={nova:rise===null?null:rise*20,orin:finite(b)&&finite(s)&&b+s>0?100*b/(b+s):null,vela:finite(m.liquidityUsd)&&m.liquidityUsd>0?Math.log10(m.liquidityUsd)*15:null,kade:finite(e.roundTripLossPct)?100-e.roundTripLossPct*10:null,rune:finite(p)?p*6:null,zara:finite(p)?p:null,atlas:finite(m.change1hPct)?m.change1hPct:null,echo:rise===null?null:rise*25,nyx:accel===null?null:accel*20,sage:finite(p)?100-Math.abs(p)*10:null};const score=finite(priorities[id])?Math.round(Math.max(0,Math.min(100,priorities[id]))):0;
 const rank={agentId:id,eligible:common&&matches&&proof,roughEligible:common&&context,preQuoteEligible:common&&matches,blockingStage:stage,red_flags:flags,primaryFlags:flags,primaryReasons:flags.length?[reason]:[],reasons:flags.length?[reason]:[],missingData:stage==='execution'?flags:[],score:common?score:0,minScore:0,baseline:{eligible:null,score:null,blockingStage:'not-requested',flags:[]},relaxedFlags:['CERTIFICATES_BYPASSED_PAPER'],policyVersion:LAB_VERSION,certificationsRequired:false};
 return {eligible:rank.eligible,stage,reason,rank,m};
}
function available(state,a,m,now){const pending=[state.pending,...(state.pendingEntries??[])].filter(Boolean);return !state.positions.some(p=>p.agentId===a.id||!p.agentId&&p.mint===m.mint)&&!pending.some(o=>o.side==='BUY'&&o.agentId===a.id&&o.mint!==m.mint)&&!(state.agentCooldowns?.[a.id]?.[m.mint]>now);}
export function labRank(m,_settings,now=Date.now(),state=null){const rows=LAB_AGENTS.filter(a=>!state||available(state,a,m,now)).map(a=>labSignal(a.id,m,now)),best=[...rows].sort((a,b)=>Number(b.eligible)-Number(a.eligible)||Number(b.rank.preQuoteEligible)-Number(a.rank.preQuoteEligible)||Number(b.rank.roughEligible)-Number(a.rank.roughEligible))[0]?.rank;
 return best?{...best,eligible:rows.some(d=>d.eligible),roughEligible:rows.some(d=>d.rank.roughEligible),preQuoteEligible:rows.some(d=>d.rank.preQuoteEligible),eligibleAgentIds:rows.filter(d=>d.eligible).map(d=>d.rank.agentId)}:{eligible:false,roughEligible:false,preQuoteEligible:false,score:0,blockingStage:'agent',red_flags:[],primaryFlags:[],primaryReasons:[],baseline:{eligible:null},missingData:[],relaxedFlags:[]};}
function availableCash(state,ignorePendingId=null){const reserved=[state.pending,...(state.pendingEntries??[])].filter(o=>o?.side==='BUY'&&o.id!==ignorePendingId).reduce((sum,o)=>sum+Number(o.amount)/1e9+PAPER_SIZING.overheadSol,0);return state.cashSol-PAPER_SIZING.reserveSol-PAPER_SIZING.overheadSol-reserved;}
export function labAdmission(state,options={}){const base=paperPortfolioAdmission(state,options),count=state.positions.length+base.reservedEntries,capacity=LAB_POLICY.maxPositions,invalid=base.code==='PORTFOLIO_DATA_INVALID',cash=base.orderSol>0&&base.orderSol<=availableCash(state,options.ignorePendingId)+1e-9;const code=invalid?'PORTFOLIO_DATA_INVALID':!cash?'INSUFFICIENT_CASH':count>=capacity?'EXIT_CAPACITY':'READY';return {...base,allowed:code==='READY',code,policyVersion:LAB_VERSION,operationalCapacity:capacity,openRiskBudgetSol:null,remainingRiskBudgetSol:null,certificationsRequired:false,message:code==='READY'?'LAB: còn chỗ và vốn; từng bot tự xét luật, quote thật vẫn bắt buộc.':code==='EXIT_CAPACITY'?'LAB: 10 vị thế/BUY giữ chỗ đã đầy.':code==='INSUFFICIENT_CASH'?'Không đủ SOL ảo sau dự phòng và các BUY giữ chỗ.':'Dữ liệu sổ chưa hợp lệ.',warning:base.allowed?null:base.message};}
export class LabPaperDesk extends PaperDesk{
 get agents(){return LAB_AGENTS;}get agentVersion(){return LAB_VERSION;}get monitorFailureBlocksEntries(){return false;}
 async load(){await super.load();this.state.experiment=LAB_POLICY;this.state.entryPolicy={version:LAB_VERSION,certificationsRequired:false};this.state.portfolioPolicy=LAB_POLICY;this.state.labObservations??={};await this.save();}
 admission(options={}){return labAdmission(this.state,options);}
 step(feed){return stepIndependent(this,feed);}
 settleExits(feed){return stepIndependent(this,feed,{exitsOnly:true});}
 buySizeMatches(o){const size=Number(o.amount)/1e9;return Number.isFinite(o.sizing?.capitalSol)&&size===o.sizing.orderSol&&size<=Math.floor(o.sizing.capitalSol*1e9/40)/1e9&&size>0&&size<=availableCash(this.state,o.id)+1e-9;}
 entrySignal(id,m,now){return labSignal(id,m,now);}entryRank(o,m,now){return labSignal(o.agentId,m,now).rank;}
 entryCandidates(markets,now){const out=[],cursor=this.state.agentCursor??0;for(let n=0;n<this.agents.length;n++){const index=(cursor+n)%this.agents.length,a=this.agents[index],rows=markets.filter(m=>available(this.state,a,m,now)).map(m=>{const d=labSignal(a.id,m,now);return {agent:a,index,m,r:d.rank};}).filter(c=>c.r.eligible).sort((x,y)=>y.r.score-x.r.score||String(x.m.mint).localeCompare(String(y.m.mint)));out.push(...rows);}return out;}
 probeAllowed(m,size){return !!size&&m.evidence?.certificationMode==='bypassed-paper'&&Math.abs(m.evidence.probeSol-size)<=1e-9&&Number.isInteger(m.evidence.decimals);}
 fillAllowed(o,m,q,size){return this.buySizeMatches(o)&&q.inAmount===o.amount&&labSignal(o.agentId,m,this.clock()).eligible&&m.evidence.decimals===o.decimals;}
 entryFeatures(m,solUsd,now){return {capturedAt:now,mint:m.mint,pairAddress:m.pairAddress,solUsd,certificationMode:'bypassed-paper',unverifiedCertificates:['RugCheck','mint/freeze','token extensions','LP lock/burn','holders','dev','on-chain reserves'],safety:{roundTripLossPct:m.evidence?.roundTripLossPct,quoteReserveSol:null},rank5m:{changePct:m.change5mPct,volumeUsd:m.volume5mUsd},labObservation:m.labObservation??null};}
 evaluate(markets,now=this.clock()){
  const s=this.state,b=this.bucket(now),agents={},cycle=(s.agentSignals?.cycle??0)+1;s.agentIntents??={};
  for(const a of LAB_AGENTS){const decisions=markets.map(m=>{const d=labSignal(a.id,m,now);return {mint:m.mint,symbol:m.symbol,eligible:d.eligible,stage:d.stage,reason:d.reason,score:d.rank.score,taskStage:d.stage==='execution'?'EXECUTE':'SCAN',taskResult:d.eligible?'pass':'skip'};}),stages={};for(const d of decisions)stages[d.stage]=(stages[d.stage]??0)+1;agents[a.id]={at:now,cycle,evaluated:markets.length,eligible:decisions.filter(d=>d.eligible).length,stages,decisions:decisions.slice(0,60)};const g=(b.agentSignals??={})[a.id]??={evaluated:0,eligible:0,stages:{}};g.evaluated+=markets.length;g.eligible+=agents[a.id].eligible;for(const [stage,count] of Object.entries(stages))g.stages[stage]=(g.stages[stage]??0)+count;}
  s.agentSignals={at:now,cycle,version:LAB_VERSION,agents};const candidates=this.entryCandidates(markets,now);for(const a of LAB_AGENTS){const c=candidates.find(c=>c.agent.id===a.id);if(c)s.agentIntents[a.id]={agentId:a.id,policyVersion:LAB_VERSION,mint:c.m.mint,pairAddress:c.m.pairAddress,observedAt:now,createdAt:now,expiresAt:now+15000};else delete s.agentIntents[a.id];}
  for(const m of markets){const r=labRank(m,undefined,now),p=this.admission({now}),blocked=r.eligible&&!p.allowed,stage=blocked?'portfolio':r.blockingStage;b.evaluations++;b[r.eligible&&!blocked?'ready':'skips']++;b.stages[stage]=(b.stages[stage]??0)+1;recordEvaluation(s,{at:now,mint:m.mint,pairAddress:m.pairAddress,symbol:m.symbol,score:r.score,minScore:0,blockingStage:stage,reason:blocked?p.message:r.primaryReasons.join('; '),action:r.eligible&&!blocked?'WATCH':'SKIP',relaxedFlags:['CERTIFICATES_BYPASSED_PAPER'],policyVersion:LAB_VERSION});}s.lastEvaluationAt=now;this.research?.enqueue({type:'paper_agent_signals',...s.agentSignals,experiment:LAB_POLICY});
 }
 snapshot(now=this.clock()){return {...paperAgentSnapshot(this.state,now,{agents:LAB_AGENTS,version:LAB_VERSION,admission:this.admission({now})}),execution:{version:LAB_EXECUTION_VERSION,independentWorkers:true,activeBotIds:[...(this.executionJobs?.keys()??[])]}};}
}

export function selectLabMarkets(markets,limit=60){
 const lists=LAB_AGENTS.map(a=>markets.map(m=>({m,r:labSignal(a.id,m).rank})).filter(x=>x.r.roughEligible).sort((x,y)=>y.r.score-x.r.score||String(x.m.mint).localeCompare(String(y.m.mint))).map(x=>x.m)),picked=new Map();let progress=true;
 while(picked.size<limit&&progress){progress=false;for(const list of lists){while(list.length&&picked.has(list[0].mint))list.shift();if(list.length&&picked.size<limit){const m=list.shift();picked.set(m.mint,m);progress=true;}}}
 for(const m of markets)if(picked.size<limit&&!picked.has(m.mint))picked.set(m.mint,m);return [...picked.values()];
}
