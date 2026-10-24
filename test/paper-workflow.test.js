import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {PaperDesk} from '../src/paper-desk.js';
import {PAPER_AGENTS,agentSignal,observeAgentSignals} from '../src/paper-agents.js';
import {paperOrderSol} from '../src/paper-sizing.js';
import {PAPER_WORKFLOW_VERSION,paperEntryWorkflow,assertPaperEntryWorkflow,paperEntryFilled,paperProfitConcentration} from '../src/paper-workflow.js';
import {paperSummary,PaperReports} from '../src/paper-reports.js';
import {paperReportEnd} from '../src/paper-schedule.js';
import {verifiedMarket} from './fixtures/verified-market.js';
const at=Date.parse('2026-10-24T01:00:00Z');
async function setup(t){
 const dir=await mkdtemp('/tmp/paper-workflow-');t.after(()=>rm(dir,{recursive:true,force:true}));let now=at,value=.5,failed=false;const tasks=[],calls=[];
 const quotes={quote:async input=>{calls.push(input);if(failed)throw Error('Jupiter HTTP 429');const out=input.side==='BUY'?9000000000:Math.floor(Number(input.amount)/9e9*value*1e9);return {...input,inAmount:input.amount,outAmount:String(out),minOut:String(out),checkedAt:now,contextSlot:1,impactPct:1};}};
 const desk=new PaperDesk(dir,quotes,{clock:()=>now});await desk.load();desk.research={enqueue:row=>tasks.push(row)};
 const feed=()=>({updatedAt:now,solUsd:150,error:null,markets:[verifiedMarket({change5mPct:20,scalpConfirmed:true,evidence:{probeSol:paperOrderSol(desk.state),decimals:6}},now)]});
 return {dir,desk,quotes,tasks,calls,feed,now:()=>now,advance:n=>now+=n,value:n=>value=n,fail:v=>failed=v};
}
async function enter(x){await x.desk.step(x.feed());const id=x.desk.state.pending.id;x.advance(2100);await x.desk.step(x.feed());assert.equal(x.desk.state.positions[0].paperPositionId,id);return id;}

