import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankMarket,decideMarket} from '../src/strategy.js';
import {analyzeDecision} from '../src/decision.js';
import {freshState,recordBuy,recordSell,riskCheck,exitPlan} from '../src/engine.js';
import {nextOwnerOrder} from '../src/owner-ledger.js';
import {TRADE_RULES as R,executionSlippageBps} from '../src/desk-rules.js';
import {verifiedMarket} from './fixtures/verified-market.js';
const now=Date.UTC(2026,9,17,12);
test('all mandatory safety facts remain fail-closed; optional creator and score inputs do not veto',()=>{
 const m=verifiedMarket({},now);assert.equal(decideMarket(m,R,now).action,'BUY');
 for(const key of ['mint','pairAddress','checkedAt','mintRevoked','freezeRevoked','tokenProgram','lpSecuredPct','probeSol','roundTripQuoteOk','roundTripLossPct','buyImpactPct','sellImpactPct','top10Pct','top10ExcludesPool','largestHolderPct','riskWarningsChecked','criticalWarnings']){
  const e={...m.evidence};delete e[key];const rank=rankMarket({...m,evidence:e},R,now);assert.equal(rank.eligible,false,key);assert.ok(Number.isInteger(rank.score));
 }
 for(const e of [{mintRevoked:false},{freezeRevoked:false},{lpSecuredPct:89.99},{probeSol:.02},{roundTripLossPct:6.01},{buyImpactPct:2.01},{sellImpactPct:2.01},{top10Pct:35.01},{top10ExcludesPool:false},{largestHolderPct:8.01},{devPct:5.01},{checkedAt:now-30001},{checkedAt:now+1},{mint:'other'},{pairAddress:'other'},{criticalWarnings:['danger']}])assert.equal(rankMarket({...m,evidence:{...m.evidence,...e}},R,now).eligible,false,JSON.stringify(e));
 const unknownDev={...m.evidence};delete unknownDev.devPct;const smaller=rankMarket({...m,evidence:unknownDev},R,now);assert.equal(smaller.eligible,true);assert.equal(smaller.orderSol,.2);
});
test('coarse market gates and raw quote liquidity apply independently of USD liquidity',()=>{
 const m=verifiedMarket({},now);
 for(const change of [{liquidityQuoteSol:19.99},{liquidityUsd:29999},{valuationSource:'fdv'},{buys5m:7},{buys5m:8,sells5m:6},{buys1h:39},{priceUsd:NaN},{updatedAt:now+1},{change5mPct:-8.01},{change1hPct:150.01},{symbol:'BONK'}])assert.equal(rankMarket({...m,...change},R,now).eligible,false,JSON.stringify(change));
 assert.equal(rankMarket({...m,hasProfile:false},R,now).eligible,true);
 assert.equal(rankMarket({...m,pairCreatedAt:now-900000},R,now).eligible,true);
 assert.equal(rankMarket({...m,pairCreatedAt:now-86400000},R,now).eligible,true);
 assert.equal(rankMarket({...m,boosted:true},R,now).score,95);
 const d=decideMarket({...m,evidence:{}},R,now);assert.equal(d.action,'SKIP');assert.ok(d.reasons.length<=3);assert.deepEqual(Object.keys(d),['action','token','sell_percent','score','reasons','red_flags']);
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
test('daily loss does not halt BUY; drawdown stops all automation and never clears itself',()=>{
 const s=freshState(now);s.peakEquity=.3;s.dayStartEquity=.3;s.cashSol=.27;s.running=true;riskCheck(s,[],150,now);assert.equal(s.halted,null);assert.equal(s.dailyLossBlocked,false);assert.equal(s.running,true);
 riskCheck(s,[],150,now+86400000);assert.equal(s.halted,null);assert.equal(s.dayStartEquity,.27);
 s.cashSol=.254;s.running=true;riskCheck(s,[],150,now+86400001);assert.equal(s.haltKind,'drawdown');assert.equal(s.running,false);
 riskCheck(s,[],150,now+2*86400000);assert.equal(s.haltKind,'drawdown');
});
test('closed losing positions update the streak without pausing BUY; partial sells do not count twice',()=>{
 const s=freshState(now),m=verifiedMarket({},now);
 for(let i=0;i<3;i++){recordBuy(s,m,150,{quantity:10,costSol:.03,priceUsd:.45},now);recordSell(s,m,150,{quantity:5,proceedsSol:.01,priceUsd:.3},now,'partial');assert.equal(s.lossPauseUntil,0);recordSell(s,m,150,{quantity:5,proceedsSol:.01,priceUsd:.3,closed:true},now,'close');}
 assert.equal(s.lossPauseUntil,0);assert.equal(s.lossStreak,3);
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
 const d=freshState(now);d.peakEquity=.3;d.dayStartEquity=.3;d.cashSol=.254;riskCheck(d,[],150,now);assert.equal(d.haltKind,'drawdown');assert.equal(d.dailyLossBlocked,false);
});
test('missing optional structure receives half points; abnormal volume/flow is penalized, not a hard veto',()=>{
 const m=verifiedMarket({},now),e={...m.evidence};delete e.higherLows;delete e.pullback30mPct;delete e.greenCandleConfirmed;
 const r=rankMarket({...m,evidence:e},R,now);assert.equal(r.scoreParts.structure,10);assert.equal(r.eligible,true);assert.ok(r.missingScoreData.includes('structure'));
 const odd=rankMarket({...m,buys5m:20,sells5m:4,volume5mUsd:2000000,volume1hUsd:3000000,volume24hUsd:4000000},R,now);assert.ok(odd.washPenalty>0);assert.equal(odd.red_flags.includes('SUSPICIOUS_TICKET_VOLUME'),false);
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

test('pool age is neither a BUY gate nor a scoring preference, including legacy settings and missing birth dates',()=>{
 const m=verifiedMarket({},now),base=rankMarket(m,R,now),legacy={...R,minPairAgeMs:900000,maxPairAgeMs:86400000};
 assert.equal(base.scoreParts.momentum,30);assert.equal(Object.hasOwn(base.scoreParts,'age'),false);
 assert.equal(Object.values(base.scoreParts).reduce((a,b)=>a+b,0),100);
 for(const pairCreatedAt of [now,now-1000,now-899999,now-86400001,now-365*86400000,undefined,null,0,NaN]){
  const market={...m,pairCreatedAt},rank=rankMarket(market,legacy,now);
  assert.equal(rank.eligible,true,String(pairCreatedAt));assert.equal(rank.score,base.score);assert.equal(rank.red_flags.includes('POOL_AGE'),false);
  for(const change of [{change5mPct:0},{change5mPct:-1},{change1hPct:0},{change1hPct:-1}])assert.equal(rankMarket({...market,...change},legacy,now).eligible,false);
  assert.equal(rankMarket({...market,evidence:{}},legacy,now).eligible,false);
  assert.equal(rankMarket({...market,updatedAt:now-30001},legacy,now).eligible,false,'removing birth-date limits must not remove data freshness');
 }
});
