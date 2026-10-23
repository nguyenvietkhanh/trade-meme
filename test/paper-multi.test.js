import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PaperDesk,PAPER_MODEL,validPaperState} from '../src/paper-desk.js';
import {paperOrderSol,paperCapitalSol} from '../src/paper-sizing.js';
import {SCALP_V2_VERSION,SCALP_V3_VERSION,SCALP_STRATEGY_VERSION} from '../src/paper-scalp.js';
import {paperPortfolioAdmission} from '../src/paper-portfolio.js';
import {verifiedMarket} from './fixtures/verified-market.js';

test('allocation is 2.5% of accounting capital, excludes unrealized gains, and respects whole-lamport reserve/cost limits',()=>{
 for(const [cash,size]of [[20,.5],[1,.025],[2,.05],[100,2.5],[.3,.0075],[.1,0]])assert.equal(paperOrderSol(cash),size);
 const s={cashSol:9.99793572,rentLockedSol:.00203928,positions:[{costSol:10.000025}],marks:{one:{netSol:1000}}};
 assert.equal(paperCapitalSol(s),20);assert.equal(paperOrderSol(s),.5);
 s.cashSol=.2;assert.equal(paperOrderSol(s),.095);assert.equal(s.cashSol-paperOrderSol(s),.10500000000000001);
 for(const cash of [NaN,Infinity,-1])assert.equal(paperOrderSol(cash),0);
 assert.equal(paperOrderSol({cashSol:1,positions:[{costSol:NaN}]}),0);
});

