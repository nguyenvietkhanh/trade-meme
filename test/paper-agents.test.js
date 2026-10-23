import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {PAPER_AGENT_VERSION,PAPER_AGENTS,observeAgentMarkets,rankAgentUniverse,agentSignal,agentCandidates,observeAgentSignals,paperAgentSnapshot,recordAgentFill} from '../src/paper-agents.js';
import {PaperDesk} from '../src/paper-desk.js';
import {paperSummary} from '../src/paper-reports.js';
import {rankPaperMarket} from '../src/paper-policy.js';
import {paperOrderSol} from '../src/paper-sizing.js';
import {verifiedMarket} from './fixtures/verified-market.js';
const at=1792750000000;
const market=(overrides={})=>verifiedMarket({change5mPct:20,scalpConfirmed:true,...overrides},at);
test('ten independent signal hypotheses cannot bypass the shared safety, fresh quote or confirmation gates',()=>{
 assert.equal(PAPER_AGENTS.length,10);assert.equal(new Set(PAPER_AGENTS.map(a=>a.id)).size,10);
 for(const overrides of [{evidence:{mintRevoked:false}},{evidence:{quoteCheckedAt:at-10001}},{evidence:{top10Pct:90}},{scalpConfirmed:false}]){
  const m=market(overrides),base=rankPaperMarket(m,undefined,at);assert.equal(base.eligible,false);for(const a of PAPER_AGENTS)assert.equal(agentSignal(a.id,m,base,at).eligible,false);
 }
 const m=market(),base=rankPaperMarket(m,undefined,at);assert.equal(base.eligible,true);assert.equal(agentSignal('nova',m,base,at).eligible,true);assert.equal(agentSignal('rune',m,base,at).eligible,false);assert.equal(agentSignal('zara',m,base,at).eligible,true);assert.equal(agentSignal('kade',m,base,at).eligible,false,'3% quote + modeled costs exceeds 4.5%');
 assert.equal(agentSignal('zara',market({change5mPct:40}),rankPaperMarket(market({change5mPct:40}),undefined,at),at).eligible,true);
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
 restored.state.cooldowns={};restored.state.agentCursor=4;now+=2100;const f=feed();f.markets[0].evidence.probeSol=paperOrderSol(restored.state);f.markets[0].change5mPct=10;f.markets[0].scalpSetup.persistence=f.markets[0].scalpSetup.persistence.slice(-2);await restored.step(f);assert.equal(restored.state.pending.agentId,'rune');const before=restored.state.cashSol;now+=2100;const changed=feed();changed.markets[0].change5mPct=40;await restored.step(changed);assert.equal(restored.state.cashSol,before);assert.equal(restored.state.positions.length,0);assert.equal(restored.state.lastExecutionError.code,'BUY_GATE_CHANGED');
});

test('RUNE confirms and reaches the union quote gate while NOVA is still unconfirmed; histories and other decisions are isolated',()=>{
 const s={cashSol:20,positions:[],cooldowns:{},running:true};let current;
 for(const [i,elapsed]of [0,5000].entries()){
  current=observeAgentMarkets(s,[verifiedMarket({change5mPct:2,change1hPct:10,priceUsd:.01*(1+i*.005),buys5m:40+i*3,sells5m:20+i,scalpConfirmed:undefined,evidence:{roundTripLossPct:1}},at+elapsed)],at+elapsed)[0];
 }
 assert.equal(current.agentViews.nova.scalpConfirmed,false);assert.equal(current.agentViews.rune.scalpConfirmed,true);
 assert.equal(agentSignal('nova',current,null,at+5000).eligible,false);assert.equal(agentSignal('rune',current,null,at+5000).eligible,true);
 const missing={...current,evidence:{...current.evidence,roundTripQuoteOk:false}},union=rankAgentUniverse(missing,undefined,at+5000);
 assert.equal(union.preQuoteEligible,true);assert.equal(union.red_flags.includes('UNCONFIRMED_SIGNAL'),false,'an unconfirmed NOVA must not block a confirmed independent RUNE quote');
 observeAgentSignals(s,[current],at+5000);assert.equal(s.agentSignals.agents.nova.eligible,0);assert.equal(s.agentSignals.agents.rune.eligible,1);assert.ok(s.agentIntents.rune);assert.equal(s.agentIntents.nova,undefined);
 const runeHistory=JSON.stringify(s.agentObservationStates.rune);s.agentObservationStates.nova.paperObservations={};assert.equal(JSON.stringify(s.agentObservationStates.rune),runeHistory);
});
test('all ten publish decisions in the same cycle even while one bot is pending, and cohort results never relabel the previous policy',()=>{
 const s={cashSol:20,positions:[],cooldowns:{},running:true,pending:{side:'BUY',id:'nova-pending',mint:'other',agentId:'nova',amount:'500000000'}};
 observeAgentSignals(s,[market()],at);assert.equal(Object.keys(s.agentSignals.agents).length,10);assert.ok(Object.values(s.agentSignals.agents).every(g=>g.evaluated===1));
 recordAgentFill(s,{agentId:'nova',agentPolicyVersion:'paper-signal-team-v1',side:'SELL',at,pnlSol:1,closed:true,positionPnlSol:1});
 assert.equal(paperAgentSnapshot(s,at).agents[0].stats.closed,0);assert.equal(s.agentStats.nova.closed,1);
 recordAgentFill(s,{agentId:'nova',agentPolicyVersion:PAPER_AGENT_VERSION,side:'SELL',at,pnlSol:-.1,closed:true,positionPnlSol:-.1});
 assert.equal(paperAgentSnapshot(s,at).agents[0].stats.closed,1);assert.equal(paperAgentSnapshot(s,at).agents[0].stats.realizedPnlSol,-.1);assert.equal(s.agentStats.nova.closed,2);
 for(const a of PAPER_AGENTS){assert.ok(a.exitPolicy.stopLossPct<=12);assert.ok(a.exitPolicy.maxQuoteAgeMs<=10000);assert.ok(a.exitPolicy.maxHoldMs<=600000);}
 assert.equal(new Set(PAPER_AGENTS.map(a=>JSON.stringify(a.exitPolicy))).size,10);
});
test('multiple independent BUY intents reserve common cash/risk, retry without holding another bot hostage, and survive restart',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ten-queues-'));t.after(()=>rm(dir,{recursive:true,force:true}));let now=at,fail=null;
 const quotes={quote:async input=>{if(input.side==='BUY'&&input.mint===fail)throw Error('Jupiter HTTP 429');const out=input.side==='BUY'?9000000000:Math.floor(Number(input.amount)*.5/9);return {...input,inAmount:input.amount,outAmount:String(out),minOut:String(Math.floor(out*.99)),checkedAt:now,impactPct:1,contextSlot:100};}};
 const desk=new PaperDesk(dir,quotes,{clock:()=>now});await desk.load();
 const feed=()=>({updatedAt:now,error:null,solUsd:150,markets:['alpha','beta','gamma','delta'].map(mint=>verifiedMarket({mint,pairAddress:'pool-'+mint,change5mPct:20,scalpConfirmed:true,evidence:{decimals:6,probeSol:.5}},now))});
 await desk.step(feed());let pending=desk.pendingOrders().filter(o=>o.side==='BUY');assert.equal(pending.length,2);assert.equal(new Set(pending.map(o=>o.agentId)).size,2);assert.equal(new Set(pending.map(o=>o.mint)).size,2);assert.equal(desk.state.cashSol,20,'reservations do not pretend fills');
 const ids=pending.map(o=>o.id).sort();await desk.save();const restored=new PaperDesk(dir,quotes,{clock:()=>now});await restored.load();assert.deepEqual(restored.pendingOrders().map(o=>o.id).sort(),ids);desk.state=restored.state;
 fail=desk.state.pending.mint;const healthy=pending.find(o=>o.mint!==fail);now+=2100;await desk.step(feed());assert.equal(desk.state.positions.length,0);assert.equal(desk.state.pending.agentId,healthy.agentId,'failed intent rotates behind healthy bot');
 now+=100;await desk.step(feed());assert.equal(desk.state.positions.length,1);assert.equal(desk.state.positions[0].agentId,healthy.agentId);assert.ok(desk.pendingOrders().some(o=>o.mint===fail));assert.ok(desk.state.cashSol>=.1);assert.equal(desk.state.lastExecutionError.code,'HTTP_429');
});