test('a new order binds all four roles, fixed exits, exact size and fresh fill; receipts survive restart and SELL',async t=>{
 const x=await setup(t);await x.desk.step(x.feed());const order=x.desk.state.pending;assert.equal(order.workflow.version,PAPER_WORKFLOW_VERSION);assert.equal(order.workflow.verify.result,'pass');assert.equal(order.workflow.execute.amount,'500000000');assert.deepEqual(order.workflow.exit.policy,order.exitPolicy);assert.equal(assertPaperEntryWorkflow(order),order.workflow);
 assert.deepEqual(x.tasks.filter(t=>t.type==='paper_workflow_task').map(t=>t.stage+':'+t.result),['SCAN:lead','VERIFY:pass','EXECUTE:reserved']);
 x.advance(2100);await x.desk.step(x.feed());const buy=x.desk.state.trades[0];assert.equal(buy.workflow.status,'entry-complete');assert.equal(buy.workflow.execute.fillAt,x.now());assert.ok(buy.workflow.execute.quoteObservedAt>=order.readyAt);assert.deepEqual(x.desk.state.archiveOutbox[0].workflow,buy.workflow);
 const restored=new PaperDesk(x.dir,x.quotes,{clock:x.now});await restored.load();assert.deepEqual(restored.state.positions[0].workflow,buy.workflow);assert.equal(restored.state.cashSol,x.desk.state.cashSol);
 x.desk.state=restored.state;x.value(.39);x.advance(2000);await x.desk.step(x.feed());x.advance(2100);await x.desk.step(x.feed());const sell=x.desk.state.trades[0];assert.equal(sell.workflow.exitExecution.reason,'stop-loss');assert.equal(sell.workflow.execute.intentId,buy.id);assert.equal(sell.workflow.exitExecution.positionId,buy.id);assert.equal(sell.workflow.exitExecution.intentId,sell.id);assert.ok(x.tasks.some(t=>t.stage==='EXIT'&&t.result==='fill'));
});
test('changing a bound policy, identity, amount or removing a stage cannot move capital',async t=>{
 for(const mutate of [o=>o.exitPolicy={...o.exitPolicy,stopLossPct:25},o=>o.riskPolicy={...o.riskPolicy,maxImpactPct:10},o=>o.amount='600000000',o=>o.agentId='orin',o=>delete o.workflow.verify,o=>delete o.workflow.exit,o=>delete o.workflow]){
  const x=await setup(t);await x.desk.step(x.feed());mutate(x.desk.state.pending);const cash=x.desk.state.cashSol;x.advance(2100);await x.desk.step(x.feed());assert.equal(x.desk.state.cashSol,cash);assert.equal(x.desk.state.positions.length,0);assert.equal(x.desk.state.lastExecutionError.code,'WORKFLOW_GAP');assert.equal(x.desk.state.pending,null);
 }
});
test('failed entry snapshot is not reissued for that bot; other bots and a genuinely newer observation still get a turn',async t=>{
 const x=await setup(t);x.fail(true);const frozen=x.feed();await x.desk.step(frozen);assert.equal(x.calls.length,1);assert.equal(x.desk.state.agentExecutionStatus.nova.code,'HTTP_429');
 x.desk.state.agentCursor=0;await x.desk.step(frozen);assert.equal(x.desk.state.agentExecutionStatus.nova.code,'SNAPSHOT_SKIPPED');assert.equal(x.calls.length,2,'ORIN is not vetoed by NOVA snapshot skip');assert.equal(x.desk.state.agentExecutionStatus.orin.code,'HTTP_429');
 const restarted=new PaperDesk(x.dir,x.quotes,{clock:x.now});await restarted.load();assert.equal(Object.keys(restarted.state.entryAttemptSkips).length,2);x.desk.state=restarted.state;x.desk.state.agentCursor=0;x.advance(5000);x.fail(false);await x.desk.step(x.feed());assert.equal(x.desk.state.pending.agentId,'nova');assert.equal(x.desk.state.cashSol,20);
});
test('upgrading cancels only unreceipted BUY reservations; old positions retain money, history and independent exits',async t=>{
 const x=await setup(t);await enter(x);const before=JSON.parse(JSON.stringify(x.desk.state));delete x.desk.state.positions[0].workflow;
 x.desk.state.pending={id:'old-buy',agentId:'rune',agentPolicyVersion:before.trades[0].agentPolicyVersion,side:'BUY',mint:'old',pairAddress:'old-pool',amount:'500000000',decisionAt:x.now(),readyAt:x.now()+2000,strategyVersion:before.strategyVersion};await x.desk.save();
 const restored=new PaperDesk(x.dir,x.quotes,{clock:x.now});await restored.load();assert.equal(restored.state.pending,null);assert.equal(restored.state.cashSol,before.cashSol);assert.deepEqual(restored.state.trades,before.trades);assert.deepEqual(restored.state.positions[0].exitPolicy,before.positions[0].exitPolicy);
 x.desk.state=restored.state;x.value(.39);x.advance(2000);await x.desk.step(x.feed());x.advance(2100);await x.desk.step(x.feed());assert.equal(x.desk.state.positions.length,0);assert.equal(x.desk.state.trades[0].workflow.status,'legacy-entry');assert.equal(x.desk.state.trades[0].workflow.exitExecution.reason,'stop-loss');
});
test('missing data and missing exit plans never become successful VERIFY receipts; old or wrong fill quotes fail closed',()=>{
 const m=verifiedMarket({change5mPct:20,scalpConfirmed:true,evidence:{probeSol:.5}},at),a=PAPER_AGENTS[0],rank=agentSignal(a.id,m,null,at).rank,order={id:'intent',agentId:a.id,agentPolicyVersion:a.riskPolicy.version,mint:m.mint,pairAddress:m.pairAddress,amount:'500000000',decisionAt:at,readyAt:at+2000,entryPolicy:a.entryRules,riskPolicy:a.riskPolicy,exitPolicy:a.exitPolicy,benchmark:{mint:m.mint,side:'BUY',inAmount:'500000000',outAmount:'9000000000',minOut:'8900000000',checkedAt:at,contextSlot:1}};
 for(const bad of [{...order,exitPolicy:null},{...order,exitPolicy:{...a.exitPolicy,stopLossPct:NaN}},{...order,exitPolicy:{...a.exitPolicy,firstSellFraction:2}}])assert.throws(()=>paperEntryWorkflow(bad,m,rank,at),{code:'WORKFLOW_GAP'});
 assert.throws(()=>paperEntryWorkflow(order,{...m,evidence:{...m.evidence,mint:'wrong'}},rank,at),{code:'WORKFLOW_GAP'});assert.throws(()=>paperEntryWorkflow(order,m,{...rank,eligible:false},at),{code:'WORKFLOW_GAP'});
 order.workflow=paperEntryWorkflow(order,m,rank,at);for(const q of [{...order.benchmark,checkedAt:at},{...order.benchmark,checkedAt:at+2000,mint:'wrong'}])assert.throws(()=>paperEntryFilled(order,q,'1',at+2000),{code:'WORKFLOW_GAP'});
});
test('profit concentration labels SELL fills separately, counts partial wins once per closed position and exposes losses outside top five',()=>{
 const fills=[{id:'p1',positionId:'one',side:'SELL',closed:false,pnlSol:1},{id:'p2',positionId:'one',side:'SELL',closed:true,pnlSol:.5,positionPnlSol:1.5},{id:'loss',positionId:'two',side:'SELL',closed:true,pnlSol:-1.2,positionPnlSol:-1.2}];
 const c=paperProfitConcentration(fills);assert.equal(c.sellFills,3);assert.equal(c.topFiveShareOfGrossProfitPct,100);assert.ok(Math.abs(c.topFiveShareOfNetProfitPct-500)<1e-9);assert.equal(c.pnlWithoutTopFiveSellFillsSol,-1.2);assert.equal(c.topFivePositiveSellFills[0].closed,false);
 const summary=paperSummary(fills);assert.equal(summary.closedPositions,2);assert.equal(summary.wins,1);assert.equal(summary.winRate,.5);assert.deepEqual(summary.profitConcentration,c);
 assert.equal(paperProfitConcentration([{side:'SELL'}]).netRealizedPnlSol,null);assert.equal(paperProfitConcentration([]).topFiveShareOfGrossProfitPct,null);
});
test('all ten retain their own decision roles; Telegram daily message carries profit concentration and audit coverage',async t=>{
 const x=await setup(t);observeAgentSignals(x.desk.state,x.feed().markets,x.now());assert.equal(Object.keys(x.desk.state.agentSignals.agents).length,10);assert.ok(Object.values(x.desk.state.agentSignals.agents).every(g=>g.decisions.every(d=>['SCAN','VERIFY','EXECUTE'].includes(d.taskStage))));
 await enter(x);x.value(.39);x.advance(2000);await x.desk.step(x.feed());x.advance(2100);await x.desk.step(x.feed());
 const end=paperReportEnd(x.now())+86400000,reports=new PaperReports(x.dir);await reports.tick(x.desk,end);assert.equal(reports.error,null);const doc=JSON.parse((await reports.document({end,part:1})).content);assert.equal(doc.summary.workflowAudit.receiptedBuyFills,1);assert.equal(doc.summary.workflowTasks.EXECUTE.fill,1);assert.equal(doc.summary.workflowTasks.EXIT.fill,1);const text=x.desk.state.telegramOutbox.find(x=>x.id.endsWith(':summary')).text;assert.match(text,/Top 5 lượt SELL/);assert.match(text,/BUY có phiếu 4 bước: 1\/1/);for(const a of PAPER_AGENTS)assert.ok(text.includes(a.name+':'));assert.ok(text.length<4096);
});
