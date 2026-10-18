import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankMarket} from '../src/strategy.js';
import {exitPlan,recordSell} from '../src/engine.js';
import {createOwnerLedger,nextOwnerOrder,applyOwnerReceipt} from '../src/owner-ledger.js';
import {observeMarkets} from '../src/signals.js';
import {TRADE_RULES} from '../src/desk-rules.js';
import {verifiedMarket} from './fixtures/verified-market.js';
import {VerificationFeed} from '../src/verification.js';
import {DirectWallet} from '../src/direct-wallet.js';
import {SolanaExecution} from '../src/solana.js';
import {curveFixture} from './fixtures/curve-rpc.js';
const curveMarket=(now=Date.now(),overrides={})=>verifiedMarket({venue:'pumpfun',dexId:'pumpfun',valuationSource:'curve-marketCap',pairCreatedAt:now-240000,change1mPct:2,change1hPct:null,volume1mUsd:5000,uniqueBuyers5m:30,historyComplete:true,activityCheckedAt:now,creatorSoldRecently:false,suspectedBundle:false,...overrides,evidence:{lpSecuredPct:undefined,riskWarningsChecked:undefined,criticalWarnings:undefined,probeSol:.05,curveVerified:true,curveComplete:false,roundTripProvider:'pumpfun',...overrides.evidence}},now);

