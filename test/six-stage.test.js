import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankMarket,coarseMarket} from '../src/strategy.js';
import {TRADE_RULES as R,validatePriorityBudget} from '../src/desk-rules.js';
import {verifiedMarket} from './fixtures/verified-market.js';
import {observeMarkets} from '../src/signals.js';
import {freshState,recordBuy,exitPlan,riskCheck} from '../src/engine.js';
import {createOwnerLedger,nextOwnerOrder,applyOwnerReceipt} from '../src/owner-ledger.js';
import {jupiterRoundTrip,jupiterSellQuote} from '../src/sell-quote.js';
import {SOL} from '../src/engine.js';
const now=Date.now();
test('six-stage score totals 100, fixed size is authoritative even with optional missing creator data',()=>{
 const m=verifiedMarket({},now);let r=rankMarket(m,R,now);assert.equal(r.score,100);assert.equal(r.orderSol,.2);
 const e={...m.evidence};delete e.higherLows;delete e.pullback30mPct;delete e.greenCandleConfirmed;
 r=rankMarket({...m,hasProfile:false,sells5m:12,evidence:e},R,now);assert.equal(r.score,73);assert.equal(r.orderSol,.2);assert.equal(r.eligible,true);
 delete e.devPct;r=rankMarket({...m,evidence:e},R,now);assert.equal(r.eligible,true);assert.equal(r.orderSol,.2);
 const unsafe=rankMarket({...m,evidence:{...e,top10Pct:36}},R,now);assert.equal(unsafe.eligible,false,'half score never fills mandatory safety');
});
test('FDV fallback is limited to pump suffix, legacy scanner cooldown cannot block scoring, quote reserve is mandatory',()=>{
 const m=verifiedMarket({},now);assert.equal(rankMarket({...m,mint:'samplepump',valuationSource:'pump-fdv',evidence:{...m.evidence,mint:'samplepump'}},R,now).eligible,true);
 assert.equal(coarseMarket({...m,valuationSource:'pump-fdv'},R,now).eligible,false);
 assert.equal(rankMarket({...m,coarseCooldownUntil:now+1800000},R,now).eligible,true);
 assert.equal(rankMarket({...m,liquidityQuoteSol:null,liquidityUsd:9999999,evidence:{...m.evidence,quoteReserveSol:undefined}},R,now).eligible,false);
});
test('two scans confirm in 10–15 seconds and an intervening dump resets confirmation',()=>{
 const s=freshState(now),m=verifiedMarket({},now);observeMarkets(s,[m],now);
 assert.equal(observeMarkets(s,[m],now+9000)[0].signalConfirmed,false);
 assert.equal(observeMarkets(s,[{...m,updatedAt:now+10000}],now+10000)[0].signalConfirmed,true);
 observeMarkets(s,[{...m,updatedAt:now+12000,change5mPct:-9}],now+12000);
 assert.equal(observeMarkets(s,[{...m,updatedAt:now+20000}],now+20000)[0].signalConfirmed,false);
});
function position(){const s=createOwnerLedger('owner',.3),m=verifiedMarket({priceUsd:1},now);recordBuy(s,m,100,{quantity:3,costSol:.03,priceUsd:1,rawQuantity:'3000000',decimals:6},now-1000,'fixture','live');return {s,m,p:s.positions[0]};}
test('executable quote drives net-SOL stop even when DexScreener token price looks profitable',()=>{
 const {s,m,p}=position();const quote={mint:p.mint,rawAmount:p.rawQuantity,checkedAt:now,netSol:.023};
 assert.equal(exitPlan(p,{...m,priceUsd:2,exitQuote:quote},100,{...R,requireExecutableQuote:true},now).reason,'stop-loss');
 assert.equal(exitPlan({...p},{...m,priceUsd:2,exitQuote:{...quote,checkedAt:now-30001}},100,{...R,requireExecutableQuote:true},now)?.reason,'recover-capital');
});
test('maximum hold and stale-data SELL are independent of entry feed availability',()=>{
 const {s,m,p}=position();p.openedAt=Date.now()-R.maxHoldMs;
 const order=nextOwnerOrder(s,{markets:[{...m,updatedAt:now-60000}],solUsd:100,updatedAt:now-60000,error:'Dex API offline'},.3);
 assert.equal(order.side,'SELL');assert.equal(order.reason,'max-hold');assert.equal(order.closeEmptyInput,true);
 const empty=createOwnerLedger('owner',.3);assert.equal(nextOwnerOrder(empty,{markets:[m],solUsd:100,updatedAt:now-30001},.3),null);
});
test('drawdown liquidates each tracked position before stopping, and never records an unconfirmed exit',()=>{
 const {s,m,p}=position();s.running=true;s.cashSol=.20;s.peakEquity=.3;
 const f={markets:[m],solUsd:100,updatedAt:Date.now()};riskCheck(s,[m],100);assert.equal(s.haltKind,'drawdown');assert.equal(s.liquidating,true);assert.equal(s.running,true);
 const order=nextOwnerOrder(s,f,.23);assert.equal(order.reason,'drawdown-close');assert.equal(s.positions.length,1);
 applyOwnerReceipt(s,{intent:{...order,solUsd:100,priceUsd:1}},{status:'confirmed',signature:'liquidated',tokenDelta:'-3000000',solDelta:.03,decimals:6,feeSol:.00002});
 assert.equal(s.positions.length,0);assert.equal(s.running,false);assert.equal(s.liquidating,false);assert.equal(s.haltKind,'drawdown');
});
test('trailing tightens at 4x and 8x, and exhausted volume exits below entry',()=>{
 for(const [peak,price]of [[3,2.1],[4,3],[8,6.4]]){const {s,p,m}=position();p.phase='runner';p.peakPriceUsd=peak;p.nextTakeProfitPriceUsd=peak*2;assert.equal(exitPlan(p,{...m,priceUsd:price},100,R,now).reason,'runner-trailing');}
 const {p,m}=position();assert.equal(exitPlan(p,{...m,priceUsd:.99,volume5mUsd:2999},100,R,now).reason,'volume-exhaustion');
});
test('priority and tip share a 0.002 SOL per-side ceiling',()=>{
 assert.doesNotThrow(()=>validatePriorityBudget(1500000,500000));for(const values of [[1500000,500001],[-1,0],[1.5,0],[Infinity,0]])assert.throws(()=>validatePriorityBudget(...values));
});
function router(mint,{sellOut='197000000',bad=false}={}){return async url=>{const u=new URL(url),input=u.searchParams.get('inputMint'),amount=u.searchParams.get('amount'),out=input===SOL?'10000000':sellOut,bps=Number(u.searchParams.get('slippageBps'));return new Response(JSON.stringify({inputMint:bad?'wrong':input,outputMint:u.searchParams.get('outputMint'),inAmount:amount,outAmount:out,otherAmountThreshold:(BigInt(out)*BigInt(10000-bps)/10000n).toString(),slippageBps:bps,swapMode:'ExactIn',contextSlot:100,routePlan:[{}],priceImpactPct:'0.01'}));};}
test('Jupiter round trip sells the full quoted token output, includes fee allowance and binds both mints',async()=>{
 const mint='token',requests=[],base=router(mint),q=await jupiterRoundTrip(mint,async url=>{requests.push(new URL(url));return base(url);},.2);assert.equal(requests[0].searchParams.get('amount'),'200000000');assert.equal(requests[1].searchParams.get('amount'),'10000000');assert.equal(q.probeSol,.2);assert.equal(q.buyImpactPct,1);assert.ok(q.roundTripLossPct<6);
 const costly=await jupiterRoundTrip(mint,router(mint,{sellOut:'186000000'}),.2);assert.ok(costly.roundTripLossPct>6);
 await assert.rejects(jupiterRoundTrip(mint,router(mint,{bad:true}),.2),/không khớp/);
 const noRoute=await jupiterSellQuote({mint,rawAmount:'10000000'},async()=>new Response(JSON.stringify({errorCode:'COULD_NOT_FIND_ANY_ROUTE'}),{status:400}));assert.equal(noRoute.failed,true);
 await assert.rejects(jupiterSellQuote({mint,rawAmount:'10000000'},async()=>new Response('{}',{status:403})),/HTTP 403/);
});
test('a stopped token stays blocked for 24 hours and a 0.2 SOL order cannot consume reserve',()=>{
 const {s,m,p}=position();
 applyOwnerReceipt(s,{intent:{side:'SELL',mint:p.mint,symbol:p.symbol,solUsd:100,priceUsd:.7,reason:'stop-loss'}},{status:'confirmed',signature:'stop-24h',tokenDelta:'-3000000',solDelta:.021,decimals:6,feeSol:.00002});
 assert.ok(s.cooldowns[p.mint]>=Date.now()+R.reentryMs-1000);
 const small=createOwnerLedger('owner',.06);assert.equal(nextOwnerOrder(small,{markets:[m],solUsd:100,updatedAt:Date.now()},.06),null);
 const funded=createOwnerLedger('owner',.255);assert.equal(nextOwnerOrder(funded,{markets:[m],solUsd:100,updatedAt:Date.now()},.255).orderSol,.051);
});

