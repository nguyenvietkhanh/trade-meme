import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {PaperDesk,validPaperState} from '../src/paper-desk.js';
import {PAPER_AGENTS,PAPER_AGENT_VERSION,agentSignal,recordAgentFill,paperAgentSnapshot,agentCandidates} from '../src/paper-agents.js';
import {paperLotKey,paperMark} from '../src/paper-identity.js';
import {paperReportEnd,nextPaperReportEnd,validPaperReportRef} from '../src/paper-schedule.js';
import {PaperReports,paperSummary} from '../src/paper-reports.js';
import {recordSell} from '../src/engine.js';
import {verifiedMarket} from './fixtures/verified-market.js';
const at=Date.parse('2026-10-23T14:00:00Z');
const market=(extra={},now=at)=>verifiedMarket({change5mPct:7,change1hPct:5,scalpConfirmed:true,evidence:{probeSol:.5,roundTripLossPct:1,lpSecuredPct:99},...extra},now);

test('risk profiles differ on the same market without changing shared data or weakening hard authority checks',()=>{
 assert.equal(PAPER_AGENTS.length,10);
 const m=market({evidence:{probeSol:.5,roundTripLossPct:1,lpSecuredPct:95}}),before=JSON.stringify(m);
 assert.equal(agentSignal('nova',m,null,at).eligible,true);
 assert.equal(agentSignal('sage',m,null,at).eligible,false);
 assert.match(agentSignal('sage',m,null,at).reason,/LP burn\/lock ≥99/);
 assert.equal(agentSignal('sage',market(),null,at).eligible,true);
 assert.equal(JSON.stringify(m),before);
 for(const a of PAPER_AGENTS){assert.equal(agentSignal(a.id,{...m,evidence:{...m.evidence,mintRevoked:false}},null,at).eligible,false);assert.ok(a.riskPolicy.maxTop10Pct<=35);assert.ok(a.riskPolicy.maxHolderPct<=8);assert.ok(a.riskPolicy.maxImpactPct<=2);assert.ok(a.riskPolicy.minReserveSol>=20);assert.ok(a.exitPolicy.stopLossPct<=12);}
});
test('own safety proof fails closed, but missing future quote does not prevent quote prefetch',()=>{
 const m=market({evidence:{probeSol:.5,roundTripLossPct:1,lpSecuredPct:99,roundTripQuoteOk:false,buyImpactPct:undefined,sellImpactPct:undefined}});
 const d=agentSignal('sage',m,null,at);assert.equal(d.eligible,false);assert.equal(d.rank.roughEligible,true);assert.equal(d.rank.preQuoteEligible,true);
 const absent={...m,evidence:{...m.evidence,devPct:undefined}};assert.equal(agentSignal('sage',absent,null,at).rank.preQuoteEligible,false);assert.match(agentSignal('sage',absent,null,at).reason,/Dev/);
});
test('partial exits count net basis once at full closure; margin, realized drawdown and policy cohorts stay separate',()=>{
 const s={cashSol:20,positions:[],cooldowns:{},running:true};
 const f=(extra)=>({agentId:'nova',agentPolicyVersion:PAPER_AGENT_VERSION,at,modeledFeeSol:.000025,...extra});
 const fills=[f({side:'BUY',initialCostSol:.5}),f({side:'SELL',closed:false,pnlSol:.1,initialCostSol:.5}),f({side:'SELL',closed:true,pnlSol:-.15,positionPnlSol:-.05,initialCostSol:.5})];
 for(const row of fills)recordAgentFill(s,row);
 const g=paperAgentSnapshot(s,at).agents[0].stats;
 assert.equal(g.closed,1);assert.ok(Math.abs(g.netMarginPct+10)<1e-9);assert.ok(Math.abs(g.maxRealizedDrawdownSol-.15)<1e-9);assert.equal(g.expectancySol,-.05);
 const daily=paperSummary(fills).byAgent.nova;assert.equal(daily.netMarginPct,-10);assert.equal(daily.maxRealizedDrawdownSol,.15);
 recordAgentFill(s,f({agentPolicyVersion:'old',side:'SELL',closed:true,pnlSol:10,positionPnlSol:10,initialCostSol:1}));assert.equal(paperAgentSnapshot(s,at).agents[0].stats.closed,1);
 const missing=paperSummary([f({side:'SELL',closed:true,pnlSol:.1,positionPnlSol:.1})]).byAgent.nova;assert.equal(missing.netMarginPct,null);assert.equal(missing.missingCostBasisCount,1);
});