test('each independent strategy has a reachable entry under its own observations, with common unsafe authority still blocking every one',()=>{
 for(const a of PAPER_AGENTS){
  const gain={nova:20,orin:10,vela:3,kade:3,rune:3,zara:40,atlas:3,echo:1,nyx:3,sage:3}[a.id],own={};let latest;
  for(let i=0;i<3;i++)latest=observeAgentMarkets(own,[verifiedMarket({change5mPct:gain,change1hPct:10,priceUsd:.01*(1+i*.005),buys5m:40+i*3,sells5m:20+i,evidence:{quoteReserveSol:100,roundTripLossPct:1}},at+i*5000)],at+i*5000)[0];
  const d=agentSignal(a.id,latest,null,at+10000);assert.equal(d.eligible,true,a.id+': '+d.reason);
  assert.equal(agentSignal(a.id,{...latest,evidence:{...latest.evidence,mintRevoked:false}},null,at+10000).eligible,false,a.id);
 }
});
test('a failed benchmark cannot consume the second agent turn, and reservations cannot spend another pending bot\'s gas/cash',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ten-fault-'));t.after(()=>rm(dir,{recursive:true,force:true}));let now=at;const calls=[];
 const desk=new PaperDesk(dir,{quote:async input=>{calls.push(input);if(input.mint==='alpha')throw Error('NO_ROUTE');return {...input,inAmount:input.amount,outAmount:'9000000000',minOut:'8910000000',checkedAt:now,impactPct:1,contextSlot:100};}},{clock:()=>now});await desk.load();
 const feed={updatedAt:now,solUsd:150,error:null,markets:['alpha','beta'].map(mint=>verifiedMarket({mint,pairAddress:'pool-'+mint,change5mPct:20,scalpConfirmed:true,evidence:{probeSol:.5,decimals:6}},now))};await desk.step(feed);
 assert.deepEqual(calls.map(c=>c.mint),['alpha','beta']);assert.equal(desk.state.pending.agentId,'orin');assert.equal(desk.state.pending.mint,'beta');assert.equal(desk.state.cashSol,20);
 const scarce={cashSol:.15,positions:[{costSol:20}],concurrentAgentEntries:true,pending:{id:'reserved',side:'BUY',amount:'45000000'}};
 assert.equal(paperOrderSol(scarce),0);assert.equal(paperOrderSol(scarce,{ignorePendingId:'reserved'}),.045);
});

test('discovery does not require future confirmation or on-chain facts to shortlist ECHO/SAGE-only setups',()=>{
 const echo=market({change5mPct:-3,change1hPct:10,scalpSetup:null,scalpConfirmed:false,evidence:{quoteReserveSol:undefined}});
 const sage=market({change5mPct:.2,change1hPct:-3,scalpSetup:null,scalpConfirmed:false,evidence:{quoteReserveSol:undefined,roundTripQuoteOk:false}});
 for(const m of [echo,sage]){const r=rankAgentUniverse(m,undefined,at);assert.equal(r.roughEligible,true);assert.equal(r.eligible,false);assert.equal(r.preQuoteEligible,false);}
});