async function setup(t){
 const dir=await mkdtemp(path.join(tmpdir(),'paper-multi-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let at=Date.now(),factor=1,failMint=null;const unit=new Map(),calls=[];
 const quotes={quote:async input=>{calls.push({...input,at});if(input.side==='SELL'&&input.mint===failMint)throw Error('Jupiter HTTP 429');if(input.side==='BUY')unit.set(input.mint,Number(input.amount)/9e9);
  const out=input.side==='BUY'?9000000000:Math.floor(Number(input.amount)*unit.get(input.mint)*factor);
  return {...input,inAmount:input.amount,outAmount:String(out),minOut:String(Math.floor(out*(1-input.slippageBps/10000))),checkedAt:at,contextSlot:100,impactPct:1};
 }};
 const desk=new PaperDesk(dir,quotes,{clock:()=>at});await desk.load();let index=0;
 const market=mint=>verifiedMarket({mint,pairAddress:'pool-'+mint,change5mPct:27,priceUsd:.5*150/9000*factor,scalpConfirmed:true,evidence:{decimals:6,probeSol:paperOrderSol(desk.state)}},at);
 const feed=(extra=[])=>({updatedAt:at,solUsd:150,error:null,markets:[...desk.state.positions.map(p=>market(p.mint)),...extra.map(market)]});
 async function enter(){const mint='multi-'+index++;await desk.step(feed([mint]));assert.equal(desk.state.pending?.side,'BUY',JSON.stringify({gate:desk.state.lastPortfolioAdmission,error:desk.state.lastExecutionError,events:desk.state.events.slice(0,2)}));const amount=Number(desk.state.pending.amount)/1e9;at+=2100;await desk.step(feed([mint]));assert.ok(desk.state.positions.some(p=>p.mint===mint));at+=100;return amount;}
 // Explicit pre-v5 fixture: legacy holdings may exceed the NEW admission cap.
 // They still need real quote-driven exits; this is not a bypass in production.
 async function legacyHoldings(n){await enter();const original=structuredClone(desk.state.positions[0]),receipt=structuredClone(desk.state.trades[0]),round=x=>Math.round(x*1e9)/1e9,s=desk.state;
  for(let i=1;i<n;i++){const mint='legacy-'+i,size=paperOrderSol(s),cost=round(size+PAPER_MODEL.feeSol);assert.ok(size>0);const p={...structuredClone(original),mint,pairAddress:'pool-'+mint,paperPositionId:mint,costSol:cost,initialCostSol:cost,costUsd:cost*150,initialCostUsd:cost*150,entryPriceUsd:size*150/original.quantity,strategyVersion:SCALP_V3_VERSION,exitPolicy:{...original.exitPolicy,version:SCALP_V3_VERSION},sizing:{...original.sizing,orderSol:size}};delete p.modeledBuyFeeSol;unit.set(mint,size*1e9/9e9);s.positions.push(p);s.cashSol=round(s.cashSol-cost-PAPER_MODEL.rentSol);s.rentLockedSol=round(s.rentLockedSol+PAPER_MODEL.rentSol);s.trades.unshift({...structuredClone(receipt),id:mint,positionId:mint,mint,sol:cost,strategyVersion:SCALP_V3_VERSION});}
  s.marks={};s.exitSurveillance=undefined;await desk.save();
 }
 return {dir,desk,quotes,calls,feed,enter,legacyHoldings,now:()=>at,advance:n=>at+=n,crash:f=>factor=f,fail:mint=>failMint=mint};
}

test('new entries respect measured surveillance capacity while preserving the 2.5% allocation and reserve',async t=>{
 const x=await setup(t),sizes=[];
 for(let i=0;i<3;i++)sizes.push(await x.enter());
 await x.desk.step(x.feed(['one-too-many']));assert.equal(x.desk.state.pending,null);assert.equal(x.desk.state.lastPortfolioAdmission.code,'EXIT_CAPACITY');
 assert.equal(x.desk.state.positions.length,3);assert.equal(x.desk.state.settings.maxPositions,null);
 assert.ok(sizes.every(n=>n===.5));
 assert.ok(x.desk.state.cashSol>=.1);assert.equal(paperOrderSol(x.desk.state),.5);
 assert.ok(Math.abs(paperCapitalSol(x.desk.state)-20)<1e-9);
 assert.ok(x.desk.bucket().equityMissingSamples>0,'daily analysis must disclose incomplete portfolio valuation');
 assert.ok(x.desk.state.trades.every(f=>f.sizing.fraction===.025&&f.strategyVersion===SCALP_STRATEGY_VERSION));
 assert.equal(new Set(x.desk.state.trades.map(f=>f.positionId)).size,3);
 assert.equal(new Set(x.desk.state.positions.map(p=>p.mint)).size,3);
 assert.equal(new Set(x.desk.state.positions.map(p=>p.agentId)).size,3,'three eligible bots own different positions through one shared book');assert.equal(x.calls.filter(q=>q.side==='BUY').length,6,'three decisions + three delayed BUY quotes, not six independent provider loops');
 assert.equal(paperPortfolioAdmission(x.desk.state,{now:x.now()}).operationalCapacity,3);
});
test('40 pre-existing holdings remain intact above the new cap; no capital reset or forced liquidation',async t=>{
 const x=await setup(t);await x.legacyHoldings(40);const cash=x.desk.state.cashSol;
 const restored=new PaperDesk(x.dir,x.quotes,{clock:x.now});await restored.load();assert.equal(restored.state.positions.length,40);assert.equal(restored.state.cashSol,cash);assert.equal(restored.state.pending,null);assert.equal(paperPortfolioAdmission(restored.state,{now:x.now()}).allowed,false);assert.equal(restored.state.settings.maxDrawdownPct,null);
});

test('simultaneous crash exits and retry failures do not monopolize another holding; queued orders survive restart',async t=>{
 const x=await setup(t);await x.legacyHoldings(12);x.crash(.1);
 const first=x.desk.state.positions[0].mint;x.fail(first);
 await x.desk.step(x.feed());x.advance(100);await x.desk.step(x.feed());
 assert.equal(x.desk.pendingOrders().filter(o=>o.side==='SELL').length,2,JSON.stringify({error:x.desk.state.lastExecutionError,events:x.desk.state.events.slice(0,3)}));
 const before=x.desk.state.cashSol,ids=x.desk.pendingOrders().map(o=>o.id).sort();await x.desk.save();
 const restored=new PaperDesk(x.dir,x.quotes,{clock:x.now});await restored.load();assert.equal(restored.state.cashSol,before);assert.deepEqual(restored.pendingOrders().map(o=>o.id).sort(),ids);
 x.desk.state=restored.state;let maxPending=2;
 for(let i=0;i<180&&x.desk.state.positions.some(p=>p.mint!==first);i++){x.advance(500);await x.desk.step(x.feed());maxPending=Math.max(maxPending,x.desk.pendingOrders().length);assert.equal(new Set(x.desk.pendingOrders().map(o=>o.mint)).size,x.desk.pendingOrders().length);}
 assert.ok(maxPending>1);assert.deepEqual(x.desk.state.positions.map(p=>p.mint),[first]);
 assert.equal(x.desk.state.trades.filter(t=>t.side==='SELL').length,11);
 assert.ok(x.desk.state.trades.filter(t=>t.side==='SELL').every(t=>t.execution.quoteObservedAt>=t.execution.readyAt&&t.reason==='stop-loss'));
 assert.ok(x.desk.state.executionErrors>0);assert.ok(x.desk.state.rentLockedSol>=PAPER_MODEL.rentSol-1e-9);
 x.fail(null);for(let i=0;i<20&&x.desk.state.positions.length;i++){x.advance(2100);await x.desk.step(x.feed());}
 assert.equal(x.desk.state.positions.length,0);assert.equal(x.desk.state.rentLockedSol,0);
 const buys=x.desk.state.trades.filter(t=>t.side==='BUY');for(const sale of x.desk.state.trades.filter(t=>t.side==='SELL'))assert.equal(sale.positionId,buys.find(b=>b.mint===sale.mint).positionId);
 assert.ok(Math.abs(x.desk.state.cashSol-20-x.desk.state.realizedNetSol)<1e-8);
});

test('market crash hint prioritizes exact quote checks, but cannot manufacture a stop fill or relax slippage',async t=>{
 const x=await setup(t);await x.legacyHoldings(4);
 // Make the last holding's snapshot show a collapse; only the exact quote may trigger/fill.
 const f=x.feed(),last=x.desk.state.positions.at(-1);f.markets.find(m=>m.mint===last.mint).priceUsd*=.1;
 x.calls.length=0;await x.desk.step(f);assert.equal(x.calls[0].mint,last.mint);assert.equal(x.desk.state.pending,null);
 x.crash(.5);await x.desk.step(x.feed());assert.equal(x.desk.state.pending.side,'SELL');
 const mint=x.desk.state.pending.mint;x.crash(.05);x.advance(2100);await x.desk.step(x.feed());
 assert.ok(x.desk.state.positions.some(p=>p.mint===mint));assert.equal(x.desk.state.trades.filter(t=>t.side==='SELL').length,0);
 assert.equal(x.desk.state.lastExecutionError.code,'SLIPPAGE_LIMIT');assert.equal(x.calls.at(-1).slippageBps,1000);
});

test('v2 holdings retain their exits, an unfilled old-size BUY is canceled, and corrupt/duplicate exit queues cannot be saved',async t=>{
 const x=await setup(t);await x.enter();x.desk.state.positions[0].exitPolicy={...x.desk.state.positions[0].exitPolicy,version:SCALP_V2_VERSION};
 x.desk.state.pending={id:'old-size',side:'BUY',mint:'old-size',strategyVersion:SCALP_V2_VERSION};const cash=x.desk.state.cashSol;await x.desk.save();
 const y=new PaperDesk(x.dir,x.quotes,{clock:x.now});await y.load();assert.equal(y.state.pending,null);assert.equal(y.state.cashSol,cash);assert.equal(y.state.positions[0].exitPolicy.version,SCALP_V2_VERSION);
 y.state.pendingExits=[{side:'BUY'}];assert.equal(validPaperState(y.state),false);await assert.rejects(y.save(),/invariant/);
 const sell={id:'duplicate',side:'SELL',mint:'same',amount:'10',readyAt:x.now()+2000,decisionAt:x.now()};y.state.pending=sell;y.state.pendingExits=[{...sell,id:'other-id'}];assert.equal(validPaperState(y.state),false);
});
