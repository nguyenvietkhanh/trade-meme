import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {freshState,riskCheck} from '../src/engine.js';
import {createOwnerLedger,nextOwnerOrder} from '../src/owner-ledger.js';
import {OwnerAgent} from '../src/owner-agent.js';
import {TRADE_RULES} from '../src/desk-rules.js';
import {verifiedMarket} from './fixtures/verified-market.js';

test('loss above the retired daily threshold permits an eligible BUY even with old saved settings',()=>{
 const now=Date.now(),s=createOwnerLedger('owner',1.19),m=verifiedMarket({},now);
 Object.assign(s,{cashSol:1.15,running:true,halted:'old daily halt',haltKind:'daily',dailyLossBlocked:true});s.settings.maxDailyLossSol=.03;
 const before={dayStartEquity:s.dayStartEquity,peakEquity:s.peakEquity};
 const order=nextOwnerOrder(s,{markets:[m],solUsd:150,updatedAt:now},1.15);
 assert.equal(order.side,'BUY');assert.equal(order.orderSol,.23);assert.equal(s.halted,null);assert.equal(s.haltKind,null);assert.equal(s.dailyLossBlocked,false);assert.equal(s.running,true);
 assert.equal(s.cashSol,1.15);assert.equal(s.dayStartEquity,before.dayStartEquity);assert.equal(s.peakEquity,before.peakEquity);
});
test('removing daily limits preserves drawdown, manual halt and manual pause protections',()=>{
 const now=Date.now(),s=freshState(now);Object.assign(s,{cashSol:1,running:true,halted:'daily',haltKind:'daily',dailyLossBlocked:true});
 riskCheck(s,[],150,now);assert.equal(s.haltKind,'drawdown');assert.equal(s.running,false);riskCheck(s,[],150,now+86400000);assert.equal(s.haltKind,'drawdown');
 const manual=freshState(now);Object.assign(manual,{halted:'manual halt',haltKind:'manual',buyPaused:true,lossPauseUntil:now+7200000,dailyLossBlocked:true});
 riskCheck(manual,[],150,now);assert.equal(manual.halted,'manual halt');assert.equal(manual.haltKind,'manual');assert.equal(manual.buyPaused,true);assert.equal(manual.lossPauseUntil,0);
 assert.equal(TRADE_RULES.maxDailyLossSol,null);assert.equal(TRADE_RULES.stopLossPct,20);assert.equal(TRADE_RULES.maxDrawdownPct,15);assert.equal(TRADE_RULES.lossStreakLimit,null);assert.equal(TRADE_RULES.reserveSol,.05);
});
test('restoring a saved daily halt clears only that obsolete latch and retains pending receipts and history',async()=>{
 const dir=await mkdtemp('/tmp/meme-no-daily-');try{
  const owner='owner',s=createOwnerLedger(owner,1.19);Object.assign(s,{halted:'daily limit',haltKind:'daily',dailyLossBlocked:true,running:true,buyPaused:true,cashSol:1.15,entryStatus:{phase:'risk-halt',message:'daily limit'}});
  s.recordedSignatures=['previous-fill'];s.pending={transaction:'fixture-signed-bytes',intent:{owner,side:'BUY',amount:'30000000'}};
  const agent=new OwnerAgent(dir,{}, {},owner);await agent.restore(s);
  const restarted=new OwnerAgent(dir,{}, {},owner);await restarted.load();
  assert.equal(restarted.state.halted,null);assert.equal(restarted.state.haltKind,null);assert.equal(restarted.state.dailyLossBlocked,false);assert.equal(restarted.state.settings.maxDailyLossSol,null);assert.equal(restarted.state.entryStatus,undefined);
  assert.deepEqual(restarted.state.pending,s.pending);assert.deepEqual(restarted.state.recordedSignatures,['previous-fill']);assert.equal(restarted.state.cashSol,1.15);assert.equal(restarted.state.running,false);assert.equal(restarted.state.buyPaused,true);
  await assert.rejects(agent.restore(s),/đối soát/);
  s.haltKind='drawdown';s.halted='review required';await new OwnerAgent(dir,{}, {},owner).restore(s);const drawdown=new OwnerAgent(dir,{}, {},owner);await drawdown.load();assert.equal(drawdown.state.haltKind,'drawdown');assert.equal(drawdown.state.halted,'review required');
 }finally{await rm(dir,{recursive:true,force:true});}
});
