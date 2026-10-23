import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {PaperDesk} from '../src/paper-desk.js';
import {observePaperEligibility,rankPaperMarket,rankPaperMarketV3} from '../src/paper-policy.js';
import {SCALP_V3_VERSION,SCALP_STRATEGY_VERSION,persistentContinuation,modeledNormalRoundTripPct} from '../src/paper-scalp.js';
import {paperSummary} from '../src/paper-reports.js';
import {verifiedMarket} from './fixtures/verified-market.js';

const start=Date.now();
const tick=(i,overrides={})=>verifiedMarket({change5mPct:20,scalpConfirmed:undefined,priceUsd:.01*(1+i*.005),buys5m:40+i*3,sells5m:20+i,...overrides},start+i*5000);
test('persistence waits for three actual source observations and retains a conditional v3 label',()=>{
 const s={};let m;
 for(let i=0;i<3;i++){m=observePaperEligibility(s,[tick(i)],start+i*5000)[0];assert.equal(m.scalpConfirmed,i===2);if(i===1){assert.equal(rankPaperMarketV3(m,undefined,start+5000).eligible,true);assert.equal(rankPaperMarket(m,undefined,start+5000).previousPaper.eligible,true);}}
 assert.equal(rankPaperMarket(m,undefined,start+10000).eligible,true);assert.equal(m.scalpSetup.persistence.length,3);
 assert.equal(rankPaperMarket(m,undefined,start+10000).previousPaper.version,SCALP_V3_VERSION);
});
test('persistence rejects unchanged data, seller-dominated legs, window rolloffs, a hidden dump, and another pool',()=>{
 for(const bad of [{priceUsd:.01},{buys5m:41,sells5m:23},{buys5m:39},{liquidityUsd:1000}]){
  const s={};observePaperEligibility(s,[tick(0)],start);observePaperEligibility(s,[tick(1,bad)],start+5000);const m=observePaperEligibility(s,[tick(2)],start+10000)[0];assert.equal(m.scalpConfirmed,false,JSON.stringify(bad));
 }
 const s={};observePaperEligibility(s,[tick(0)],start);observePaperEligibility(s,[tick(1)],start+5000);observePaperEligibility(s,[{...tick(1),updatedAt:start+9000,priceUsd:.008}],start+9000);assert.equal(observePaperEligibility(s,[tick(2)],start+10000)[0].scalpConfirmed,false);
 assert.equal(observePaperEligibility(s,[tick(3,{pairAddress:'different'})],start+15000)[0].scalpConfirmed,false);
});
test('a true confirmation boolean cannot replace source evidence; replayed/future/overextended evidence is rejected',()=>{
 const m=verifiedMarket({change5mPct:20,scalpConfirmed:true},start),rows=m.scalpSetup.persistence;assert.equal(persistentContinuation(rows,start),true);
 for(const mutate of [r=>r.slice(1),r=>{r[1].sourceAt=r[0].sourceAt;return r;},r=>{r[2].at=start+1;return r;},r=>{r[2].priceUsd=r[0].priceUsd*1.05;return r;},r=>{r[1].at=r[0].at+4999;return r;}])assert.equal(persistentContinuation(mutate(structuredClone(rows)),start),false);
 const noProof={...m,scalpSetup:{...m.scalpSetup,persistence:null}};assert.equal(rankPaperMarket(noProof,undefined,start).eligible,false);assert.equal(rankPaperMarket(noProof,undefined,start).preQuoteEligible,true);
});
test('the entry cost gate includes both normal modeled legs without changing raw quote evidence, costs or slippage caps',()=>{
 assert.ok(Math.abs(modeledNormalRoundTripPct(3)-5.888175)<1e-8);assert.equal(modeledNormalRoundTripPct(null),null);
 const m=verifiedMarket({change5mPct:20,scalpConfirmed:true,evidence:{roundTripLossPct:4}},start),copy=JSON.stringify(m);
 assert.equal(rankPaperMarketV3(m,undefined,start).eligible,true);const r=rankPaperMarket(m,undefined,start);assert.equal(r.eligible,false);assert.equal(r.blockingStage,'safety');assert.ok(r.red_flags.includes('PAPER_COST_BUDGET'));assert.equal(r.previousPaper.eligible,true);assert.equal(JSON.stringify(m),copy);
 assert.equal(rankPaperMarket(verifiedMarket({change5mPct:20,scalpConfirmed:true,evidence:{roundTripLossPct:3}},start),undefined,start).eligible,true);
});

