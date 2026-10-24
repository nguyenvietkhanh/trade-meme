import {PAPER_WORKFLOW_VERSION,paperEntrySnapshotKey,paperEntryWorkflow,assertPaperEntryWorkflow,paperEntryFilled,paperExitWorkflow} from './paper-workflow.js';
import path from 'node:path';
import {PAPER_AGENTS,PAPER_AGENT_VERSION,rankAgentUniverse,agentMarket,agentSignal,agentCandidates,observeAgentSignals,recordAgentFill} from './paper-agents.js';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {writeDurable} from './persistence.js';
import {freshState,recordBuy,recordSell,exitPlan,event} from './engine.js';
import {TRADE_RULES,executionSlippageBps,canFundBuy} from './desk-rules.js';
import {paperOrderSol,paperCapitalSol,PAPER_SIZING} from './paper-sizing.js';
import {PAPER_PORTFOLIO_POLICY,paperPortfolioAdmission,recordExitSurveillance} from './paper-portfolio.js';
import {rankPaperMarket as rankLegacyMarket,PAPER_ENTRY_POLICY,paperEntryFeatures} from './paper-policy.js';
import {recordEvaluation} from './scanner.js';
import {paperReportEnd as reportEnd} from './paper-schedule.js';
import {paperLotKey,samePaperLot,paperMark} from './paper-identity.js';
import {withRpcPriority} from './rpc-priority.js';
import {SCALP_STRATEGY_VERSION,SCALP_EXIT_RULES,SCALP_ENTRY_RULES,scalpExitPlan,compare5m,isScalpVersion,modeledNormalRoundTripPct,PAPER_NORMAL_HAIRCUT_BPS} from './paper-scalp.js';
export const PAPER_MODEL=Object.freeze({initialSol:20,delayMs:2000,feeSol:.000025,rentSol:.00203928,normalFillSlippageBps:PAPER_NORMAL_HAIRCUT_BPS,fill:'fresh quote after 2s; modeled 1.5% slippage (emergency 10%), bounded by quote and original intent; no MEV/inclusion simulation'});
const PAPER_ERROR_CODES=new Set(['WORKFLOW_GAP','INTENT_EXPIRED','BUY_GATE_CHANGED','BUY_EVIDENCE_EXPIRED','QUOTE_BEFORE_DELAY','SLIPPAGE_LIMIT','SIZE_DEPTH_COST_LIMIT','PROVIDER_BACKOFF','QUOTE_QUEUE_BUSY','EXIT_QUOTES_STALE','EXIT_REQUIRED','EXIT_PROVIDER_UNAVAILABLE','EXIT_CAPACITY','PORTFOLIO_RISK_LIMIT','PORTFOLIO_DATA_INVALID']);
const paperError=(code,message)=>Object.assign(Error(message),{code});
const round=n=>Math.round(n*1e9)/1e9;
const fresh=(t,now,maxAgeMs=30000)=>Number.isFinite(t)&&t<=now&&now-t<=maxAgeMs;
export function newPaperState(now=Date.now()){
 const s=freshState(now);return {...s,mode:'paper',paperVersion:1,session:randomUUID(),generation:0,startedAt:now,running:true,automationRequested:true,cashSol:20,peakEquity:20,dayStartEquity:20,strategyVersion:SCALP_STRATEGY_VERSION,settings:{...TRADE_RULES,initialSol:20,requireExecutableQuote:true},sizingPolicy:PAPER_SIZING,portfolioPolicy:PAPER_PORTFOLIO_POLICY,model:PAPER_MODEL,entryPolicy:PAPER_ENTRY_POLICY,exitPolicy:SCALP_EXIT_RULES,concurrentAgentEntries:true,agentCooldowns:{},pending:null,pendingEntries:[],pendingExits:[],marks:{},rentLockedSol:0,archiveOutbox:[],telegramOutbox:[],periods:{},reportLastEnd:reportEnd(now),executionErrors:0};
}
export function validPaperState(s){
 const exits=s?.pendingExits??[],entries=s?.pendingEntries??[],orders=[s?.pending,...(Array.isArray(exits)?exits:[]),...(Array.isArray(entries)?entries:[])].filter(Boolean);
 return Array.isArray(entries)&&entries.every(o=>o?.side==='BUY'&&typeof o.id==='string'&&typeof o.mint==='string'&&/^[1-9]\d*$/.test(o.amount)&&Number.isFinite(o.readyAt)&&Number.isFinite(o.decisionAt))&&Array.isArray(exits)&&exits.every(o=>o?.side==='SELL'&&typeof o.id==='string'&&typeof o.mint==='string'&&/^[1-9]\d*$/.test(o.amount)&&Number.isFinite(o.readyAt)&&Number.isFinite(o.decisionAt))&&new Set(orders.map(paperLotKey)).size===orders.length&&s?.paperVersion===1&&s.mode==='paper'&&typeof s.session==='string'&&Number.isSafeInteger(s.generation)&&s.generation>=0&&Number.isFinite(s.cashSol)&&s.cashSol>=0&&Array.isArray(s.positions)&&Array.isArray(s.trades)&&Array.isArray(s.archiveOutbox)&&s.settings?.initialSol===20&&s.positions.every(p=>typeof p.rawQuantity==='string'&&/^[1-9]\d*$/.test(p.rawQuantity)&&p.quantity>0&&p.costSol>0);
}
export class PaperDesk{
 constructor(dir,quotes,{clock=Date.now}={}){this.dir=dir;this.quotes=quotes;this.clock=clock;this.chain=Promise.resolve();this.busy=false;this.cursor=0;}
 get agents(){return PAPER_AGENTS;}
 get agentVersion(){return PAPER_AGENT_VERSION;}
 get monitorFailureBlocksEntries(){return true;}
 admission(options={}){return paperPortfolioAdmission(this.state,options);}
 entryCandidates(markets,now){return agentCandidates(this.state,markets,now);}
 entrySignal(id,m,now){return agentSignal(id,m,null,now,this.state.settings);}
 entryFeatures(m,solUsd,now){return paperEntryFeatures(m,solUsd,now);}
 probeAllowed(m,size){return !!size&&Math.abs((m.evidence?.probeSol??0)-size)<=1e-9&&size<=m.evidence.quoteReserveSol*.02&&Number.isInteger(m.evidence.decimals);}
 fillAllowed(o,m,q,size){return Math.abs(paperOrderSol(this.state,{ignorePendingId:o.id})-size)<=1e-9&&q.impactPct<=(o.riskPolicy?.maxImpactPct??2)&&size<=m.evidence.quoteReserveSol*(o.riskPolicy?.maxOrderReservePct??2)/100&&Math.abs(m.evidence.probeSol-size)<=1e-9&&canFundBuy(this.state.cashSol,size,this.state.settings.reserveSol)&&m.evidence.roundTripLossPct+2*PAPER_MODEL.feeSol/size*100<=8&&modeledNormalRoundTripPct(m.evidence.roundTripLossPct)<=SCALP_ENTRY_RULES.maxModeledRoundTripPct;}
 serial(fn){const p=this.chain.then(fn);this.chain=p.catch(()=>{});return p;}
 async load(){
  await mkdir(this.dir,{recursive:true,mode:0o700});const docs=[];let exists=false;
  for(const name of ['ledger.json','ledger.backup.json'])try{const raw=await readFile(path.join(this.dir,name),'utf8');exists=true;const doc=JSON.parse(raw);if(validPaperState(doc))docs.push(doc);}catch(e){if(e.code!=='ENOENT')exists=true;}
  if(!docs.length&&exists)throw Error('Sổ paper bị lỗi; dừng, không tự cấp lại 20 SOL.');
  this.state=docs.sort((a,b)=>b.generation-a.generation)[0]??newPaperState(this.clock());
  // Software rules remain the deployed version; virtual capital is never read from a wallet.
  this.state.settings={...TRADE_RULES,initialSol:20,requireExecutableQuote:true};this.state.model=PAPER_MODEL;this.state.entryPolicy=PAPER_ENTRY_POLICY;this.state.exitPolicy=SCALP_EXIT_RULES;this.state.strategyVersion=SCALP_STRATEGY_VERSION;
  this.state.sizingPolicy=PAPER_SIZING;this.state.portfolioPolicy=PAPER_PORTFOLIO_POLICY;this.state.pendingExits??=[];this.state.pendingEntries??=[];this.state.concurrentAgentEntries=true;this.state.agentCooldowns??={};this.state.entryAttemptSkips??={};this.state.workflowStartedAt??=this.clock();this.state.workflowVersion=PAPER_WORKFLOW_VERSION;
  if(!this.state.paperLotMarksVersion){for(const p of this.state.positions){const old=this.state.marks[p.mint];if(p.agentId&&this.state.positions.filter(x=>x.mint===p.mint).length===1&&old?.rawAmount===p.rawQuantity&&!this.state.marks[paperLotKey(p)])this.state.marks[paperLotKey(p)]={...old,positionId:p.paperPositionId};}this.state.paperLotMarksVersion=1;}
  for(const p of this.state.positions)if(p.agentId)delete this.state.marks[p.mint];
  if(!this.state.positions.length&&this.state.exitSurveillance)this.state.exitSurveillance.lastAttemptAt=null;
  for(const p of this.state.positions)p.paperPositionId??=randomUUID();
  // Apply the entry policy to known closed receipts without changing any fill or PnL.
  for(const t of this.state.trades)if(t.side==='SELL'&&t.closed&&Number.isFinite(t.at)&&t.at<=this.clock()){
   this.state.cooldowns[t.mint]=Math.max(this.state.cooldowns[t.mint]??0,t.at+SCALP_ENTRY_RULES.reentryMs);
   if(t.agentId){const own=this.state.agentCooldowns[t.agentId]??={};own[t.mint]=Math.max(own[t.mint]??0,t.at+SCALP_ENTRY_RULES.reentryMs);}
  }
  if(this.state.pending?.side==='BUY'&&this.state.pending.strategyVersion!==SCALP_STRATEGY_VERSION){this.state.pending=null;event(this.state,'Đã hủy ý định BUY của chính sách paper cũ; chờ gainers 5m mới.');}
  this.state.pendingEntries=this.state.pendingEntries.filter(o=>o.agentPolicyVersion===this.agentVersion);if(this.state.pending?.side==='BUY'&&this.state.pending.agentId&&this.state.pending.agentPolicyVersion!==this.agentVersion){this.state.pending=null;event(this.state,'PAPER · hủy BUY chưa khớp của nhóm bot cũ; không đổi số dư/vị thế.');}
  const oldBuys=this.pendingOrders().filter(o=>o.side==='BUY'&&o.workflow?.version!==PAPER_WORKFLOW_VERSION);
  if(oldBuys.length){this.state.pendingEntries=this.state.pendingEntries.filter(o=>!oldBuys.includes(o));if(oldBuys.includes(this.state.pending))this.state.pending=null;event(this.state,'PAPER · hủy BUY chưa có phiếu SCAN/VERIFY/EXECUTE/EXIT; giữ nguyên vốn và vị thế, chờ ảnh thị trường mới.');}
  await this.save();
 }
 async save(){if(!validPaperState(this.state))throw Error('Paper ledger invariant failed');this.state.generation++;await writeDurable(path.join(this.dir,'ledger.json'),this.state);await writeDurable(path.join(this.dir,'ledger.backup.json'),this.state);}
 pendingOrders(){return [this.state.pending,...(this.state.pendingExits??[]),...(this.state.pendingEntries??[])].filter(Boolean);}
 enqueueExit(order){
  const s=this.state;if(this.pendingOrders().some(o=>o.side==='SELL'&&samePaperLot(o,order)))return;this.workflowTask('EXIT','trigger',order,order.reason);
  if(s.pending?.side==='BUY'){(s.pendingEntries??=[]).push(s.pending);s.pending=null;}
  if(!s.pending)s.pending=order;else (s.pendingExits??=[]).push(order);
 }
 promoteExit(dueOnly=false){
  const s=this.state,now=this.clock(),orders=this.pendingOrders().filter(o=>o.side==='SELL'&&(!dueOnly||o.readyAt<=now)).sort((a,b)=>(a.lastErrorAt??a.decisionAt)-(b.lastErrorAt??b.decisionAt));
  const next=orders[0];if(!next||next===s.pending)return;
  s.pendingExits=s.pendingExits.filter(o=>o!==next);if(s.pending?.side==='SELL')s.pendingExits.push(s.pending);else if(s.pending?.side==='BUY')(s.pendingEntries??=[]).push(s.pending);s.pending=next;
 }
 promoteEntry(dueOnly=false){
  const s=this.state,now=this.clock();if(s.pending?.side==='SELL')return;
  const options=this.pendingOrders().filter(o=>o.side==='BUY'&&(!dueOnly||o.readyAt<=now)).sort((a,b)=>(a.lastErrorAt??a.decisionAt)-(b.lastErrorAt??b.decisionAt)),next=options[0];if(!next||next===s.pending)return;
  s.pendingEntries=(s.pendingEntries??[]).filter(o=>o!==next);if(s.pending)s.pendingEntries.push(s.pending);s.pending=next;
 }
 entryRank(order,m,now){return order.agentId?agentSignal(order.agentId,m,null,now,this.state.settings).rank:rankLegacyMarket(m,this.state.settings,now);}
 workflowTask(stage,result,order,reason,at=this.clock()){
  const counts=this.bucket(at).workflowTasks??={};const group=counts[stage]??={};group[result]=(group[result]??0)+1;
  this.research?.enqueue({type:'paper_workflow_task',version:PAPER_WORKFLOW_VERSION,at,stage,result,intentId:order?.id??null,agentId:order?.agentId??null,mint:order?.mint??null,pairAddress:order?.pairAddress??null,positionId:order?.positionId??null,marketObservedAt:order?.workflow?.scan?.marketObservedAt??order?.marketObservedAt??null,snapshotKey:order?.workflow?.snapshotKey??order?.snapshotKey??null,reason});
 }
 skipEntrySnapshot(key,reason,at=this.clock()){if(!key)return;const skips=this.state.entryAttemptSkips??={};skips[key]={at,reason};this.state.entryAttemptSkips=Object.fromEntries(Object.entries(skips).slice(-256));}
 async prepareEntries(feed){
  const s=this.state;let attempted=0;const attemptedAgents=new Set(),attemptedMints=new Set(),candidates=this.entryCandidates(feed.markets,this.clock());
  for(const {m,r,agent,index}of candidates){
   if(attempted>=2)break;if(attemptedAgents.has(agent.id)||attemptedMints.has(m.mint))continue;if(this.pendingOrders().some(o=>samePaperLot(o,{agentId:agent.id,mint:m.mint})||o.side==='BUY'&&o.agentId===agent.id)||s.positions.some(p=>p.agentId===agent.id))continue;
   const now=this.clock(),portfolio=this.admission({now}),size=paperOrderSol(s);s.lastPortfolioAdmission={at:now,...portfolio};
   s.agentExecutionStatus??={};if(!portfolio.allowed){s.agentExecutionStatus[agent.id]={at:now,code:portfolio.code,message:portfolio.message};continue;}
   if(!this.probeAllowed(m,size)){s.agentExecutionStatus[agent.id]={at:now,code:'SIZE_PROOF_WAIT',message:'Chờ quote vòng và decimals đúng cỡ lệnh.'};continue;}
   const amount=String(Math.round(size*1e9)),snapshotKey=paperEntrySnapshotKey(agent.id,m,amount);
   if(s.entryAttemptSkips?.[snapshotKey]){s.agentExecutionStatus[agent.id]={at:now,code:'SNAPSHOT_SKIPPED',message:'Ảnh dữ liệu này đã bị bỏ qua; chờ dữ liệu mới, không tạo lại cùng ý định.'};continue;}
   const task={id:randomUUID(),agentId:agent.id,mint:m.mint,pairAddress:m.pairAddress,marketObservedAt:m.updatedAt,snapshotKey};this.workflowTask('SCAN','lead',task,'fresh-market-candidate',now);this.workflowTask('VERIFY','pass',task,'own-signal-and-hard-checks',now);
   attempted++;attemptedAgents.add(agent.id);attemptedMints.add(m.mint);s.agentCursor=(index+1)%this.agents.length;try{const q=await this.readQuote(m.mint,'BUY',amount),at=this.clock();if(Number.isFinite(agent.riskPolicy.maxImpactPct)&&q.impactPct>agent.riskPolicy.maxImpactPct)throw Error('Paper BUY impact exceeds own risk profile.');
    const latest=this.entrySignal(agent.id,m,at),admission=this.admission({now:at});if(!latest.eligible||!admission.allowed)throw paperError('BUY_GATE_CHANGED','Signal or shared capital changed before intent reservation.');
    const features={...this.entryFeatures(m,feed.solUsd,at),score:latest.rank.score,scoreParts:latest.rank.scoreParts,strategyVersion:agent.entryRules.version,policyVersion:agent.entryRules.version};
    const order={agentId:agent.id,agentPolicyVersion:this.agentVersion,id:task.id,side:'BUY',mint:m.mint,pairAddress:m.pairAddress,amount,reason:`${agent.id}:${m.change5mPct}%:score:${r.score}`,decisionAt:at,readyAt:at+PAPER_MODEL.delayMs,benchmark:q,entryFeatures:features,baseline:r.baseline,relaxedFlags:r.relaxedFlags,entryPolicy:agent.entryRules,riskPolicy:agent.riskPolicy,exitPolicy:agent.exitPolicy,strategyVersion:SCALP_STRATEGY_VERSION,portfolioAtEntry:admission,sizing:{...PAPER_SIZING,capitalSol:paperCapitalSol(s),orderSol:size},scalpSetup:m.scalpSetup??null,decimals:m.evidence.decimals};
    order.workflow=paperEntryWorkflow(order,m,latest.rank,at);this.workflowTask('EXECUTE','reserved',order,'capital-and-exit-plan-reserved',at);
    if(!s.pending)s.pending=order;else (s.pendingEntries??=[]).push(order);s.agentCursor=(index+1)%this.agents.length;s.agentExecutionStatus[agent.id]={at,code:'ENTRY_RESERVED',message:'Đã dành vốn; chờ quote khớp sau độ trễ.'};
   }catch(error){const code=this.error(error,this.clock(),{side:'BUY',mint:m.mint,agentId:agent.id});this.skipEntrySnapshot(snapshotKey,code);this.workflowTask('EXECUTE','skip',task,code);s.agentExecutionStatus[agent.id]={at:this.clock(),code,message:'Quote/điều kiện chưa đạt; bot khác vẫn được xét.'};}
  }
 }
 monitoring(now=this.clock()){
  const s=this.state,ages=s.positions.map(p=>{const m=paperMark(s,p);return m?.rawAmount===p.rawQuantity?Math.max(0,now-m.checkedAt):null;});
  const known=ages.filter(x=>x!==null);
  return {open:s.positions.length,pendingExits:this.pendingOrders().filter(o=>o.side==='SELL').length,unquoted:ages.filter(x=>x===null).length,oldestQuoteAgeMs:known.length?Math.max(...known):s.positions.length?null:0,staleQuotes:this.valuation(now).staleMints.length,note:'Bounded quote requests; many positions can delay exact exit quotes. Market prices prioritize checks, never fabricate fills.'};
 }
 bucket(now=this.clock()){
  const key=reportEnd(now)+86400000;return this.state.periods[key]??=( {evaluations:0,ready:0,skips:0,stages:{},flags:{},providerMessages:{},executionErrors:{},equitySamples:0,maxDrawdownPct:0});
 }
 error(error,now=this.clock(),order=null){
  const b=this.bucket(now),text=String(error?.message??error),code=PAPER_ERROR_CODES.has(error?.code)?error.code:/429/.test(text)?'HTTP_429':/403/.test(text)?'HTTP_403':/NO_ROUTE/.test(text)?'NO_ROUTE':/RPC|slot/i.test(text)?'RPC':/timeout|hết thời gian/i.test(text)?'TIMEOUT':'QUOTE_OR_POLICY';
  b.executionErrors[code]=(b.executionErrors[code]??0)+1;this.state.executionErrors++;this.state.lastExecutionError={at:now,code,side:order?.side??null,mint:order?.mint??null,agentId:order?.agentId??null};event(this.state,`PAPER · chưa khớp${order?' '+order.side+' …'+order.mint.slice(-6):''}: ${code}`,now);return code;
 }
 evaluate(markets,now=this.clock()){
  const b=this.bucket(now),portfolio=paperPortfolioAdmission(this.state,{now});for(const m of markets){const r=rankAgentUniverse(m,this.state.settings,now),blocked=r.eligible&&!portfolio.allowed,stage=blocked?'portfolio':r.blockingStage,flags=blocked?[portfolio.code]:r.primaryFlags;b.evaluations++;b.previousPaperReady=(b.previousPaperReady??0)+(r.previousPaper?.eligible?1:0);b.baselineReady=(b.baselineReady??0)+(r.baseline.eligible?1:0);b.paperAdditionalReady=(b.paperAdditionalReady??0)+(r.eligible&&!r.baseline.eligible?1:0);b.tokenReady=(b.tokenReady??0)+(r.eligible?1:0);b[r.eligible&&!blocked?'ready':'skips']++;b.stages[stage]=(b.stages[stage]??0)+1;
   for(const flag of flags)b.flags[flag]=(b.flags[flag]??0)+1;
   if(m.verificationError){const text=String(m.verificationError).slice(0,240);b.providerMessages[text]=(b.providerMessages[text]??0)+1;}
   recordEvaluation(this.state,{at:now,mint:m.mint,pairAddress:m.pairAddress,symbol:m.symbol,score:r.score,minScore:r.minScore,blockingStage:stage,primaryFlags:flags,missingData:r.missingData,blockingCategory:blocked?'portfolio-admission':r.blockingCategory,tokenEligible:r.eligible,portfolioCode:portfolio.code,baseline:r.baseline,previousPaper:r.previousPaper,relaxedFlags:r.relaxedFlags,policyVersion:r.policyVersion,change5mPct:m.change5mPct,action:r.eligible&&!blocked?'WATCH':'SKIP',reason:blocked?portfolio.message:r.primaryReasons.join('; ')});
  }this.state.lastEvaluationAt=now;const signals=observeAgentSignals(this.state,markets,now);b.agentSignals??={};for(const [id,row] of Object.entries(signals.agents)){const group=b.agentSignals[id]??={evaluated:0,eligible:0,stages:{}};group.evaluated+=row.evaluated;group.eligible+=row.eligible;for(const [stage,count] of Object.entries(row.stages))group.stages[stage]=(group.stages[stage]??0)+count;}this.research?.enqueue({type:'paper_agent_signals',...signals});
 }
 valuation(now=this.clock()){
  const s=this.state,missing=s.positions.filter(p=>{const q=paperMark(s,p);return !q||q.rawAmount!==p.rawQuantity||!fresh(q.checkedAt,now,p.exitPolicy?.maxQuoteAgeMs??30000);}).map(p=>p.mint);
  const estimate=s.cashSol+s.rentLockedSol+s.positions.reduce((sum,p)=>sum+(paperMark(s,p)?.rawAmount===p.rawQuantity?paperMark(s,p).netSol:p.costSol),0);
  return {equitySol:missing.length?null:round(estimate),lastKnownEquitySol:round(estimate),staleMints:missing};
 }
 markEquity(now=this.clock()){
  const s=this.state,v=this.valuation(now),b=this.bucket(now);b.maxConcurrentPositions=Math.max(b.maxConcurrentPositions??0,s.positions.length);b.maxPendingExits=Math.max(b.maxPendingExits??0,this.pendingOrders().filter(o=>o.side==='SELL').length);
  if(v.equitySol===null){b.equityMissingSamples=(b.equityMissingSamples??0)+1;return;}
  s.peakEquity=Math.max(s.peakEquity,v.equitySol);const dd=Math.max(0,(1-v.equitySol/s.peakEquity)*100);s.maxDrawdownObservedPct=Math.max(s.maxDrawdownObservedPct,dd);
  b.equitySamples++;b.maxDrawdownPct=Math.max(b.maxDrawdownPct,dd);s.curve.push({at:now,equitySol:v.equitySol});s.curve=s.curve.slice(-1440);
 }
 quoteValid(q,mint,side,amount,now){if(q?.mint!==mint||q.side!==side||q.inAmount!==amount||!fresh(q.checkedAt,now,side==='BUY'?SCALP_ENTRY_RULES.maxQuoteAgeMs:Math.min(30000,...this.state.positions.filter(p=>p.mint===mint).map(p=>p.exitPolicy?.maxQuoteAgeMs??30000)))||!/^\d+$/.test(q.minOut??'')||BigInt(q.minOut)<=0n||!/^\d+$/.test(q.outAmount??'')||BigInt(q.minOut)>BigInt(q.outAmount)||!Number.isFinite(q.impactPct)||q.impactPct<0||!Number.isSafeInteger(q.contextSlot))throw Error('Quote paper thiếu/không khớp/đã cũ.');}
 async readQuote(mint,side,amount,reason='',minObservedAt=0){
  const q=await withRpcPriority(side==='SELL'?'exit':'background',()=>this.quotes.quote({mint,side,amount,slippageBps:executionSlippageBps(side,reason),...(minObservedAt?{minObservedAt}:{})}));this.quoteValid(q,mint,side,amount,this.clock());return q;
 }
 async monitorPosition(feed){
   const s=this.state,nowAtStart=this.clock(),queued=new Set(this.pendingOrders().filter(o=>o.side==='SELL').map(paperLotKey));
   // A fresh market price is a scheduling hint only, never an executable fill.
   // Oldest checks get a turn even if one pool keeps generating risk hints.
   const candidates=s.positions.filter(p=>!queued.has(paperLotKey(p)));
   const risk=p=>{const m=feed.markets.find(m=>m.mint===p.mint&&m.pairAddress===p.pairAddress);if(nowAtStart-p.openedAt>=(p.exitPolicy?.maxHoldMs??s.settings.maxHoldMs))return true;if(!m||!fresh(m.updatedAt,nowAtStart)||!(feed.solUsd>0&&fresh(feed.updatedAt,nowAtStart)))return false;const value=p.quantity*m.priceUsd/feed.solUsd;return value<=p.costSol*(1-(p.exitPolicy?.stopLossPct??s.settings.stopLossPct)/100)||value>=p.costSol*(1+(p.exitPolicy?.firstProfitPct??15)/100)||m.liquidityUsd<(p.peakLiquidityUsd??p.entryLiquidityUsd)*.6||m.evidence?.lpWithdrawn===true||m.evidence?.largeHolderDump===true;};
   candidates.sort((a,b)=>{const age=p=>nowAtStart-(p.paperLastMonitorAt??p.openedAt),overdue=p=>age(p)>=30000,unquoted=p=>paperMark(s,p)?.rawAmount!==p.rawQuantity;return Number(overdue(b))-Number(overdue(a))||(overdue(a)&&overdue(b)?age(b)-age(a):Number(risk(b))-Number(risk(a))||Number(unquoted(b))-Number(unquoted(a)))||age(b)-age(a)||a.mint.localeCompare(b.mint);});
   const p=candidates[0];let now=nowAtStart;
   if(p)p.paperLastMonitorAt=now;
   if(p){const m=feed.markets.find(m=>m.mint===p.mint&&m.pairAddress===p.pairAddress);let q;try{q=await this.readQuote(p.mint,'SELL',p.rawQuantity);}catch(error){recordExitSurveillance(s,{at:nowAtStart,completedAt:this.clock(),ok:false});if(s.pending?.side==='BUY'){event(s,'PAPER · ưu tiên quote SELL; giữ BUY trong hàng chờ riêng.',this.clock());(s.pendingEntries??=[]).push(s.pending);s.pending=null;}const code=this.error(error,this.clock(),{side:'SELL',mint:p.mint});this.workflowTask('EXIT','error',{agentId:p.agentId,mint:p.mint,pairAddress:p.pairAddress},code);this.research?.enqueue({type:'paper_position_quote_error',at:this.clock(),mint:p.mint,rawAmount:p.rawQuantity,code});return true;}now=this.clock();recordExitSurveillance(s,{at:nowAtStart,completedAt:now,ok:true});const netSol=Math.max(0,Number(q.minOut)/1e9-PAPER_MODEL.feeSol);
    s.marks[paperLotKey(p)]={positionId:p.paperPositionId,rawAmount:p.rawQuantity,checkedAt:q.checkedAt,netSol,provider:q.provider};
    const roi=(netSol/p.costSol-1)*100;p.paperMfePct=Math.max(p.paperMfePct??roi,roi);p.paperMaePct=Math.min(p.paperMaePct??roi,roi);this.research?.enqueue({type:'paper_position_mark',at:now,mint:p.mint,rawAmount:p.rawQuantity,netSol,checkedAt:q.checkedAt,remainingCostSol:p.costSol,roiPct:roi});
    if(isScalpVersion(p.exitPolicy?.version)||m&&fresh(m.updatedAt,now)&&feed.solUsd>0){const exitQuote={mint:p.mint,rawAmount:p.rawQuantity,checkedAt:q.checkedAt,netSol},mark={...m,mint:p.mint,pairAddress:p.pairAddress,exitQuote},plan=isScalpVersion(p.exitPolicy?.version)?scalpExitPlan(p,mark,now):exitPlan(p,{...mark,priceUsd:netSol*feed.solUsd/p.quantity},feed.solUsd,s.settings,now);
     if(plan){let amount=BigInt(p.rawQuantity)*BigInt(Math.round(plan.fraction*1e6))/1000000n;if(plan.fraction===1||BigInt(p.rawQuantity)-amount<=1n)amount=BigInt(p.rawQuantity);
      if(amount>0n){const sellQuote=amount.toString()===p.rawQuantity?q:await this.readQuote(p.mint,'SELL',amount.toString(),plan.reason);this.enqueueExit({agentId:p.agentId??null,agentPolicyVersion:p.agentPolicyVersion??null,positionId:p.paperPositionId,riskPolicy:p.riskPolicy??null,id:randomUUID(),side:'SELL',mint:p.mint,pairAddress:p.pairAddress,amount:amount.toString(),reason:plan.reason,decisionAt:now,readyAt:this.clock()+PAPER_MODEL.delayMs,benchmark:sellQuote,triggerNetSol:netSol*Number(amount)/Number(p.rawQuantity),openedAt:p.openedAt,entryFeatures:p.entryFeatures,entryPolicy:p.entryPolicy??{version:'paper-exploration-v1'},exitPolicy:p.exitPolicy??null,strategyVersion:p.strategyVersion??'paper-exploration-v1',exitTrigger:plan.trigger??null});}
     }
    }
   }
   return false;
 }
 async step(feed){
  if(this.busy)return;this.busy=true;
  try{await this.serial(async()=>{
   const s=this.state;
   this.promoteExit(true);
   if(s.pending?.side==='SELL'&&s.pending.readyAt<=this.clock()){await this.fillPending(feed);this.promoteExit();this.markEquity();await this.save();return;}
   // Continue checking OTHER positions while an exit waits for delay/retry.
   if(await this.monitorPosition(feed)&&this.monitorFailureBlocksEntries){this.markEquity();await this.save();return;}
   const now=this.clock();
   this.promoteEntry(true);
   if(s.pending&&now>=s.pending.readyAt){await this.fillPending(feed);this.promoteEntry();this.markEquity();await this.save();return;}
   this.markEquity();
   if(s.running&&fresh(feed.updatedAt,now)&&!feed.error&&feed.solUsd>0){
    const portfolio=this.admission({now});s.lastPortfolioAdmission={at:now,...portfolio};
    if(!portfolio.allowed){const b=this.bucket(now);b.portfolioBlocks??={};b.portfolioBlocks[portfolio.code]=(b.portfolioBlocks[portfolio.code]??0)+1;this.research?.enqueue({type:'paper_portfolio_skip',at:now,portfolio});}
    else await this.prepareEntries(feed);
   }await this.save();
  });}catch(e){await this.serial(async()=>{this.error(e);await this.save();});}finally{this.busy=false;}
 }
 // Fast wake-up only for already-triggered exits. Does not scan, probe BUYs or
 // increase periodic holding-quote frequency; the shared provider queue still limits reads.
 async settleExits(feed){
  if(this.busy||!this.pendingOrders().some(o=>o.side==='SELL'&&o.readyAt<=this.clock()))return;
  this.busy=true;try{await this.serial(async()=>{
   this.promoteExit(true);const o=this.state.pending;
   if(o?.side!=='SELL'||o.readyAt>this.clock())return;
   await this.fillPending(feed);this.promoteExit();this.markEquity();await this.save();
  });}catch(e){await this.serial(async()=>{this.error(e);await this.save();});}finally{this.busy=false;}
 }
 async fillPending(feed){
  const s=this.state,o=s.pending,now=this.clock();
  if(now-o.decisionAt>(o.side==='BUY'&&o.strategyVersion===SCALP_STRATEGY_VERSION?10000:30000)){s.pending=null;if(o.side==='BUY')this.skipEntrySnapshot(o.workflow?.snapshotKey,'INTENT_EXPIRED',now);this.workflowTask(o.side==='BUY'?'EXECUTE':'EXIT','skip',o,'INTENT_EXPIRED',now);this.error(paperError('INTENT_EXPIRED','timeout pending paper'),now,o);return;}
  try{
   if(o.side==='BUY')assertPaperEntryWorkflow(o);
   const observed=feed.markets.find(m=>m.mint===o.mint&&m.pairAddress===o.pairAddress),held=s.positions.find(p=>samePaperLot(p,o)&&p.pairAddress===o.pairAddress&&(!o.positionId||p.paperPositionId===o.positionId)),m=observed??(o.side==='SELL'&&held?{mint:held.mint,pairAddress:held.pairAddress,symbol:held.symbol,venue:held.venue,updatedAt:null}:null);
   let solUsd=fresh(feed.updatedAt,now)&&Number.isFinite(feed.solUsd)&&feed.solUsd>0?feed.solUsd:null;
   if(!m||o.side==='SELL'&&!held||o.side==='BUY'&&(!fresh(m.updatedAt,now)||solUsd===null))throw Error('Dữ liệu market/giá SOL cũ hoặc không khớp vị thế.');
   if(o.side==='BUY'&&(!s.running||s.positions.some(p=>samePaperLot(p,o))||!this.entryRank(o,m,now).eligible||Math.abs(paperOrderSol(s,{ignorePendingId:o.id})-Number(o.amount)/1e9)>1e-9))throw paperError('BUY_GATE_CHANGED','BUY gate changed before paper fill.');
   let q;const quoteStart=this.clock();try{q=await this.readQuote(o.mint,o.side,o.amount,o.reason,o.readyAt);if(o.side==='SELL')recordExitSurveillance(s,{at:quoteStart,completedAt:this.clock(),ok:true,kind:'fill'});}catch(error){if(o.side==='SELL')recordExitSurveillance(s,{at:quoteStart,completedAt:this.clock(),ok:false,kind:'fill'});throw error;}const fillNow=this.clock();if(!fresh(feed.updatedAt,fillNow))solUsd=null;
   if(fillNow-o.decisionAt>(o.side==='BUY'&&o.strategyVersion===SCALP_STRATEGY_VERSION?10000:30000))throw paperError('INTENT_EXPIRED','timeout pending paper');
   if(q.checkedAt<o.readyAt)throw paperError('QUOTE_BEFORE_DELAY','Quote chưa mới sau độ trễ paper.');
   if(o.side==='BUY'&&(!fresh(m.updatedAt,fillNow)||!fresh(feed.updatedAt,fillNow)||!this.entryRank(o,m,fillNow).eligible))throw paperError('BUY_EVIDENCE_EXPIRED','BUY evidence expired while waiting for the quote.');
   const limit=executionSlippageBps(o.side,o.reason),benchmark=BigInt(o.benchmark.outAmount),minAllowed=benchmark*BigInt(10000-limit)/10000n;
   if(BigInt(q.outAmount)<minAllowed)throw paperError('SLIPPAGE_LIMIT','Giá sau độ trễ vượt slippage cho phép.');
   const haircut=limit===1000?1000:PAPER_MODEL.normalFillSlippageBps,modeledMin=BigInt(q.outAmount)*BigInt(10000-haircut)/10000n;
   const fillOut=[BigInt(q.minOut),modeledMin,minAllowed].reduce((a,b)=>a>b?a:b).toString();
   let costOrNet,position,closed=false;
   if(o.side==='BUY'){
    const admission=this.admission({now:fillNow,orderSol:Number(o.amount)/1e9,ignorePendingId:o.id});if(!admission.allowed)throw paperError(admission.code,admission.message);
    const size=Number(o.amount)/1e9;if(!this.fillAllowed(o,m,q,size))throw paperError('SIZE_DEPTH_COST_LIMIT','Paper size/depth/cost limit.');
    const workflow=paperEntryFilled(o,q,fillOut,fillNow);
    const quantity=Number(fillOut)/10**o.decimals;costOrNet=round(size+PAPER_MODEL.feeSol);
    recordBuy(s,m,feed.solUsd,{quantity,costSol:costOrNet,priceUsd:size*feed.solUsd/quantity,rawQuantity:fillOut,decimals:o.decimals,networkFeeSol:PAPER_MODEL.feeSol},fillNow,o.reason,'paper');
    s.cashSol=round(s.cashSol-PAPER_MODEL.rentSol);s.rentLockedSol=round(s.rentLockedSol+PAPER_MODEL.rentSol);
    position=s.positions.at(-1);position.workflow=workflow;position.agentId=o.agentId??null;position.agentPolicyVersion=o.agentPolicyVersion??null;position.paperPositionId=o.id;position.modeledBuyFeeSol=PAPER_MODEL.feeSol;position.portfolioAtEntry=o.portfolioAtEntry??null;position.entryFeatures=o.entryFeatures;position.paperBaseline=o.baseline;position.relaxedFlags=o.relaxedFlags;position.rentSol=PAPER_MODEL.rentSol;position.venue='pumpswap';position.strategyVersion=o.strategyVersion;position.entryPolicy=o.entryPolicy;position.riskPolicy=o.riskPolicy??null;position.exitPolicy=o.exitPolicy;position.scalpSetup=o.scalpSetup;s.decisionStats.bought++;
   }else{
    position=held;if(!position||BigInt(o.amount)>BigInt(position.rawQuantity))throw Error('Paper SELL balance mismatch');
    const remaining=(BigInt(position.rawQuantity)-BigInt(o.amount)).toString(),quantity=Number(o.amount)/10**position.decimals;closed=remaining==='0';costOrNet=round(Math.max(0,Number(fillOut)/1e9-PAPER_MODEL.feeSol));
    const mark={...m,priceUsd:solUsd===null?null:costOrNet*solUsd/quantity};
    const usdHistoryKnown=Number.isFinite(position.recoveredUsd);recordSell(s,mark,solUsd??0,{quantity,proceedsSol:costOrNet,priceUsd:mark.priceUsd,closed,rawBalance:remaining,networkFeeSol:PAPER_MODEL.feeSol,positionId:position.paperPositionId},fillNow,o.reason,'paper');
    if(solUsd===null||!usdHistoryKnown)position.recoveredUsd=null;
    if(!closed&&o.reason==='scalp-tp1')position.scalpFirstTaken=true;
    if(closed){s.cashSol=round(s.cashSol+position.rentSol);s.rentLockedSol=round(s.rentLockedSol-position.rentSol);s.cooldowns[o.mint]=Math.max(s.cooldowns[o.mint]??0,fillNow+SCALP_ENTRY_RULES.reentryMs);if(position.agentId){const own=(s.agentCooldowns??={})[position.agentId]??={};own[o.mint]=fillNow+SCALP_ENTRY_RULES.reentryMs;}if(!s.positions.length&&s.exitSurveillance)s.exitSurveillance.lastAttemptAt=null;}delete s.marks[paperLotKey(position)];
   }
   s.cashSol=round(s.cashSol);const trade=s.trades[0];trade.agentId=position.agentId??null;trade.agentPolicyVersion=position.agentPolicyVersion??null;trade.id=o.id;trade.positionId=position.paperPositionId??null;trade.mode='paper';trade.strategyVersion=o.strategyVersion??position.strategyVersion??'paper-exploration-v1';trade.networkFeeSol=null;trade.modeledFeeSol=PAPER_MODEL.feeSol;trade.initialCostSol=position.initialCostSol;trade.riskPolicy=position.riskPolicy??null;trade.initialRiskSol=position.initialCostSol*(position.exitPolicy?.stopLossPct??s.settings.stopLossPct)/100;trade.holdingMs=o.side==='SELL'?fillNow-position.openedAt:null;trade.usdValuationStatus=solUsd===null?'unavailable':'fresh';
   trade.execution={decisionAt:o.decisionAt,readyAt:o.readyAt,fillAt:fillNow,latencyMs:fillNow-o.decisionAt,quoteObservedAt:q.checkedAt,quoteAgeMs:fillNow-q.checkedAt,contextSlot:q.contextSlot,trigger:o.exitTrigger??null,triggerNetSol:o.triggerNetSol??null,quotedOutput:q.outAmount,quoteMinOut:q.minOut,filledOutput:fillOut,slippageToleranceBps:limit,assumedHaircutBps:haircut,effectiveOutputHaircutBps:(1-Number(fillOut)/Number(q.outAmount))*10000,scenario:haircut===1000?'emergency-stress':'normal',marketDataFresh:fresh(m.updatedAt,fillNow)};
   Object.assign(trade.execution,{decisionQuotedOutput:o.benchmark.outAmount,decisionQuoteMinOut:o.benchmark.minOut,decisionQuoteObservedAt:o.benchmark.checkedAt,quoteOutputChangeVsDecisionPct:(Number(q.outAmount)/Number(o.benchmark.outAmount)-1)*100});
   const signal=o.entryFeatures??position.entryFeatures;trade.entrySignal={score:signal?.score??null,change5mPct:signal?.rank5m?.changePct??null,scalpSetup:o.scalpSetup??position.scalpSetup??null,previousPaper:signal?.previousPaper??null,roundTripLossPct:signal?.safety?.roundTripLossPct??null,estimatedNormalRoundTripPct:modeledNormalRoundTripPct(signal?.safety?.roundTripLossPct),quoteReserveSol:signal?.safety?.quoteReserveSol??null};
   trade.execution.quoteToFillCostSol=o.side==='SELL'?(Number(q.outAmount)-Number(fillOut))/1e9:null;
   trade.workflow=o.side==='BUY'?position.workflow:paperExitWorkflow(position,o,q,fillOut,fillNow);this.workflowTask(o.side==='BUY'?'EXECUTE':'EXIT','fill',o,o.reason,fillNow);
   const fill={...trade,session:s.session,pairAddress:o.pairAddress,rawAmount:o.amount,rawOutput:fillOut,decisionAt:o.decisionAt,fillAt:fillNow,holdingMs:o.side==='SELL'?fillNow-position.openedAt:null,benchmark:o.benchmark,fillQuote:q,latencyMs:fillNow-o.decisionAt,quoteAgeAtFillMs:fillNow-q.checkedAt,marketAgeAtFillMs:fillNow-m.updatedAt,outputVsDecisionPct:(Number(fillOut)/Number(o.benchmark.outAmount)-1)*100,netVsTriggerPct:o.side==='SELL'&&o.triggerNetSol>0?(costOrNet/o.triggerNetSol-1)*100:null,entryFeatures:o.entryFeatures??position.entryFeatures,entryPolicy:o.entryPolicy??position.entryPolicy??{version:'paper-exploration-v1'},exitPolicy:o.exitPolicy??position.exitPolicy??null,scalpSetup:o.scalpSetup??position.scalpSetup??null,exitTrigger:o.exitTrigger??null,baselineAtEntry:o.baseline??position.paperBaseline,relaxedFlagsAtEntry:o.relaxedFlags??position.relaxedFlags,paperMfePct:position.paperMfePct??null,paperMaePct:position.paperMaePct??null,cashAfterSol:s.cashSol,rentLockedSol:s.rentLockedSol,assumptions:PAPER_MODEL};
   trade.sizing=o.sizing??position.sizing??null;trade.portfolioAtEntry=o.portfolioAtEntry??position.portfolioAtEntry??null;if(o.side==='BUY')position.sizing=o.sizing??null;fill.sizing=trade.sizing;fill.portfolioAtEntry=trade.portfolioAtEntry;
   recordAgentFill(s,trade);s.archiveOutbox.push(fill);s.pending=null;
   event(s,`PAPER · ${trade.agentId?.toUpperCase()??'LEGACY'} · ${o.side} ${m.symbol}: ${costOrNet.toFixed(6)} SOL · ${o.reason}`,fillNow);
  }catch(e){o.attempts=(o.attempts??0)+1;o.lastErrorCode=this.error(e,this.clock(),o);o.lastErrorAt=this.clock();o.readyAt=this.clock()+PAPER_MODEL.delayMs;this.workflowTask(o.side==='BUY'?'EXECUTE':'EXIT','error',o,o.lastErrorCode);if(o.attempts>=TRADE_RULES.maxRetries||e.code==='WORKFLOW_GAP'||e.code==='INTENT_EXPIRED'||this.clock()-o.decisionAt>(o.side==='BUY'&&o.strategyVersion===SCALP_STRATEGY_VERSION?10000:30000)){if(o.side==='BUY')this.skipEntrySnapshot(o.workflow?.snapshotKey,o.lastErrorCode);s.pending=null;}else if(o.side==='BUY'){(s.pendingEntries??=[]).push(o);s.pending=null;}if(o.agentId){s.agentExecutionStatus??={};s.agentExecutionStatus[o.agentId]={at:this.clock(),code:o.lastErrorCode,message:'Khớp chưa thành công; ý định của bot khác không bị xóa.'};}}
 }
}
