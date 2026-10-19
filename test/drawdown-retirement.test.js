import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {createOwnerLedger,nextOwnerOrder,applyOwnerReceipt} from '../src/owner-ledger.js';
import {riskCheck,recordBuy} from '../src/engine.js';
import {OwnerAgent} from '../src/owner-agent.js';
import {verifiedMarket} from './fixtures/verified-market.js';

test('restoring a drawdown liquidation preserves signed exit, accounting and independent pauses',async()=>{
 const dir=await mkdtemp('/tmp/meme-dd-retired-');try{
  const s=createOwnerLedger('owner',1),m=verifiedMarket({priceUsd:1});
  recordBuy(s,m,100,{quantity:20,costSol:.2,priceUsd:1,rawQuantity:'20000000',decimals:6,signature:'original-buy'},Date.now(),'fixture','live');
  Object.assign(s,{haltKind:'drawdown',halted:'old halt',liquidating:true,running:true,buyPaused:true,buyCircuitOpen:true,maxDrawdownObservedPct:40,peakEquity:2});
  s.pending={transaction:'already-signed-fixture',intent:{owner:'owner',side:'SELL',mint:m.mint,reason:'drawdown-close',amount:'20000000',solUsd:100,priceUsd:.7}};
  const before=structuredClone(s),a=new OwnerAgent(dir,{}, {},'owner');await a.restore(s);const b=new OwnerAgent(dir,{}, {},'owner');await b.load();
  assert.equal(b.state.halted,null);assert.equal(b.state.liquidating,false);assert.equal(b.state.settings.maxDrawdownPct,null);assert.equal(b.state.running,false);
  for(const key of ['pending','positions','trades','cashSol','peakEquity','maxDrawdownObservedPct','buyPaused','buyCircuitOpen'])assert.deepEqual(b.state[key],before[key],key);
  const feed={markets:[m],solUsd:100,updatedAt:Date.now()};assert.equal(nextOwnerOrder(b.state,feed,.8),null);
  const receipt={status:'confirmed',signature:'old-dd-confirmed',tokenDelta:'-20000000',solDelta:.14,decimals:6,feeSol:.00002},pending=b.state.pending;
  assert.equal(applyOwnerReceipt(b.state,pending,receipt),true);assert.equal(applyOwnerReceipt(b.state,pending,receipt),false);assert.equal(b.state.positions.length,0);assert.equal(b.state.trades.length,2);assert.equal(b.state.trades[0].reason,'drawdown-close');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('deep drawdown does not force a sale or pause; manual halt and independent BUY pause still work',()=>{
 const s=createOwnerLedger('owner',1),m=verifiedMarket(),feed={markets:[m],solUsd:100,updatedAt:Date.now()};
 s.cashSol=.2;s.running=true;riskCheck(s,[],100);assert.equal(s.halted,null);assert.equal(s.running,true);assert.equal(s.maxDrawdownObservedPct,80);assert.equal(nextOwnerOrder(s,feed,.2).orderSol,.095);
 s.buyPaused=true;assert.equal(nextOwnerOrder(s,feed,.2),null);s.buyPaused=false;s.haltKind='manual';s.halted='manual';riskCheck(s,[],100);assert.equal(s.halted,'manual');assert.equal(nextOwnerOrder(s,feed,.2),null);
});