async function setup(t){const dir=await mkdtemp(path.join(tmpdir(),'paper-v4-'));t.after(()=>rm(dir,{recursive:true,force:true}));let at=start,value=.5;const calls=[];
 const quotes={quote:async q=>{calls.push(q);const out=q.side==='BUY'?'9000000000':String(Math.floor(Number(q.amount)/9e9*value*1e9));return {...q,inAmount:q.amount,outAmount:out,minOut:out,contextSlot:100,impactPct:1,checkedAt:at};}};
 const desk=new PaperDesk(dir,quotes,{clock:()=>at});await desk.load();const feed=()=>({markets:[verifiedMarket({change5mPct:20,scalpConfirmed:true,evidence:{probeSol:.5,decimals:6}},at)],updatedAt:at,solUsd:150,error:null});
 return {desk,dir,quotes,calls,feed,now:()=>at,advance:n=>at+=n,value:n=>value=n};
}
test('already-triggered exits settle at the 2s model delay without waiting for another 2s scan; BUYs never run in the fast worker',async t=>{
 const x=await setup(t);await x.desk.step(x.feed());x.advance(2100);await x.desk.settleExits(x.feed());assert.equal(x.calls.length,1);assert.equal(x.desk.state.positions.length,0);await x.desk.step(x.feed());
 x.value(.39);x.advance(2000);await x.desk.step(x.feed());assert.equal(x.desk.state.pending.reason,'stop-loss');const calls=x.calls.length;
 x.advance(1999);await x.desk.settleExits(x.feed());assert.equal(x.calls.length,calls);x.advance(1);await x.desk.settleExits(x.feed());assert.equal(x.calls.length,calls+1);assert.equal(x.desk.state.positions.length,0);
 const receipt=x.desk.state.trades[0];assert.equal(receipt.execution.latencyMs,2000);assert.equal(receipt.execution.assumedHaircutBps,1000);assert.equal(receipt.execution.slippageToleranceBps,1000);assert.equal(receipt.execution.decisionQuotedOutput,'390000000');assert.equal(receipt.execution.quoteOutputChangeVsDecisionPct,0);assert.ok(receipt.execution.decisionQuoteObservedAt<=receipt.execution.decisionAt);assert.ok(x.desk.state.cooldowns['test-mint']>=x.now()+86400000);
});
test('a winning ordinary close also blocks reentry for 24h and migration preserves historical cash/PnL/receipts',async t=>{
 const x=await setup(t);await x.desk.step(x.feed());x.advance(2100);await x.desk.step(x.feed());x.value(.7);x.advance(2000);await x.desk.step(x.feed());assert.equal(x.desk.state.pending.reason,'scalp-tp2');x.advance(2100);await x.desk.settleExits(x.feed());assert.equal(x.desk.state.positions.length,0);
 const s=x.desk.state,last=s.trades[0],cash=s.cashSol,pnl=s.realizedNetSol;assert.equal(s.cooldowns[last.mint],last.at+86400000);s.cooldowns[last.mint]=last.at+1800000;s.strategyVersion=SCALP_V3_VERSION;const receipts=JSON.parse(JSON.stringify(s.trades));await x.desk.save();
 const restored=new PaperDesk(x.dir,x.quotes,{clock:x.now});await restored.load();assert.equal(restored.state.strategyVersion,SCALP_STRATEGY_VERSION);assert.equal(restored.state.cashSol,cash);assert.equal(restored.state.realizedNetSol,pnl);assert.deepEqual(restored.state.trades,receipts);assert.equal(restored.state.cooldowns[last.mint],last.at+86400000);
});
test('provider cooldown and queue waiting are distinct from actual HTTP 429 responses',async t=>{
 const x=await setup(t);x.desk.error(Object.assign(Error('Jupiter HTTP 429: backoff'),{code:'PROVIDER_BACKOFF'}));x.desk.error(Object.assign(Error('waiting'),{code:'QUOTE_QUEUE_BUSY'}));x.desk.error(Error('Jupiter quote HTTP 429'));
 assert.deepEqual(x.desk.bucket().executionErrors,{PROVIDER_BACKOFF:1,QUOTE_QUEUE_BUSY:1,HTTP_429:1});
});
test('daily arithmetic explicitly separates modeled quote-to-fill cost, and missing quotes remain unknown',()=>{
 const sale={side:'SELL',closed:true,pnlSol:-.1,positionPnlSol:-.1,execution:{quotedOutput:'500000000',filledOutput:'450000000'}};
 const summary=paperSummary([sale]);assert.equal(summary.executionModel.sellQuoteToFillCostSol,.05);assert.equal(summary.executionModel.arithmeticPnlAtSameQuantitySellQuotesSol,-.05);assert.match(summary.executionModel.note,/Not a separately executable backtest/);
 assert.equal(paperSummary([sale,{...sale,execution:undefined}]).executionModel.arithmeticPnlAtSameQuantitySellQuotesSol,null);
});
