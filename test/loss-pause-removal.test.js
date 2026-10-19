import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {recordBuy,recordSell,riskCheck} from '../src/engine.js';
import {createOwnerLedger,nextOwnerOrder} from '../src/owner-ledger.js';
import {diagnoseOwnerEntry} from '../src/diagnostics.js';
import {OwnerAgent} from '../src/owner-agent.js';
import {TRADE_RULES} from '../src/desk-rules.js';
import {verifiedMarket} from './fixtures/verified-market.js';

test('three losing positions keep their actual losses but permit the next eligible BUY immediately',()=>{
 const now=Date.now(),s=createOwnerLedger('owner',1.19);Object.assign(s,{running:true,lossPauseUntil:now+7200000});Object.assign(s.settings,{lossStreakLimit:3,lossPauseMs:7200000});
 for(let i=0;i<3;i++){
  const m=verifiedMarket({mint:'closed-'+i,priceUsd:1},now);
  recordBuy(s,m,100,{quantity:20,costSol:.2001,priceUsd:1,rawQuantity:'20000000',decimals:6},now,'fixture','live');
  recordSell(s,m,100,{quantity:20,proceedsSol:.19,priceUsd:.95,rawBalance:'0',closed:true},now,'owner-exit','live');
 }
 assert.equal(s.lossStreak,3);assert.equal(s.lossPauseUntil,0);assert.equal(s.positions.length,0);assert.equal(s.trades.length,6);assert.ok(Math.abs(s.realizedNetSol+.0303)<1e-12);
 const m=verifiedMarket({mint:'next-token'},now),feed={markets:[m],solUsd:100,updatedAt:now};
 assert.equal(nextOwnerOrder(s,feed,s.cashSol).side,'BUY');assert.equal(diagnoseOwnerEntry(s,feed,s.cashSol).phase,'ready');assert.equal(TRADE_RULES.lossPauseMs,0);assert.equal(TRADE_RULES.lossStreakLimit,null);
});
test('an obsolete future timer cannot block another mint, while token re-entry, manual pause and reserve remain enforced',()=>{
 const now=Date.now(),s=createOwnerLedger('owner',1.19),m=verifiedMarket({},now),feed={markets:[m],solUsd:150,updatedAt:now};s.running=true;s.lossPauseUntil=now+7200000;
 assert.equal(diagnoseOwnerEntry(s,feed,1.19,now).phase,'ready');assert.equal(nextOwnerOrder(s,feed,1.19).side,'BUY');assert.equal(s.lossPauseUntil,0);
 s.cooldowns[m.mint]=now+86400000;assert.equal(nextOwnerOrder(s,feed,1.19),null);delete s.cooldowns[m.mint];
 s.buyPaused=true;assert.equal(nextOwnerOrder(s,feed,1.19),null);s.buyPaused=false;
 assert.equal(nextOwnerOrder(s,feed,.06),null);assert.equal(nextOwnerOrder(s,{...feed,updatedAt:now-31000},1.19),null);
 s.cashSol=1;riskCheck(s,[],150,now);assert.equal(s.halted,null);assert.equal(nextOwnerOrder(s,feed,1).side,'BUY');
});
test('restore clears only the old loss-pause timer/status and preserves accounting, pending orders and other stops',async()=>{
 const dir=await mkdtemp('/tmp/meme-no-loss-pause-');try{
  const owner='owner',s=createOwnerLedger(owner,1.19);Object.assign(s,{lossPauseUntil:Date.now()+7200000,lossStreak:6,entryStatus:{phase:'loss-pause',message:'old loss pause'},buyPaused:true,buyCircuitOpen:true,halted:'review required',haltKind:'drawdown',realizedNetSol:-.1,cashSol:1.09});
  s.recordedSignatures=['previous-fill'];s.cooldowns.token=Date.now()+86400000;s.pending={transaction:'fixture-signed-bytes',intent:{owner,side:'BUY',amount:'200000000'}};
  const before=structuredClone(s),agent=new OwnerAgent(dir,{}, {},owner);await agent.restore(s);
  const restarted=new OwnerAgent(dir,{}, {},owner);await restarted.load();const restored=restarted.state;
  assert.equal(restored.halted,null);assert.equal(restored.haltKind,null);assert.equal(restored.lossPauseUntil,0);assert.equal(restored.entryStatus,undefined);assert.equal(restored.running,false);
  for(const key of ['lossStreak','cashSol','realizedNetSol','positions','trades','pending','recordedSignatures','cooldowns','buyPaused','buyCircuitOpen','peakEquity','dayStartEquity'])assert.deepEqual(restored[key],before[key],key);
 }finally{await rm(dir,{recursive:true,force:true});}
});