test('two bots can own the same mint; SELL, partial basis, marks, cooldowns, cash and restart stay lot-specific',async t=>{
 const dir=await mkdtemp('/tmp/paper-lots-');t.after(()=>rm(dir,{recursive:true,force:true}));let now=at,value=.5;
 const quote=async input=>{const out=input.side==='BUY'?9000000000:Math.floor(Number(input.amount)/9e9*value*1e9);return {...input,inAmount:input.amount,outAmount:String(out),minOut:String(out),checkedAt:now,impactPct:1,contextSlot:1};};
 const desk=new PaperDesk(dir,{quote},{clock:()=>now});await desk.load();
 const feed=()=>({updatedAt:now,solUsd:150,error:null,markets:[verifiedMarket({change5mPct:20,scalpConfirmed:true,evidence:{probeSol:.5,decimals:6}},now)]});
 await desk.step(feed());now+=2100;await desk.step(feed());assert.equal(desk.state.positions[0].agentId,'nova');
 now+=100;await desk.step(feed());assert.equal(desk.state.pending.agentId,'orin');assert.equal(desk.state.pending.mint,desk.state.positions[0].mint);
 now+=2100;await desk.step(feed());assert.equal(desk.state.positions.length,2);assert.equal(new Set(desk.state.positions.map(p=>p.mint)).size,1);assert.equal(validPaperState(desk.state),true);
 const nova=desk.state.positions.find(p=>p.agentId==='nova'),orin=desk.state.positions.find(p=>p.agentId==='orin');
 assert.notEqual(nova.paperPositionId,orin.paperPositionId);assert.equal(nova.riskPolicy.version,PAPER_AGENT_VERSION+':nova');assert.equal(orin.riskPolicy.version,PAPER_AGENT_VERSION+':orin');
 // ORIN stops at -10%; NOVA has not reached its -12% stop at this quote.
 value=.445;now+=100;await desk.step(feed());assert.equal(desk.state.pending.agentId,'orin');assert.equal(desk.state.pending.side,'SELL');assert.equal(desk.state.pending.positionId,orin.paperPositionId);
 const novaQuantity=nova.rawQuantity,novaCost=nova.costSol;await desk.save();
 const restored=new PaperDesk(dir,{quote},{clock:()=>now});await restored.load();assert.equal(restored.state.positions.length,2);now+=2100;await restored.settleExits(feed());
 assert.equal(restored.state.positions.length,1);assert.equal(restored.state.positions[0].agentId,'nova');assert.equal(restored.state.positions[0].rawQuantity,novaQuantity);assert.equal(restored.state.positions[0].costSol,novaCost);
 const sale=restored.state.trades[0];assert.equal(sale.agentId,'orin');assert.equal(sale.positionId,orin.paperPositionId);assert.equal(sale.initialCostSol,orin.initialCostSol);assert.equal(restored.state.agentCooldowns.orin[sale.mint],now+86400000);assert.equal(restored.state.agentCooldowns.nova?.[sale.mint],undefined);
 assert.equal(paperMark(restored.state,orin),undefined);assert.ok(paperMark(restored.state,nova));
 // Once NOVA leaves the market, ORIN's cooldown does not veto RUNE or NOVA's signal.
 const s={positions:[],cooldowns:{[sale.mint]:now+86400000},agentCooldowns:restored.state.agentCooldowns,settings:restored.state.settings};
 assert.ok(agentCandidates(s,[market({},now)],now).some(c=>c.agent.id==='nova'));assert.ok(!agentCandidates(s,[market({},now)],now).some(c=>c.agent.id==='orin'));
 assert.ok(Math.abs(restored.state.cashSol+restored.state.rentLockedSol+novaCost-20-restored.state.realizedNetSol)<1e-8);
 assert.notEqual(paperLotKey(nova),paperLotKey(orin));
});
test('a wrong position ID cannot fall back to another bots same-mint lot',()=>{
 const state={settings:{},positions:[{mint:'m',paperPositionId:'nova-id'}]};
 assert.throws(()=>recordSell(state,{mint:'m'},150,{positionId:'orin-id',quantity:1,proceedsSol:1}),/Không có vị thế cho fill/);
});
test('23:59 Vietnam boundaries and migration from 23:00 neither overlap nor lose fills',async t=>{
 const end=Date.parse('2026-10-23T16:59:00Z'),old=Date.parse('2026-10-23T16:00:00Z');
 assert.equal(paperReportEnd(end-1),end-86400000);assert.equal(paperReportEnd(end),end);assert.equal(nextPaperReportEnd(old),end);assert.equal(validPaperReportRef({end:old,part:1}),true);assert.equal(validPaperReportRef({end:end+1,part:1}),false);
 const dir=await mkdtemp('/tmp/paper-report-transition-');t.after(()=>rm(dir,{recursive:true,force:true}));const desk=new PaperDesk(dir,{},{clock:()=>old});await desk.load();desk.state.reportLastEnd=old;
 desk.state.archiveOutbox=[{id:'already-reported',at:old-1,side:'SELL',agentId:'nova',closed:true,pnlSol:1,positionPnlSol:1,initialCostSol:1},{id:'new',at:old+1,side:'SELL',agentId:'orin',closed:true,pnlSol:-.1,positionPnlSol:-.1,initialCostSol:1},{id:'boundary',at:end,side:'BUY',agentId:'rune'}];
 const reports=new PaperReports(dir);await reports.tick(desk,end-1);assert.equal(desk.state.telegramOutbox.length,0);await reports.tick(desk,end);assert.equal(reports.error,null);
 const doc=JSON.parse((await reports.document({end,part:1})).content);assert.equal(doc.transitionReport,true);assert.deepEqual(doc.allFillsIncludingLosses.map(f=>f.id),['new']);assert.equal(doc.summary.realizedPnlSol,-.1);
 const table=desk.state.telegramOutbox.find(m=>m.id.endsWith(':summary'));assert.ok(table.text.length<4096);for(const a of PAPER_AGENTS)assert.ok(table.text.includes(a.name+':'));assert.equal(table.report,undefined);
 const count=desk.state.telegramOutbox.length;await reports.tick(desk,end);assert.equal(desk.state.telegramOutbox.length,count);
 assert.deepEqual((await reports.records(end+86400000)).map(f=>f.id),['boundary']);
});
test('two failed entry benchmarks yield the next turn instead of starving the remaining independent bots',async t=>{
 const dir=await mkdtemp('/tmp/paper-turns-');t.after(()=>rm(dir,{recursive:true,force:true}));let now=at;const calls=[];
 const quote=async input=>{calls.push(input.mint);throw Error('NO_ROUTE');};const desk=new PaperDesk(dir,{quote},{clock:()=>now});await desk.load();
 const feed=()=>({updatedAt:now,solUsd:150,error:null,markets:['a','b'].map(mint=>verifiedMarket({mint,pairAddress:mint,change5mPct:7,change1hPct:5,scalpConfirmed:true,evidence:{probeSol:.5,decimals:6,lpSecuredPct:99,roundTripLossPct:1}},now))});
 await desk.step(feed());assert.equal(desk.state.agentCursor,2);now+=2000;await desk.step(feed());assert.equal(desk.state.agentCursor,4);assert.equal(calls.length,4);assert.equal(desk.state.cashSol,20);
});
test('a delayed BUY cannot bypass its pinned stricter impact cap even below the shared 2% limit',async t=>{
 const dir=await mkdtemp('/tmp/paper-own-impact-');t.after(()=>rm(dir,{recursive:true,force:true}));let now=at,impact=1;
 const desk=new PaperDesk(dir,{quote:async input=>({...input,inAmount:input.amount,outAmount:'9000000000',minOut:'9000000000',checkedAt:now,contextSlot:1,impactPct:impact})},{clock:()=>now});await desk.load();desk.state.agentCursor=2;
 const feed=()=>({updatedAt:now,solUsd:150,error:null,markets:[market({evidence:{probeSol:.5,decimals:6,roundTripLossPct:1,lpSecuredPct:99}},now)]});
 await desk.step(feed());assert.equal(desk.state.pending.agentId,'vela');assert.equal(desk.state.pending.riskPolicy.maxImpactPct,1);
 impact=1.1;now+=2100;await desk.step(feed());assert.equal(desk.state.positions.length,0);assert.equal(desk.state.cashSol,20);assert.equal(desk.state.lastExecutionError.code,'SIZE_DEPTH_COST_LIMIT');
});