test('pre-migration entries use M1/M5 rather than nonexistent H1/H4, but still require real curve/holder/authority facts',()=>{
 const now=Date.now(),m=curveMarket(now,{evidence:{h4Risk:{state:'reject',mint:'test-mint',pairAddress:'test-pool',checkedAt:now}}});assert.equal(rankMarket(m,TRADE_RULES,now).eligible,true);
 for(const change of [{change1mPct:0},{change5mPct:-1},{pairCreatedAt:now-179999},{uniqueBuyers5m:1},{historyComplete:false},{creatorSoldRecently:true},{suspectedBundle:true},{evidence:{devPct:null}},{evidence:{curveVerified:false}},{evidence:{curveComplete:true}},{evidence:{holderCount:29}},{evidence:{mintRevoked:false}},{evidence:{top10Pct:36}},{evidence:{roundTripProvider:'Jupiter'}}]){const changed={...m,...change,evidence:{...m.evidence,...change.evidence}};assert.equal(rankMarket(changed,TRADE_RULES,now).eligible,false,JSON.stringify(change));}
 const swap=verifiedMarket({change1hPct:null},now);assert.equal(rankMarket(swap,TRADE_RULES,now).eligible,false);assert.equal(TRADE_RULES.maxDailyLossSol,null);assert.equal(TRADE_RULES.lossPauseMs,0);
});
test('curve confirmation requires distinct observations and supports new coins with no H1 candles',()=>{
 const now=Date.now(),state={},m=curveMarket(now);assert.equal(observeMarkets(state,[m],now)[0].signalConfirmed,false);assert.equal(observeMarkets(state,[{...m,priceUsd:m.priceUsd*1.01}],now+10000)[0].signalConfirmed,true);
 assert.equal(observeMarkets(state,[{...m,change1mPct:-1}],now+15000)[0].signalConfirmed,false);
});
test('owner ledger sizes each venue independently and leaves old PumpSwap allocation at 20%',()=>{
 const s=createOwnerLedger('owner',1),now=Date.now(),curve=curveMarket(now),f={solUsd:100,updatedAt:now,markets:[curve]};s.running=true;
 assert.equal(nextOwnerOrder(s,f,1).orderSol,.05);assert.equal(nextOwnerOrder(s,f,1).venue,'pumpfun');f.markets=[verifiedMarket({},now)];assert.equal(nextOwnerOrder(s,f,1).orderSol,.2);
});
test('direct curve verifier uses official ownership/complete reserves and aggregates holders excluding curve vault',async()=>{
 const f=await curveFixture(),e=new SolanaExecution();e.rpc=f.rpc;const m=curveMarket(Date.now(),{mint:f.mint.toBase58(),pairAddress:f.address.toBase58()});
 const evidence=await e.inspectCurveMarket(m);assert.equal(evidence.curveVerified,true);assert.equal(evidence.quoteReserveSol,30);assert.equal(evidence.holderCount,60);assert.ok(evidence.top10Pct<35);assert.ok(evidence.devPct<5);assert.equal(evidence.lpSecuredPct,undefined);
 let calls=0;const feed=new VerificationFeed(async()=>{calls++;throw Error('must not invent LP report for curve');},e);const enriched=await feed.enrich([m]);assert.equal(calls,0);assert.equal(enriched[0].evidence.source,'pumpfun-onchain-curve');assert.equal(enriched[0].verificationError,undefined);
});
test('DirectWallet prepares a curve entry without Jupiter requests and returns a newly bound 5% proof',async()=>{
 const f=await curveFixture(),e=new SolanaExecution();e.rpc=f.rpc;const desk=new DirectWallet(e);desk.owner=f.user.toBase58();e.entryQuote=()=>{throw Error('Jupiter must not gate a curve entry');};
 const evidence=await e.inspectCurveMarket({mint:f.mint.toBase58(),pairAddress:f.address.toBase58()}),m=curveMarket(Date.now(),{mint:f.mint.toBase58(),pairAddress:f.address.toBase58(),priceUsd:60/536500000*100,evidence});
 const p=await desk.prepare({side:'BUY',mint:m.mint,orderSol:.05},{updatedAt:Date.now(),solUsd:100,markets:[m]});assert.equal(p.intent.amount,'50000000');assert.equal(p.intent.venue,'pumpfun');assert.equal(p.intent.entryQuoteProof.roundTripProvider,'pumpfun');assert.ok(Date.now()-p.intent.entryQuoteProof.quoteCheckedAt<5000);
});
function position(){const s=createOwnerLedger('owner',1),intent={side:'BUY',venue:'pumpfun',mint:'curve',symbol:'C',pairAddress:'curve-pda',amount:'50000000',solUsd:100,priceUsd:1,entryLiquidityUsd:3000};applyOwnerReceipt(s,{intent},{status:'confirmed',signature:'buy',solDelta:-.05,tokenDelta:'100000000',decimals:6,feeSol:.00002,slot:1});return {s,p:s.positions[0]};}
function quote(p,multiple,now=Date.now()){return {mint:p.mint,priceUsd:1,liquidityUsd:3000,exitQuote:{mint:p.mint,rawAmount:p.rawQuantity,netSol:p.quantity*p.entryPriceSol*multiple,checkedAt:now,provider:'pump.fun'}};}
test('curve early profit and +80% recovery account for previous proceeds rather than recovering capital twice',()=>{
 const {s,p}=position(),now=Date.now();let plan=exitPlan(p,quote(p,1.35,now),100,s.settings,now);assert.equal(plan.reason,'curve-early-profit');assert.equal(plan.fraction,.25);
 recordSell(s,{mint:p.mint,priceUsd:1},100,{quantity:25,proceedsSol:.016875,priceUsd:1,rawBalance:'75000000',closed:false},now,plan.reason,'live');assert.equal(p.earlyProfitTaken,true);assert.equal(p.phase,'initial');
 const m=quote(p,1.8,now+1000);plan=exitPlan(p,m,100,s.settings,now+1000);assert.equal(plan.reason,'recover-capital');const remainingTarget=.05*1.4-.016875;assert.ok(Math.abs(m.exitQuote.netSol*plan.fraction-remainingTarget)<1e-12);assert.ok(plan.fraction<1);
});
test('curve exit quotes must be fresh, drawdown policy stays unchanged, and time/max holds differ only for curve positions',()=>{
 const {s,p}=position(),now=Date.now(),bad=quote(p,.5,now-5001);assert.equal(exitPlan(p,bad,100,s.settings,now),null);
 assert.equal(exitPlan(p,quote(p,.5,now),100,s.settings,now).reason,'stop-loss');assert.equal(exitPlan(p,quote(p,1.1,now+900001),100,s.settings,p.openedAt+900001).reason,'time-stop');
 p.maxGainPct=50;assert.equal(exitPlan(p,quote(p,1.2,now+3600001),100,s.settings,p.openedAt+3600001).reason,'max-hold');assert.equal(s.settings.maxDrawdownPct,15);
});
