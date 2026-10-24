import {observePaperOutcomes} from '../src/paper-outcomes.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {LabPaperDesk,LAB_AGENTS,LAB_VERSION,labSignal,labRank,labAdmission,observeLabMarkets} from '../src/paper-lab.js';
import {LabExecutionFeed} from '../src/paper-lab-feed.js';
import {PaperDesk} from '../src/paper-desk.js';
import {paperOrderSol,paperCapitalSol} from '../src/paper-sizing.js';
import {createPaperMarket} from '../src/paper-market.js';
import {PaperReports} from '../src/paper-reports.js';
import {paperReportEnd} from '../src/paper-schedule.js';
const start=Date.parse('2026-10-24T12:00:00Z');
async function step(desk,feed){await desk.step(feed);await Promise.allSettled([...(desk.executionJobs?.values()??[])]);}
function market(now,{change=3,index=0,proof=true,size=.5}={}){return {mint:'11111111111111111111111111111112',pairAddress:'pool',symbol:'LAB',dexId:'pumpswap',priceUsd:.01*1.001**index,updatedAt:now,liquidityUsd:10000,change5mPct:change,change1hPct:5,volume5mUsd:1000,volume1hUsd:3000,buys5m:30+index*3,sells5m:10+index,evidence:proof?{mint:'11111111111111111111111111111112',pairAddress:'pool',certificationMode:'bypassed-paper',checkedAt:now,quoteCheckedAt:now,quoteContextSlot:1,decimals:6,roundTripQuoteOk:true,roundTripLossPct:3,probeSol:size}:undefined};}
async function setup(t){const dir=await mkdtemp('/tmp/paper-lab-test-');t.after(()=>rm(dir,{recursive:true,force:true}));let now=start,value=.5,fail=null;const calls=[],quote={quote:async i=>{calls.push(i);if(i.side==='SELL'&&i.mint===fail)throw Error('HTTP 429');const out=i.side==='BUY'?9000000000:Math.floor(Number(i.amount)/9e9*value*1e9);return {...i,inAmount:i.amount,outAmount:String(out),minOut:String(out),checkedAt:now,contextSlot:1,impactPct:5};}};const desk=new LabPaperDesk(dir,quote,{clock:()=>now});await desk.load();return {desk,dir,quote,calls,now:()=>now,advance:n=>now+=n,value:n=>value=n,fail:x=>fail=x};}

