import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankMarket,decideMarket} from '../src/strategy.js';
import {analyzeDecision} from '../src/decision.js';
import {freshState,recordBuy,recordSell,riskCheck,exitPlan} from '../src/engine.js';
import {nextOwnerOrder} from '../src/owner-ledger.js';
import {TRADE_RULES as R,executionSlippageBps} from '../src/desk-rules.js';
import {verifiedMarket} from './fixtures/verified-market.js';
const now=Date.UTC(2026,9,17,12);
test('every mandatory evidence field is fail-closed, including false, missing and stale data',()=>{
 const m=verifiedMarket({},now);assert.equal(decideMarket(m,R,now).action,'BUY');
 for(const key of Object.keys(m.evidence)){
  const e={...m.evidence};delete e[key];const rank=rankMarket({...m,evidence:e},R,now);assert.equal(rank.eligible,false,`missing ${key}`);assert.ok(Number.isInteger(rank.score)&&rank.score>=0&&rank.score<=100,`finite score with missing ${key}`);
 }
 for(const e of [{mintRevoked:false},{freezeRevoked:false},{lpSecuredPct:89.99},{sellSimulationOk:false},{probeSol:.3},{sellTaxPct:5.01},{sellImpactPct:3.01},{top10Pct:30.01},{top10ExcludesPool:false},{devPct:5.01},{bundleSniperPct:10.01},{uniqueBuyers5m:9},{uniqueBuyers5m:41},{washTradingDetected:true},{roundTripCostPct:8.01},{criticalWarnings:['LP unlocked']},{checkedAt:now-90001},{checkedAt:now+1},{mint:'other'},{pairAddress:'other'},{holderCount:99},{previousHolderAt:now},{higherLows:false},{change15mPct:100.01}])assert.equal(rankMarket({...m,evidence:{...m.evidence,...e}},R,now).eligible,false,JSON.stringify(e));
});
test('mandatory market boundaries use SOL price, actual cap and pool age, with no FDV or profile substitute',()=>{
 const m=verifiedMarket({},now);
 for(const change of [{liquidityUsd:2999},{liquidityUsd:49999},{solUsd:0},{valuationSource:'fdv'},{pairCreatedAt:now-899999},{pairCreatedAt:now-86400001},{buys1h:39},{sells1h:0},{buys5m:1.5},{buys5m:9,evidence:{...m.evidence,uniqueBuyers5m:9}},{volume1hUsd:1},{priceUsd:NaN},{updatedAt:now+1}])assert.equal(rankMarket({...m,...change},R,now).eligible,false,JSON.stringify(change));
 assert.equal(rankMarket({...m,hasProfile:false},R,now).eligible,true,'a social profile does not prove safety');
 assert.equal(rankMarket({...m,pairCreatedAt:now-900000},R,now).eligible,true);
 assert.equal(rankMarket({...m,pairCreatedAt:now-86400000},R,now).eligible,true);
 const r=rankMarket({...m,boosted:true},R,now);assert.equal(r.score,95);assert.equal(Object.values(r.scoreParts).reduce((a,b)=>a+b,0),100);
 const decision=decideMarket({...m,evidence:{}},R,now);assert.equal(decision.action,'SKIP');assert.ok(decision.reasons.length<=3);assert.deepEqual(Object.keys(decision),['action','token','sell_percent','score','reasons','red_flags']);
});
function account(){const s=freshState(now),m=verifiedMarket({priceUsd:1},now);recordBuy(s,m,1,{quantity:100,costSol:100,priceUsd:1},now,'fixture');Object.assign(s.settings,{feeSol:0,slippageBps:0});return {s,p:s.positions[0],m};}
test('moonbag trailing stop uses the peak since recovery, not a fixed entry stop',()=>{
 const {s,p,m}=account();p.phase='runner';p.peakPriceUsd=2;p.nextTakeProfitPriceUsd=4;
 assert.equal(exitPlan(p,{...m,priceUsd:3},1,s.settings,now),null);
 assert.equal(exitPlan(p,{...m,priceUsd:2.1},1,s.settings,now)?.reason,'runner-trailing');
});
test('time stop remembers whether the position ever exceeded 20%, and emergency exits take priority',()=>{
 const {s,p,m}=account();assert.equal(exitPlan(p,{...m,priceUsd:1.1},1,s.settings,now+2699999),null);
 assert.equal(exitPlan(p,{...m,priceUsd:1.1},1,s.settings,now+2700000)?.reason,'time-stop');
 exitPlan(p,{...m,priceUsd:1.21},1,s.settings,now+1000);assert.equal(exitPlan(p,{...m,priceUsd:1.1},1,s.settings,now+2700000),null);
 for(const change of [{liquidityUsd:m.liquidityUsd*.599},{evidence:{sellSimulationOk:false}},{evidence:{lpWithdrawn:true}},{evidence:{largeHolderDump:true}}])assert.deepEqual(exitPlan(p,{...m,...change},1,s.settings,now),{reason:'emergency-risk',fraction:1});
});
test('daily BUY halt resets at UTC rollover; drawdown stops all automation and never clears itself',()=>{
 const s=freshState(now);s.cashSol=.27;s.running=true;riskCheck(s,[],150,now);assert.equal(s.haltKind,'daily');assert.equal(s.running,true);
 riskCheck(s,[],150,now+86400000);assert.equal(s.halted,null);assert.equal(s.dayStartEquity,.27);
 s.cashSol=.254;s.running=true;riskCheck(s,[],150,now+86400001);assert.equal(s.haltKind,'drawdown');assert.equal(s.running,false);
 riskCheck(s,[],150,now+2*86400000);assert.equal(s.haltKind,'drawdown');
});
test('three closed losing positions pause BUY for two hours, not each partial sell',()=>{
 const s=freshState(now),m=verifiedMarket({},now);
 for(let i=0;i<3;i++){recordBuy(s,m,150,{quantity:10,costSol:.03,priceUsd:.45},now);recordSell(s,m,150,{quantity:5,proceedsSol:.01,priceUsd:.3},now,'partial');assert.equal(s.lossPauseUntil,undefined);recordSell(s,m,150,{quantity:5,proceedsSol:.01,priceUsd:.3,closed:true},now,'close');}
 assert.equal(s.lossPauseUntil,now+7200000);assert.equal(s.lossStreak,0);
});
test('position decisions are pure, reject mismatched tokens, and never require BUY eligibility to SELL',()=>{
 const {s,p,m}=account(),before=structuredClone(p);
 const d=analyzeDecision({market:{...m,priceUsd:.7,evidence:{}},position:p,settings:s.settings,solUsd:1,now});assert.equal(d.action,'SELL');assert.equal(d.sell_percent,100);assert.deepEqual(p,before);
 assert.equal(analyzeDecision({market:{...m,mint:'other'},position:p,now}).action,'SKIP');
 assert.equal(analyzeDecision().action,'SKIP');
});
test('normal slippage caps stay separate from emergency exits, with no increase permitted for buys',()=>{
 assert.equal(executionSlippageBps('BUY','emergency-risk'),400);assert.equal(executionSlippageBps('SELL','recover-capital'),300);assert.equal(executionSlippageBps('SELL','stop-loss'),1000);assert.equal(executionSlippageBps('SELL','emergency-risk'),1000);
 const m=verifiedMarket(),s=freshState();s.positions=[{mint:'a'},{mint:'b'}];s.cashSol=.3;s.peakEquity=.3;s.dayStartEquity=.3;
 // Known positions missing prices block risk; max positions must never depend on the old hard-coded five.
 assert.equal(nextOwnerOrder(s,{markets:[m],solUsd:150,updatedAt:Date.now()},.3),null);
});
test('stop loss includes SOL/USD opportunity cost and fees rather than testing token USD price alone',()=>{
 const s=freshState(now),m=verifiedMarket({priceUsd:1},now);recordBuy(s,m,100,{quantity:3,costSol:.0301,priceUsd:1},now);
 assert.equal(exitPlan(s.positions[0],m,150,s.settings,now)?.reason,'stop-loss');
 const d=freshState(now);d.cashSol=.254;riskCheck(d,[],150,now);assert.equal(d.haltKind,'drawdown');assert.equal(d.dailyLossBlocked,true);
});
test('unique buyer diversity uses all five-minute transactions, not just buy transactions',()=>{
 const m=verifiedMarket({buys5m:40,sells5m:20,evidence:{uniqueBuyers5m:12}},now);
 // 12/40=30% of buys but 12/60=20% of all trades: must be rejected.
 assert.ok(rankMarket(m,R,now).red_flags.includes('WASH_TRADING'));
 const boundary=verifiedMarket({buys5m:40,sells5m:20,evidence:{uniqueBuyers5m:15}},now);
 assert.equal(rankMarket(boundary,R,now).red_flags.includes('WASH_TRADING'),false);
});
test('stop loss takes precedence over the time stop so emergency slippage remains available',()=>{
 const {s,p,m}=account();const plan=exitPlan(p,{...m,priceUsd:.7},1,s.settings,now+2700000);
 assert.equal(plan.reason,'stop-loss');assert.equal(executionSlippageBps('SELL',plan.reason),1000);
});
test('null decision inputs and incomplete runner targets fail closed without a runtime exception',()=>{
 for(const input of [null,{}, {market:null},{market:[]}, {market:{mint:'t'}}]){const d=analyzeDecision(input);assert.equal(d.action,'SKIP');assert.ok(Number.isFinite(d.score));assert.ok(d.reasons.length<=3);}
 const {p,m}=account();p.phase='runner';p.nextTakeProfitPriceUsd=null;
 assert.equal(analyzeDecision({market:m,position:p,now}).action,'SKIP');
});
