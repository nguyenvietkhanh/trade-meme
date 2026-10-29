import test from 'node:test';import assert from 'node:assert/strict';import {evaluateV5,sizingV5,exitV5,RulesInputError} from '../src/rules-v5.js';import {RulesClient} from '../src/rules-client.js';import {RulesEvidence} from '../src/rules-evidence.js';import {fakeQuotes} from './fixtures/rules-confirmation.js';import {softRisk} from '../src/rules-risk.js';
const now=1900000000000;
export const input=()=>({token:'mint',pool:'pool',wallet_balance_sol:3.33,account_equity_sol:3.33,available_capital_sol:3,priority_fee_sol:.000025,sol_price_usd:150,top10_pct:10,dev_wallet_pct:2,holder_count:100,quote_reserve_sol:20,open_positions_count:0,buys_5m:20,sells_5m:10,volume_5m_sol:3,change_5m_pct:5});
test('sizing is risk-based and safety constraints fail closed without treating optional history as safety',()=>{
 assert.equal(sizingV5(input()).size,.15);for(const k of ['top10_pct','dev_wallet_pct','holder_count'])assert.throws(()=>evaluateV5({...input(),[k]:null}),RulesInputError);
 for(const update of [{top10_pct:26},{dev_wallet_pct:6},{holder_count:19},{quote_reserve_sol:4.99},{open_positions_count:10},{available_capital_sol:0}])assert.equal(evaluateV5({...input(),...update}).verdict,'SKIP');
 const r=evaluateV5(input());assert.equal(r.verdict,'VALID_SETUP');assert.ok(r.unknowns.includes('unique_buyers_5m'));assert.equal(r.requires_user_acknowledgment,false);
 assert.equal(evaluateV5(input(),{creatorSoldRecently:true}).verdict,'SKIP');assert.equal(evaluateV5(input(),{suspectedBundle:true}).verdict,'SKIP');
});
test('all UTC hours and losing-event reductions remain eligible with no timed entry window or automatic pause',()=>{
 for(let h=0;h<24;h++){const r=evaluateV5({...input(),current_utc_hour:h,softRisk:softRisk({lossStreak:5,peakSol:3.33,equitySol:2.7})});assert.equal(r.rule_check.R6,'pass');assert.equal(r.verdict,'VALID_SETUP');assert.equal(r.entry_tier,'PROBE');assert.equal(r.R1_detail.softRisk.buyPaused,false);}
});
test('only shortlisted valid candidates get actual quotes; manual kill blocks entries but creates no automatic switch',async()=>{
 let calls=0;const c=new RulesClient({clock:()=>now,quoteSelector:async(...a)=>{calls++;return fakeQuotes(...a);}}),ctx={snapshotId:'x',wallet:{running:true},limits:{maxBatchOrders:5},rulesAccount:{wallet_balance_sol:.5,account_equity_sol:.5,available_capital_sol:.445,sol_price_usd:150,open_positions_count:0},candidates:[{mint:'mint',pool:'pool',rulesEvidence:{checkedAt:now,inputs:input(),observations:{}}},{mint:'bad',pool:'bad',rulesEvidence:{error:'pre_filter_dead',diagnostic:{reserve:4e-9},inputs:{}}}]};
 const r=await c.decide('kade',ctx);assert.equal(r.decision.action,'BUY');assert.equal(calls,1);assert.ok(r.decision.risk_assessment.unknowns.includes('funding_clusters_not_verified'));assert.ok(r.decision.risk_assessment.unknowns.includes('unique_buyers_5m'));assert.equal(r.decision.order_sol,.1);assert.equal(c.status().externalModelCalls,0);assert.equal(c.status().funnel.days[new Date(now).toISOString().slice(0,10)].quote,1);
 c.policy.killSwitch=true;assert.equal((await c.decide('kade',ctx)).decision.action,'HOLD');assert.equal(calls,1);assert.ok(c.reports.some(r=>r.executionBlock==='MANUAL_KILL_SWITCH'));
});
test('provider receives only public mint/pool, explicit percent units and strips unknown sensitive keys',async()=>{
 let covered=true;const e=new RulesEvidence({url:'https://fixture.invalid',clock:()=>now,fetcher:async u=>{assert.deepEqual([...u.searchParams.keys()],['mint','pool']);return new Response(JSON.stringify({mint:'mint',pool:'pool',checkedAt:now,coverage:{top10ExcludesLpAndCurve:covered,percentUnitsVerified:true},inputs:{...input(),top10_pct:.48,PRIVATE_KEY:'secret-marker',ownerAddress:'secret-marker'}}));}}),c={mint:'mint',pool:'pool',solUsd:100,rawMarket:{dexId:'pumpswap',updatedAt:now,priceUsd:100,volume5mUsd:50,liquidityQuoteSol:6.76,buys5m:5,sells5m:3,change5mPct:5}};
 const r=await e.read(c);assert.equal(r.inputs.top10_pct,.48);assert.ok(!JSON.stringify(r).includes('secret-marker'));covered=false;assert.equal((await e.read(c)).error,'RULES_EVIDENCE_UNVERIFIED');
});
test('old exit policy retains hard stop/confirmed half TP/trailing and ninety minute band',()=>{
 const p={entryPriceSol:1,openedAt:0},m={};assert.equal(exitV5(p,.8,1000,m).reason,'stop-loss');assert.equal(exitV5(p,.9,1000,m).reason,'stop-loss');const tp={};assert.equal(exitV5(p,2,1000,tp).fraction,.5);assert.equal(exitV5(p,1.6,1000,tp).fraction,.5);tp.tpConfirmed=true;assert.equal(exitV5(p,1.7,1000,tp).reason,'rules-trailing-15');assert.equal(exitV5(p,1.05,5400000,{}).reason,'rules-time-exit');
});
test('quote size fallback is bound into the final intent and expiry starts after the read completes',async()=>{
 let clock=now;const c=new RulesClient({clock:()=>clock,quoteSelector:async(_c,plan)=>{clock+=7000;return {ok:true,size:Math.floor(plan.size*.5*1e9)/1e9,quote:{roundTripLossPct:3},attempts:[{reason:null}]};}}),ctx={snapshotId:'ladder',wallet:{running:true},limits:{maxBatchOrders:5},rulesAccount:{wallet_balance_sol:2,account_equity_sol:2,available_capital_sol:1.945,sol_price_usd:150,open_positions_count:0},candidates:[{mint:'mint',pool:'pool',rulesEvidence:{checkedAt:now,inputs:input(),observations:{}}}]};
 const r=await c.decide('kade',ctx);assert.equal(r.decision.action,'BUY');assert.equal(r.decision.order_sol,.048625);const grant=c.grants.get(r.riskEvidenceByMint.mint.rulesGrant);assert.equal(grant.amount,'48625000');assert.ok(grant.expiresAt>clock+10000);
});