test('certificates are not fabricated or BUY gates in paper LAB, while price and executable quotes remain mandatory',()=>{
 const raw=market(start),unsafe={...raw,evidence:{...raw.evidence,mintRevoked:false,freezeRevoked:false,extensionsSafe:false,lpSecuredPct:0,top10Pct:100,devPct:100,criticalWarnings:['unknown risk']}};
 assert.equal(labSignal('orin',raw,start).eligible,true);assert.equal(labSignal('orin',unsafe,start).eligible,true);assert.equal(raw.evidence.mintRevoked,undefined);
 for(const bad of [{...raw,priceUsd:0},{...raw,updatedAt:start-30001},{...raw,evidence:{}},{...raw,evidence:{...raw.evidence,roundTripQuoteOk:false}},{...raw,evidence:{...raw.evidence,quoteCheckedAt:start-10001}},{...raw,evidence:{...raw.evidence,decimals:undefined}}])assert.equal(labSignal('orin',bad,start).eligible,false);
 assert.equal(labRank(market(start,{proof:false}),undefined,start).blockingStage,'execution');assert.equal(labSignal('orin',market(start,{proof:false}),start).rank.preQuoteEligible,true,'no future quote requirement blocks its own fetch');
});
test('ten preferences rank differently without blocking BUY or waiting for confirmation',()=>{
 assert.equal(new Set(LAB_AGENTS.map(a=>a.rule)).size,10);assert.equal(new Set(LAB_AGENTS.map(a=>JSON.stringify(a.exitPolicy))).size,10);const m=market(start,{change:25});assert.equal(labSignal('orin',m,start).eligible,true);assert.equal(labSignal('zara',m,start).eligible,true);assert.equal(labSignal('rune',m,start).eligible,true);assert.equal(labSignal('sage',m,start).eligible,true);assert.equal(labSignal('rune',m,start).rank.preferenceMatched,false);assert.equal(labSignal('zara',m,start).rank.preferenceMatched,true);assert.notEqual(labSignal('rune',m,start).rank.score,labSignal('zara',m,start).rank.score);
 const s={};observeLabMarkets(s,[market(start)],start);const rows=observeLabMarkets(s,[market(start+6000,{index:3})],start+6000);assert.equal(labSignal('nova',rows[0],start+6000).eligible,true);const next=observeLabMarkets(s,[market(start+8000,{index:4})],start+8000);assert.equal(labSignal('nova',next[0],start+8000).eligible,true,'between scans retain a real anchor instead of oscillating out of the delayed BUY gate');
});
test('all ten accept zero-score, missing-feature, illiquid, falling and expensive-route candidates when real execution data is valid',()=>{
 const base=market(start),variants=[
  {...base,change5mPct:-90,change1hPct:-95,change4hPct:-99,volume5mUsd:0,volume1hUsd:0,buys5m:0,sells5m:100,liquidityUsd:1,marketCap:1,ageMs:0},
  {...base,change5mPct:1000,change1hPct:5000,volume5mUsd:1,buys5m:1,sells5m:99,marketCap:1e12},
  {...base,change5mPct:undefined,change1hPct:null,volume5mUsd:undefined,volume1hUsd:null,buys5m:undefined,sells5m:undefined,liquidityUsd:null},
  {...base,evidence:{...base.evidence,roundTripLossPct:80,buyImpactPct:25,sellImpactPct:25}}
 ];
 for(const a of LAB_AGENTS)for(const m of variants){const d=labSignal(a.id,m,start);assert.equal(d.eligible,true,a.name+': '+d.reason);assert.equal(d.rank.preQuoteEligible,true);assert.equal(d.rank.preferenceOnly,true);assert.equal(d.rank.minScore,0);}
 const empty=variants[2];assert.equal(labSignal('nova',empty,start).rank.score,0);assert.equal(labSignal('nova',empty,start).rank.scoreParts.rawPriority,null);
 const noQuote={...empty,evidence:undefined};for(const a of LAB_AGENTS){assert.equal(labSignal(a.id,noQuote,start).eligible,false);assert.equal(labSignal(a.id,noQuote,start).rank.preQuoteEligible,true);}
});
test('production execution facade reads only decimals and real quote, never RugCheck, holders, authorities or wallet balance',async()=>{
 let supply=0,quotes=0;const marketFacade=createPaperMarket(()=>20,{rpc:{getTokenSupply:async()=>{supply++;return {value:{decimals:6}};}},roundTripQuote:async(mint,amount)=>{quotes++;assert.equal(amount,'500000000');return {probeSol:.5,roundTripQuoteOk:true,quoteCheckedAt:start};},inspectMarketFacts:()=>{throw Error('forbidden certificate');},balance:()=>{throw Error('forbidden wallet');}});
 const e=await marketFacade.inspectLabExecution(market(start));assert.equal(supply,1);assert.equal(quotes,1);assert.equal(e.certificationMode,'bypassed-paper');for(const key of ['mintRevoked','lpSecuredPct','devPct','top10Pct','extensionsSafe'])assert.equal(e[key],undefined);
});
test('execution feed is bounded and refreshes held token quotes for other bots without a certificate provider',async t=>{
 let now=start,calls=0,release;t.mock.method(Date,'now',()=>now);const wait=new Promise(r=>release=r),api={currentProbeSol:.5,inspectLabExecution:async m=>{calls++;await wait;return market(now).evidence;}},feed=new LabExecutionFeed(api,{rankMarket:labRank});
 const m=market(now,{proof:false});await feed.enrichCached([m,m],[],now);assert.equal(feed.jobs.size,1);release();await Promise.all([...feed.jobs.values()]);assert.equal(calls,1);assert.equal(feed.applyCached([m])[0].evidence.roundTripQuoteOk,true);
 now+=11000;await feed.enrichCached([market(now,{proof:false})],[m.mint],now);await Promise.all([...feed.jobs.values()]);assert.equal(calls,2);
});
test('all ten can hold separate lots simultaneously with shared 20 SOL, no aggregate certificate/cadence gate, and no account reset',async t=>{
 const x=await setup(t);let max=0;
 for(let tick=0;tick<45;tick++){x.advance(2000);const markets=[3,7,25].map((change,i)=>{const m=market(x.now(),{change,index:tick,size:paperOrderSol(x.desk.state)});m.mint='mint-'+i;m.pairAddress='pool-'+i;m.evidence={...m.evidence,mint:m.mint,pairAddress:m.pairAddress};return m;}),rows=observeLabMarkets(x.desk.state,markets,x.now());x.desk.evaluate(rows,x.now());await step(x.desk,{updatedAt:x.now(),solUsd:150,error:null,markets:rows});max=Math.max(max,x.desk.state.positions.length);if(max===10)break;}
 assert.equal(max,10,JSON.stringify({agents:x.desk.state.positions.map(p=>p.agentId),last:x.desk.state.agentExecutionStatus,error:x.desk.state.lastExecutionError}));assert.equal(new Set(x.desk.state.positions.map(p=>p.agentId)).size,10);assert.equal(paperCapitalSol(x.desk.state),20);assert.ok(x.desk.state.cashSol>=.1);assert.ok(x.desk.state.trades.every(t=>t.agentPolicyVersion===LAB_VERSION&&t.workflow.verify.certificationsRequired===false));
 const cash=x.desk.state.cashSol,restored=new LabPaperDesk(x.dir,x.quote,{clock:x.now});await restored.load();assert.equal(restored.state.cashSol,cash);assert.equal(restored.state.positions.length,10);assert.equal(restored.snapshot().agents.length,10);
 x.desk.state=restored.state;x.value(.39);for(let tick=0;tick<120&&x.desk.state.positions.length;tick++){x.advance(2100);await step(x.desk,{updatedAt:x.now(),solUsd:150,error:null,markets:[]});}
 for(const a of LAB_AGENTS){assert.ok(x.desk.state.agentStats[a.id].buys>0,a.name+' BUY');assert.ok(x.desk.state.agentStats[a.id].sells>0,a.name+' SELL');}assert.equal(x.desk.state.positions.length,0);assert.ok(Math.abs(x.desk.state.cashSol-20-x.desk.state.realizedNetSol)<1e-7);
 // Closed receipts keep historical cooldown timestamps, but LAB v2 has no
 // re-entry gate: the same bot may select the same mint on the next scan.
 assert.ok(Object.values(x.desk.state.agentCooldowns.orin).some(until=>until>x.now()));x.advance(2000);const m=market(x.now(),{size:paperOrderSol(x.desk.state)});m.mint='mint-0';m.pairAddress='pool-0';m.evidence={...m.evidence,mint:m.mint,pairAddress:m.pairAddress};
 const candidates=x.desk.entryCandidates([m],x.now());assert.equal(new Set(candidates.map(c=>c.agent.id)).size,10);
 await step(x.desk,{updatedAt:x.now(),solUsd:150,markets:[m]});assert.equal(x.desk.pendingOrders().filter(o=>o.side==='BUY').length,10);
});
test('one failing exit quote does not cancel or globally veto another bot BUY; stale valuations remain unknown',async t=>{
 const x=await setup(t),allCandidates=x.desk.entryCandidates.bind(x.desk);x.desk.entryCandidates=(markets,now)=>allCandidates(markets,now).filter(c=>c.agent.id==='orin');const old=market(x.now()),rows=[old];await step(x.desk,{markets:rows,updatedAt:x.now(),solUsd:150});x.advance(2100);await step(x.desk,{markets:[market(x.now())],updatedAt:x.now(),solUsd:150});assert.ok(x.desk.state.positions.length>0);x.fail(old.mint);x.desk.entryCandidates=allCandidates;x.advance(2000);const other=market(x.now(),{change:25});other.mint='different';other.pairAddress='different-pool';other.evidence={...other.evidence,mint:other.mint,pairAddress:other.pairAddress};await step(x.desk,{markets:[other],updatedAt:x.now(),solUsd:150});assert.ok(x.desk.pendingOrders().some(o=>o.side==='BUY'&&o.mint==='different'));assert.equal(x.desk.valuation().equitySol,null);assert.equal(x.desk.admission().operationalCapacity,10);
});
test('23:59 report and cohort separate LAB from previous RUNE history',async t=>{
 const x=await setup(t);(x.desk.state.agentStats??={}).rune={buys:1,sells:1,closed:1,realizedPnlSol:-1};assert.equal(x.desk.snapshot().agents.find(a=>a.id==='rune').stats.closed,0);x.desk.state.archiveOutbox.push({id:'old-rune',at:x.now(),side:'SELL',agentId:'rune',agentPolicyVersion:'old-strict',closed:true,pnlSol:-1,positionPnlSol:-1});const reports=new PaperReports(x.dir),end=paperReportEnd(x.now())+86400000;await reports.tick(x.desk,end);assert.equal(reports.error,null);const text=x.desk.state.telegramOutbox.find(x=>x.id.endsWith(':summary')).text;assert.ok(text.includes(LAB_VERSION));assert.ok(text.includes('RUNE: +0.000000'));const doc=JSON.parse((await reports.document({end,part:1})).content);assert.equal(doc.summary.realizedPnlSol,-1);assert.equal(doc.summary.byAgentPolicy['old-strict'].rune.realizedPnlSol,-1);for(const a of LAB_AGENTS)assert.ok(text.includes(a.name+':'));assert.ok(text.length<4096);
});

