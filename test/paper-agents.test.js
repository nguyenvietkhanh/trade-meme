import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {PAPER_AGENTS,agentSignal,agentCandidates,observeAgentSignals,paperAgentSnapshot,recordAgentFill} from '../src/paper-agents.js';
import {PaperDesk} from '../src/paper-desk.js';
import {paperSummary} from '../src/paper-reports.js';
import {rankPaperMarket} from '../src/paper-policy.js';
import {paperOrderSol} from '../src/paper-sizing.js';
import {verifiedMarket} from './fixtures/verified-market.js';
const at=1792750000000;
const market=(overrides={})=>verifiedMarket({change5mPct:20,scalpConfirmed:true,...overrides},at);
test('six different signal hypotheses cannot bypass the shared safety, fresh quote or confirmation gates',()=>{
 assert.equal(PAPER_AGENTS.length,6);assert.equal(new Set(PAPER_AGENTS.map(a=>a.id)).size,6);
 for(const overrides of [{evidence:{mintRevoked:false}},{evidence:{quoteCheckedAt:at-10001}},{evidence:{top10Pct:90}},{scalpConfirmed:false}]){
  const m=market(overrides),base=rankPaperMarket(m,undefined,at);assert.equal(base.eligible,false);for(const a of PAPER_AGENTS)assert.equal(agentSignal(a.id,m,base).eligible,false);
 }
 const m=market(),base=rankPaperMarket(m,undefined,at);assert.equal(base.eligible,true);assert.equal(agentSignal('nova',m,base).eligible,true);assert.equal(agentSignal('rune',m,base).eligible,true);assert.equal(agentSignal('zara',m,base).eligible,false);assert.equal(agentSignal('kade',m,base).eligible,false,'3% quote + modeled costs exceeds 4.5%');
 assert.equal(agentSignal('zara',market({change5mPct:40}),rankPaperMarket(market({change5mPct:40}),undefined,at)).eligible,true);
 assert.equal(agentSignal('unknown',m,base).eligible,false);
});
test('round-robin independently ranks hypotheses, excludes held/cooldown mints and never creates per-agent capital',()=>{
 const s={settings:undefined,positions:[],cooldowns:{}},markets=[market({mint:'one'}),market({mint:'two',change5mPct:40})];
 const first=agentCandidates(s,markets,at);assert.equal(first[0].agent.id,'nova');s.agentCursor=1;assert.equal(agentCandidates(s,markets,at)[0].agent.id,'orin');s.agentCursor=5;assert.equal(agentCandidates(s,markets,at)[0].agent.id,'zara');
 s.positions=[{mint:'one'}];s.cooldowns.two=at+1;assert.deepEqual(agentCandidates(s,markets,at),[]);assert.equal(s.cashSol,undefined);
});
test('signals have honest timestamps; open/closed/partial metrics are attributed without duplicating portfolio PnL',()=>{
 const s={cashSol:20,positions:[],cooldowns:{},running:true,pending:null};observeAgentSignals(s,[market()],at);
 const fill=(extra)=>({at,agentId:'nova',mint:'one',symbol:'ONE',modeledFeeSol:.000025,...extra});
 recordAgentFill(s,fill({side:'BUY'}));recordAgentFill(s,fill({side:'SELL',closed:false,pnlSol:.02,positionPnlSol:null}));recordAgentFill(s,fill({side:'SELL',closed:true,pnlSol:-.03,positionPnlSol:-.01}));
 const snapshot=paperAgentSnapshot(s,at),nova=snapshot.agents.find(a=>a.id==='nova');assert.equal(snapshot.sharedCapital,true);assert.equal(snapshot.initialVirtualSol,20);assert.equal(nova.stats.closed,1);assert.equal(nova.stats.losses,1);assert.ok(Math.abs(nova.stats.realizedPnlSol+.01)<1e-12);assert.equal(nova.stats.expectancySol,-.01);assert.equal(nova.stats.insufficientSample,true);
 assert.equal(paperAgentSnapshot(s,at+30001).agents[0].signal,null);assert.equal(paperAgentSnapshot(s,at-1).agents[0].signal,null);
 const summary=paperSummary([fill({side:'SELL',closed:false,pnlSol:.02}),fill({side:'SELL',closed:true,pnlSol:-.03,positionPnlSol:-.01}),{...fill({side:'SELL',closed:true,pnlSol:.04,positionPnlSol:.04}),agentId:undefined}]);
 assert.equal(summary.byAgent.nova.closed,1);assert.equal(summary.byAgent.legacy.closed,1);assert.ok(Math.abs(Object.values(summary.byAgent).reduce((sum,g)=>sum+g.realizedPnlSol,0)-summary.realizedPnlSol)<1e-12);
});
test('BUY and SELL retain their agent across restart, archive receipts and stats; pending hypothesis rechecked before fill',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'paper-team-'));t.after(()=>rm(dir,{recursive:true,force:true}));let now=at,factor=1;
 const quotes={quote:async input=>{const out=input.side==='BUY'?9000000000:Math.floor(Number(input.amount)*.5/9*factor);return {...input,inAmount:input.amount,outAmount:String(out),minOut:String(Math.floor(out*.99)),checkedAt:now,impactPct:1,contextSlot:100};}};
 const desk=new PaperDesk(dir,quotes,{clock:()=>now});await desk.load();
 const feed=()=>({updatedAt:now,solUsd:150,error:null,markets:[verifiedMarket({change5mPct:20,scalpConfirmed:true,evidence:{decimals:6,probeSol:paperOrderSol(desk.state)}},now)]});
 await desk.step(feed());assert.equal(desk.state.pending.agentId,'nova');now+=2100;await desk.step(feed());assert.equal(desk.state.positions[0].agentId,'nova');assert.equal(desk.state.archiveOutbox[0].agentId,'nova');
 const cash=desk.state.cashSol,restored=new PaperDesk(dir,quotes,{clock:()=>now});await restored.load();assert.equal(restored.state.cashSol,cash);assert.equal(restored.state.positions[0].agentId,'nova');assert.equal(restored.state.agentStats.nova.buys,1);
 factor=.8;now+=2100;await restored.step(feed());assert.equal(restored.state.pending.side,'SELL');assert.equal(restored.state.pending.agentId,'nova');now+=2100;await restored.step(feed());assert.equal(restored.state.positions.length,0);assert.equal(restored.state.trades[0].agentId,'nova');assert.equal(restored.state.agentStats.nova.closed,1);assert.equal(restored.state.archiveOutbox.at(-1).agentId,'nova');assert.equal(restored.state.agentStats.nova.realizedPnlSol,restored.state.trades[0].pnlSol);
 // On a clean book choose RUNE then leave its 5–25% band before the delayed fill.
 restored.state.cooldowns={};restored.state.agentCursor=4;now+=2100;const f=feed();f.markets[0].evidence.probeSol=paperOrderSol(restored.state);await restored.step(f);assert.equal(restored.state.pending.agentId,'rune');const before=restored.state.cashSol;now+=2100;const changed=feed();changed.markets[0].change5mPct=40;await restored.step(changed);assert.equal(restored.state.cashSol,before);assert.equal(restored.state.positions.length,0);assert.equal(restored.state.lastExecutionError.code,'BUY_GATE_CHANGED');
});
