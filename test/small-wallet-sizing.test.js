import test from 'node:test';
import assert from 'node:assert/strict';
import {smallWalletSizing} from '../src/small-wallet-sizing.js';
import {rulesConfig} from '../src/rules-config.js';
import {planRulesOrder} from '../src/rules-allocation.js';
import {RulesClient} from '../src/rules-client.js';
import {RulesQuoteBroker} from '../src/rules-quotes.js';
import {RulesTreasury} from '../src/rules-treasury.js';
import {RulesRuntime} from '../src/rules-runtime.js';
import {runnerSize,runnerConfig} from '../src/runner.js';
import {evaluateV5} from '../src/rules-v5.js';
import {fakeQuotes} from './fixtures/rules-confirmation.js';
const now=1900000000000,p=rulesConfig({}),base={wallet_balance_sol:.5,account_equity_sol:.5,available_capital_sol:.445,open_exposure_sol:0,quote_reserve_sol:100,holder_count:100,top10_pct:10,dev_wallet_pct:2,volume_5m_sol:3,buys_5m:20,sells_5m:10,change_5m_pct:5,open_positions_count:0,sol_price_usd:150,priority_fee_sol:.000025};
const ctx=(inputs=base)=>({snapshotId:'small-wallet',wallet:{running:true},positions:[],limits:{maxBatchOrders:10},rulesAccount:inputs,candidates:[{mint:'mint',pool:'pool',rulesEvidence:{checkedAt:now,inputs,observations:{}}}]});
test('at <=1 SOL threshold the SCALP minimum uses total native wallet, including exact boundary',()=>{
 for(const [balance,minimum]of [[.5,.1],[1,.2],[.1,.02],[.500000001,.100000001]]){const rule=smallWalletSizing(balance,p);assert.equal(rule.active,true);assert.equal(rule.minSol,minimum);assert.equal(rule.maxSol,minimum);}
 assert.equal(smallWalletSizing(1.000000001,p).active,false);assert.equal(smallWalletSizing(1.000000001,p).maxFraction,.1);
 for(const balance of [null,undefined,NaN,Infinity,-1,0])assert.equal(smallWalletSizing(balance,p).active,false);
 assert.equal(planRulesOrder({...base,account_equity_sol:5}, {},p).size,.1);
 assert.equal(planRulesOrder({...base,wallet_balance_sol:undefined}, {},p).smallWallet.active,false);
});
test('STANDARD, PROBE, QUICK and loss reductions never produce an executable subfloor SCALP entry',()=>{
 for(const tier of ['STANDARD','PROBE','QUICK'])for(const factor of [1,.5,.25])for(const minimal of [false,true]){const r=planRulesOrder({...base,entry_tier:tier,softRisk:{factor,minimal}},{},p);assert.equal(r.size,.1);assert.equal(r.minimumOrderSol,.1);}
});
test('above 1 SOL, old risk/depth/exposure/quote-reduction formulas are unchanged',()=>{
 const legacy=rulesConfig({SMALL_WALLET_ORDER_ENABLED:'false'});
 for(const balance of [1.000000001,2,3.33,100])for(const tier of ['STANDARD','PROBE','QUICK'])for(const factor of [1,.5,.25]){
  const i={...base,wallet_balance_sol:balance,account_equity_sol:balance,available_capital_sol:balance-.055,entry_tier:tier,softRisk:{factor}},a=planRulesOrder(i,{},p),b=planRulesOrder(i,{},legacy);for(const key of ['size','maxOrder','target','depthCap','exposureRemaining','baseRiskSize'])assert.equal(a[key],b[key],key);
 }
});
test('insufficient cash, gas, pool reserve, exposure, or selected quote rejects instead of shrinking below 20%',()=>{
 for(const patch of [{available_capital_sol:.099},{quote_reserve_sol:6},{open_exposure_sol:.151},{quote_selected_sol:.099},{wallet_balance_sol:.05,available_capital_sol:0}]){const r=planRulesOrder({...base,...patch},{},p);assert.equal(r.size,0);assert.equal(r.minimumBlocked,true);assert.equal(evaluateV5({...base,...patch},{},p).verdict,'SKIP');}
 assert.equal(planRulesOrder({...base,open_exposure_sol:.15},{},p).size,.1);
});
test('quote ladder never calls a reduced amount below the wallet minimum',async()=>{
 const amounts=[],broker=new RulesQuoteBroker({roundTripQuote:async(_mint,amount)=>{amounts.push(Number(amount));return {probeSol:Number(amount)/1e9,roundTripLossPct:7,buyImpactPct:.1,sellImpactPct:.1,roundTripQuoteOk:true,quoteCheckedAt:now};}},{clock:()=>now,policy:p,marketSnapshot:()=>({markets:[{mint:'mint',pairAddress:'pool',dexId:'pumpswap'}]})});
 const r=await broker.select({mint:'mint',pool:'pool'},{size:.1,minSize:.1});assert.equal(r.ok,false);assert.deepEqual(amounts,[100000000]);
});
test('malformed selector returning less than floor cannot grant a BUY or retain capital',async()=>{
 const c=new RulesClient({clock:()=>now,policy:p,quoteSelector:async()=>({ok:true,size:.05,quote:{roundTripLossPct:3},attempts:[]})});const r=await c.decide('kade',ctx());assert.equal(r.decision.action,'HOLD');assert.equal(c.grants.size,0);assert.equal(c.reservations.totals().slots,0);assert.equal(c.reports[0].code,'SMALL_WALLET_MINIMUM_BLOCKED');
});
test('concurrent 20% quote holds keep total exposure within 50% without subfloor fallback',async()=>{
 let release;const gate=new Promise(r=>release=r),c=new RulesClient({clock:()=>now,policy:p,quoteSelector:async(_m,plan)=>{await gate;return fakeQuotes(_m,plan);}});
 const one=ctx(),two=structuredClone(one),three=structuredClone(one);two.candidates[0].mint='mint2';three.candidates[0].mint='mint3';
 const a=c.decide('kade',one);await new Promise(setImmediate);const b=c.decide('kade',two);await new Promise(setImmediate);const third=await c.decide('kade',three);assert.equal(third.decision.action,'HOLD');assert.equal(c.reservations.totals().amountSol,.2);release();const buys=await Promise.all([a,b]);assert.ok(buys.every(r=>r.decision.order_sol===.1));assert.ok(c.reservations.totals().amountSol<=base.account_equity_sol*p.exposureFraction);
});
test('parent rejects below-floor amount before preparation/signing; parent above-1SOL cap remains old',async()=>{
 for(const [balance,amount,code]of [[.5,'50000000','RULES_SMALL_WALLET_MINIMUM'],[.5,'100000001','RULES_MAX_ORDER_FRACTION'],[2,'200000001','RULES_MAX_ORDER_FRACTION']]){
  const grant={mint:'mint',pool:'pool',amount,expiresAt:now+15000},c={grants:new Map([['grant',grant]])},t=new RulesTreasury('/tmp/no-small-wallet-io',{balance:async()=>balance},{clock:()=>now,policy:p,rulesClient:c,marketSnapshot:()=>({markets:[]})});t.s={positions:[],orders:{}};
  await assert.rejects(t.execute({id:'new',side:'BUY',mint:'mint',pairAddress:'pool',amount,aiRiskEvidence:{rulesGrant:'grant'}},{},'kade'),{code});
 }
});
test('balance deposit increasing floor or crossing 1SOL invalidates unsigned stale-size grant',async()=>{
 let balance=.6;const t=new RulesTreasury('/tmp/no-small-wallet-final-io',{balance:async()=>balance},{clock:()=>now,policy:p,rulesClient:{},marketSnapshot:()=>({markets:[],solUsd:150})}),order={id:'test',amount:'100000000',side:'BUY'};
 t.s={positions:[],orders:{[order.id]:order},rentByMint:{},realizedPnlSol:0};const grant={result:{sizing_mode:'AUTO'},recheckedInputs:{...base,quote_selected_sol:.1},recheckedObservations:{}};
 await assert.rejects(t.finalSizing(order,grant),{code:'RULES_CAPITAL_CHANGED'});balance=1.1;await assert.rejects(t.finalSizing(order,grant),{code:'RULES_CAPITAL_CHANGED'});
});
test('RUNNER keeps its own size and min validation while SCALP floor is exposed separately',async()=>{
 const {ACTIVE_BOT_CONFIGS}=await import('../src/paper-bot-config.js'),{initialBotState}=await import('../src/paper-bot-state.js'),{validateModelDecisions}=await import('../src/paper-model-context.js');
 const cfg=ACTIVE_BOT_CONFIGS[0],state={...initialBotState(cfg,now),mode:'live',aiOnly:true,cashSol:.5,positions:[],livePendings:[]},runtime=new RulesRuntime(cfg,state,{ai:{rulesPolicy:p}}),context=runtime.prepareDecisionContext({wallet:{cashSol:.5,running:true},positions:[],candidates:[{mint:'runner'}],limits:{minOrderSol:.0025,maxOrderSol:.445,maxPositions:100,maxBatchOrders:10}});
 assert.equal(context.limits.scalpMinOrderSol,.1);assert.equal(context.limits.minOrderSol,.0025);
 const decision={action:'BUY',mint:'runner',order_sol:.003,sell_percent:null,position_id:null,stop_loss_pct:50,confidence:0,reason:'fixture',risk_assessment:{approved:true,reason:'fixture',risks:[],unknowns:[]}};assert.equal(validateModelDecisions({decisions:[decision]},context).length,1);
 const runner=runnerSize({availableSol:1,equitySol:1,exposureSol:0,positionsCount:0,reserveSol:100,allocatedSol:0,netPnlSol:0},runnerConfig({RUNNER_ENABLED:'true'}));assert.equal(runner.size,.005);
});