test('passive research labels use the actual LAB hypothesis and never classify LAB fills with the strict certificate policy',()=>{
 const s={},journal={enqueue:()=>{}};observePaperOutcomes(s,[market(start)],journal,start,{rankPaper:labRank});assert.equal(s.paperOutcomes[0].paper.policyVersion,LAB_VERSION);assert.equal(s.paperOutcomes[0].paper.eligible,true);assert.equal(s.paperOutcomes[0].baseline.eligible,false);
});

function tenMarkets(now,index=2,size=.5){return LAB_AGENTS.map(a=>{const m=market(now,{change:a.id==='zara'?12:3,index,size});m.mint='mint-'+a.id;m.pairAddress='pool-'+a.id;m.evidence={...m.evidence,mint:m.mint,pairAddress:m.pairAddress};return m;});}
function ownCandidates(desk){const original=desk.entryCandidates.bind(desk);desk.entryCandidates=(markets,now)=>original(markets,now).filter(c=>c.m.mint==='mint-'+c.agent.id);}
function observedFeed(x){return {updatedAt:x.now(),solUsd:150,error:null,markets:observeLabMarkets(x.desk.state,tenMarkets(x.now(),2,paperOrderSol(x.desk.state)),x.now())};}
test('all ten reserve on one tick and fill on the next without a two-entry or same-mint turn gate',async t=>{
 const x=await setup(t);observeLabMarkets(x.desk.state,tenMarkets(x.now(),0),x.now());x.advance(6000);const feed=observedFeed(x);
 await step(x.desk,feed);assert.equal(x.desk.pendingOrders().length,10);assert.equal(new Set(x.desk.pendingOrders().map(o=>o.agentId)).size,10);assert.equal(x.desk.snapshot().execution.independentWorkers,true);
 x.advance(2100);await step(x.desk,observedFeed(x));assert.equal(x.desk.state.positions.length,10);assert.equal(x.desk.pendingOrders().length,0);assert.equal(x.desk.state.cashSol>=.1,true);
});
test('one unresolved bot quote does not hold the ledger, block nine other BUYs, or block their SELLs',async t=>{
 const x=await setup(t);ownCandidates(x.desk);let release;const blocked=new Promise(r=>release=r),base=x.quote.quote;
 x.desk.quotes={quote:async input=>{if(input.mint==='mint-nova')await blocked;return base(input);}};
 const drainOthers=()=>Promise.allSettled([...x.desk.executionJobs].filter(([id])=>id!=='nova').map(([,job])=>job));
 observeLabMarkets(x.desk.state,tenMarkets(x.now(),0),x.now());x.advance(6000);await x.desk.step(observedFeed(x));await drainOthers();assert.equal(x.desk.executionJobs.has('nova'),true);assert.equal(x.desk.pendingOrders().length,9);
 x.advance(2100);await x.desk.step(observedFeed(x));await drainOthers();assert.equal(x.desk.state.positions.length,9);assert.equal(x.desk.executionJobs.has('nova'),true);
 x.value(.39);x.advance(500);await x.desk.step(observedFeed(x));await drainOthers();assert.equal(x.desk.pendingOrders().filter(o=>o.side==='SELL').length,9);
 x.advance(2100);await x.desk.settleExits(observedFeed(x));await drainOthers();assert.equal(x.desk.state.positions.length,0);assert.equal(x.desk.state.trades.filter(t=>t.side==='SELL').length,9);assert.equal(x.desk.executionJobs.has('nova'),true);
 release();await Promise.allSettled([...x.desk.executionJobs.values()]);assert.ok(x.desk.state.cashSol>=.1);
});
test('a different bot realized loss does not resize or cancel an already reserved BUY',async t=>{
 const x=await setup(t);ownCandidates(x.desk);const rows=tenMarkets(x.now()).filter(m=>['mint-orin','mint-vela'].includes(m.mint)),feed={updatedAt:x.now(),solUsd:150,markets:rows};await step(x.desk,feed);assert.equal(x.desk.pendingOrders().length,2);
 const order=x.desk.pendingOrders().find(o=>o.agentId==='vela');assert.equal(order.amount,'500000000');
 // Model another sleeve's already-accounted loss while this ticket waits.
 x.desk.state.cashSol-=.1;x.desk.state.realizedNetSol-=.1;
 assert.ok(paperOrderSol(x.desk.state,{ignorePendingId:order.id})<.5);assert.equal(x.desk.buySizeMatches(order),true);
 x.advance(2100);const next={...feed,updatedAt:x.now(),markets:rows.map(m=>({...m,updatedAt:x.now(),evidence:{...m.evidence,probeSol:paperOrderSol(x.desk.state),quoteCheckedAt:x.now()}}))};await step(x.desk,next);
 assert.equal(x.desk.state.positions.length,2);assert.ok(x.desk.state.trades.every(t=>t.side==='BUY'));assert.ok(x.desk.state.cashSol>=.1);
 assert.equal(labAdmission(x.desk.state,{orderSol:100}).code,'INSUFFICIENT_CASH');
});