test('owner entry opens more than two positions until SOL reserve and fees prevent the next buy',()=>{
 const s=createOwnerLedger('owner',1.19),markets=[],feed=()=>({markets,solUsd:100,updatedAt:Date.now()});
 assert.equal(s.settings.maxPositions,null);
 for(let i=0;i<20;i++){
  const m=verifiedMarket({mint:'capital-'+i,priceUsd:1},Date.now());markets.push(m);
  const order=nextOwnerOrder(s,feed(),s.cashSol);
  if(!order)break;
  assert.equal(order.side,'BUY');assert.equal(order.mint,m.mint);
  const amount=String(Math.round(order.orderSol*1e9)),raw=String(Math.round(order.orderSol*1e8)),intent={...order,owner:'owner',amount,solUsd:100,priceUsd:1};
  applyOwnerReceipt(s,{intent},{status:'confirmed',signature:'capital-fill-'+i,tokenDelta:raw,solDelta:-order.orderSol-.0001,decimals:6,feeSol:.00002});
  assert.ok(s.cashSol>=s.settings.reserveSol);
 }
 assert.ok(s.positions.length>=5);assert.ok(s.trades.length>=5);assert.equal(nextOwnerOrder(s,feed(),s.cashSol),null);
 const position=s.positions[0];applyOwnerReceipt(s,{intent:{side:'SELL',mint:position.mint,symbol:position.symbol,solUsd:100,priceUsd:1,reason:'owner-exit'}},{status:'confirmed',signature:'capital-exit',tokenDelta:'-20000000',solDelta:.2002,decimals:6,feeSol:.00002});
 const resumed=nextOwnerOrder(s,feed(),s.cashSol);assert.equal(resumed.side,'BUY');assert.equal(resumed.mint,markets.at(-1).mint);
});
