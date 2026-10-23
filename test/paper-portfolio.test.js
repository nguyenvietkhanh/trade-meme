import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {paperPortfolioAdmission,recordExitSurveillance,PAPER_PORTFOLIO_POLICY} from '../src/paper-portfolio.js';
import {paperOrderSol} from '../src/paper-sizing.js';
import {newPaperState,PaperDesk} from '../src/paper-desk.js';
import {SCALP_EXIT_RULES,SCALP_V3_VERSION} from '../src/paper-scalp.js';
import {VerificationFeed} from '../src/verification.js';
import {rankPaperMarket} from '../src/paper-policy.js';
import {verifiedMarket} from './fixtures/verified-market.js';
const now=Date.now();
function held(s,{mint='held',cost=.500025,initial=cost,fee=.000025,stop=12,net=cost,at=now}={}){
 const p={mint,pairAddress:'pool-'+mint,quantity:1,rawQuantity:'1000000',costSol:cost,initialCostSol:initial,modeledBuyFeeSol:fee,openedAt:now-1000,exitPolicy:{...SCALP_EXIT_RULES,stopLossPct:stop}};
 s.cashSol-=cost;s.positions.push(p);s.marks[mint]={rawAmount:p.rawQuantity,checkedAt:at,netSol:net};return p;
}
test('risk arithmetic distinguishes 2.5% allocation, 0.3% per-trade nominal risk and the 1.5% open-risk budget',()=>{
 const s=newPaperState(now),a=paperPortfolioAdmission(s,{now});assert.equal(paperOrderSol(s),.5);assert.equal(a.requestedNominalRiskSol,.06);assert.equal(a.perTradeRiskBudgetSol,.06);assert.equal(a.openRiskBudgetSol,.3);assert.equal(a.operationalCapacity,4);assert.equal(a.allowed,true);
 held(s);const b=paperPortfolioAdmission(s,{now});assert.equal(b.openRiskChargedSol,.06);assert.equal(b.stress.loss50PctSol,.25);assert.equal(b.stress.loss90PctSol,.45);assert.equal(b.allowed,true);
});
test('a large legacy holding consumes the portfolio risk budget even when only one position is open',()=>{
 const s=newPaperState(now);held(s,{cost:3,initial:3,fee:0,stop:20,net:3.2});const a=paperPortfolioAdmission(s,{now});assert.equal(a.openRiskChargedSol,.6);assert.equal(a.code,'PORTFOLIO_RISK_LIMIT');assert.equal(s.positions.length,1);assert.equal(s.halted,null);
});
test('unknown, old, future or wrong-quantity marks are full exposure, and a quoted stop blocks new entries',()=>{
 for(const change of [m=>{m.checkedAt=now-10001;},m=>{m.checkedAt=now+1;},m=>{m.rawAmount='wrong';},m=>{m.netSol=null;}]){
  const s=newPaperState(now);held(s);change(s.marks.held);const a=paperPortfolioAdmission(s,{now});assert.equal(a.code,'EXIT_QUOTES_STALE');assert.equal(a.openRiskChargedSol,.5);assert.deepEqual(a.staleMints,['held']);
 }
 const s=newPaperState(now);held(s,{net:.4});const a=paperPortfolioAdmission(s,{now});assert.equal(a.code,'EXIT_REQUIRED');assert.equal(a.openRiskChargedSol,.100025);assert.equal(s.running,true);
});
test('partial sales reduce remaining principal/risk and allocate the original modeled BUY fee proportionally',()=>{
 const s=newPaperState(now);held(s,{cost:.2500125,initial:.500025,net:.26});const a=paperPortfolioAdmission(s,{now});assert.equal(a.positions[0].principalSol,.25);assert.equal(a.positions[0].nominalRiskSol,.03);assert.equal(a.openRiskChargedSol,.03);
});
test('observed slow quote cadence lowers capacity; old telemetry expires without hiding stale quote data',()=>{
 const s=newPaperState(now);held(s);recordExitSurveillance(s,{at:now-4000,completedAt:now-3900,ok:true});recordExitSurveillance(s,{at:now,completedAt:now,ok:true});
 assert.equal(paperPortfolioAdmission(s,{now}).measuredMonitorCadenceMs,4000);assert.equal(paperPortfolioAdmission(s,{now}).operationalCapacity,1);assert.equal(paperPortfolioAdmission(s,{now}).code,'EXIT_CAPACITY');
 const later=now+PAPER_PORTFOLIO_POLICY.telemetryWindowMs+1;assert.equal(paperPortfolioAdmission(s,{now:later}).code,'EXIT_QUOTES_STALE');s.marks.held.checkedAt=later;assert.equal(paperPortfolioAdmission(s,{now:later}).operationalCapacity,4);assert.equal(paperPortfolioAdmission(s,{now:later}).allowed,true);
 const blocked=newPaperState(now);recordExitSurveillance(blocked,{at:now-11000,completedAt:now,ok:true});assert.equal(paperPortfolioAdmission(blocked,{now}).operationalCapacity,0);assert.equal(paperPortfolioAdmission(blocked,{now}).code,'EXIT_CAPACITY');
});
test('exit provider failure prevents additional BUYs and a later successful read recovers even at the same timestamp',()=>{
 const s=newPaperState(now);recordExitSurveillance(s,{at:now,completedAt:now,ok:false});assert.equal(paperPortfolioAdmission(s,{now}).code,'EXIT_PROVIDER_UNAVAILABLE');recordExitSurveillance(s,{at:now,completedAt:now,ok:true});assert.equal(paperPortfolioAdmission(s,{now}).allowed,true);
});
test('pending BUY principal/risk is reserved and its own post-delay recheck does not count it twice',()=>{
 const s=newPaperState(now);s.pending={id:'intent',side:'BUY',amount:'500000000'};const a=paperPortfolioAdmission(s,{now});assert.equal(a.code,'READY');assert.equal(a.reservedEntries,1);assert.equal(a.reservedPrincipalSol,.5);assert.equal(a.pendingRiskSol,.06);const own=paperPortfolioAdmission(s,{now,ignorePendingId:'intent'});assert.equal(own.pendingRiskSol,0);assert.equal(own.allowed,true);
});
test('invalid risk data is rejected and portfolio checks never reactivate retired account halts',()=>{
 const s=newPaperState(now);held(s,{stop:NaN});assert.equal(paperPortfolioAdmission(s,{now}).code,'PORTFOLIO_DATA_INVALID');assert.equal(s.settings.maxDailyLossSol,null);assert.equal(s.settings.maxDrawdownPct,null);assert.equal(s.settings.lossStreakLimit,null);assert.equal(s.running,true);
});
test('a token can pass safety/signal while the decision log explicitly records a separate portfolio rejection',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'portfolio-log-'));t.after(()=>rm(dir,{recursive:true,force:true}));const desk=new PaperDesk(dir,{}, {clock:()=>now});await desk.load();held(desk.state,{net:.4});desk.evaluate([verifiedMarket({change5mPct:27,scalpConfirmed:true},now)],now);const d=desk.state.decisions[0];assert.equal(d.tokenEligible,true);assert.equal(d.blockingStage,'portfolio');assert.equal(d.action,'SKIP');assert.deepEqual(d.primaryFlags,['EXIT_REQUIRED']);assert.equal(d.score>=40,true);
});
test('budget/surveillance admission is checked again after awaiting the BUY quote without changing virtual cash',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'portfolio-fill-'));t.after(()=>rm(dir,{recursive:true,force:true}));let at=now,latency=0;const quotes={quote:async q=>{at+=latency;return {...q,inAmount:q.amount,outAmount:'9000000000',minOut:'8640000000',checkedAt:at,contextSlot:100,impactPct:1};}};
 const desk=new PaperDesk(dir,quotes,{clock:()=>at});await desk.load();const feed={markets:[verifiedMarket({change5mPct:27,scalpConfirmed:true,evidence:{probeSol:.5,decimals:6}},at)],updatedAt:at,solUsd:150,error:null};await desk.step(feed);assert.equal(desk.state.pending.side,'BUY');held(desk.state,{at:now-7000});const cash=desk.state.cashSol;at+=2100;latency=1100;await desk.fillPending(feed);assert.equal(desk.state.positions.length,1);assert.equal(desk.state.cashSol,cash);assert.equal(desk.state.lastExecutionError.code,'EXIT_QUOTES_STALE');
});
test('blocked portfolios avoid new candidate RPC/quote work while held-token safety checks still run',async t=>{
 let allow=false,facts=0,quotes=0,reports=0;const mint='11111111111111111111111111111112',m=verifiedMarket({mint,change5mPct:27,scalpConfirmed:true},now);
 const v=new VerificationFeed(async url=>{if(!String(url).includes('rugcheck'))return new Response('{}');reports++;return new Response(JSON.stringify({mint,token:{mintAuthority:null,freezeAuthority:null},risks:[],markets:[{pubkey:m.pairAddress,lp:{lpLockedPct:95}}]}));},{inspectMarketFacts:async()=>{facts++;return {...m.evidence};},inspectMarketQuote:async()=>{quotes++;return {roundTripQuoteOk:true,probeSol:.5,roundTripLossPct:3,buyImpactPct:1,sellImpactPct:1,quoteCheckedAt:now};}},{rankMarket:rankPaperMarket,ignoreH4:true,quoteTracked:false,requireConfirmedQuote:true,canInspectCandidate:()=>allow});
 await v.enrich([m],[],now);assert.equal(reports+facts+quotes,0);allow=true;await v.enrich([m],[],now);assert.equal(reports,1);assert.equal(facts,1);assert.equal(quotes,1);allow=false;await v.enrich([m],[mint],now+21000);assert.equal(reports,2);assert.equal(facts,2);assert.equal(quotes,1);
});
