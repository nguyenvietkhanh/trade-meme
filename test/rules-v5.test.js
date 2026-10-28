import test from 'node:test';import assert from 'node:assert/strict';
import {evaluateV5,sizingV5,RulesInputError,exitV5} from '../src/rules-v5.js';
import {RulesClient} from '../src/rules-client.js';
import {RulesEvidence} from '../src/rules-evidence.js';
export const input=()=>({token:'fixture-mint',account_equity_sol:3.33,available_capital_sol:3,priority_fee_sol:.000025,protocol_fee_pct:1,expected_slippage_pct:1,sol_price_usd:150,top10_pct:10,dev_wallet_pct:2,dev_sell_history:[],token_age_minutes:60,current_utc_hour:12,global_pumpfun_volume_24h_percentile:60,block0_buyer_count:0,bundle_clusters:[],graduation_dump_model:20,open_positions_count:0,open_positions_detail:[],curve_progress_pct:40,holder_growth_rate:2,buy_sell_ratio:1.4,narrative_heat:8,funding_source_trace:{status:'clean'},socials:{presence:true,account_age_days:[60,60]}});
const observed={curveMonotonic:true,volume5mStable:true,liquidityHealthy:true,newAthWithin120m:true,volume1hDeclining:false};
test('AUTO sizing selects a signal fraction up to 50% and never consumes gas or unavailable funds',()=>{
 const a=sizingV5(input(),observed);assert.equal(a.mode,'AUTO');assert.equal(a.size,1.1655);assert.equal(a.maxPositions,5);assert.ok(a.friction<4.01);
 const b=sizingV5({...input(),account_equity_sol:.5,wallet_balance_sol:.5,available_capital_sol:.445},observed);assert.equal(b.mode,'AUTO');assert.equal(b.size,.175);assert.equal(b.maxOrder,.25);assert.equal(b.cap,8);
 for(const update of [{account_equity_sol:.05,wallet_balance_sol:.05},{available_capital_sol:0},{priority_fee_sol:.1}]){const c=sizingV5({...input(),...update},observed);assert.equal(c.mode,'INFEASIBLE');assert.equal(c.size,0);assert.equal(c.maxPositions,0);assert.equal(c.frictionSol,0);}
});
test('full-research scoring retains evidence penalties, automatic size never requires acknowledgment',()=>{
 const a=evaluateV5(input(),observed);assert.equal(a.score,8.5);assert.equal(a.verdict,'VALID_SETUP');assert.equal(Object.keys(a).length,17);
 const b=evaluateV5({...input(),account_equity_sol:.5,wallet_balance_sol:.5,available_capital_sol:.445},observed);assert.equal(b.score,8.5);assert.equal(b.verdict,'VALID_SETUP');assert.equal(b.requires_user_acknowledgment,false);assert.deepEqual(b.size_warnings,[]);
 const example=evaluateV5({...input(),account_equity_sol:.5,priority_fee_sol:.0005,expected_slippage_pct:3},observed);assert.equal(example.score,6.5);assert.equal(example.verdict,'SKIP');assert.equal(example.rule_check.R9,'fail');
});
test('holder/dev/bundle and capacity protection remain, hours and percentile no longer gate BUY',()=>{
 for(const update of [{top10_pct:25.1},{dev_wallet_pct:5.1},{dev_sell_history:[{age_minutes:2}]},{block0_buyer_count:4},{bundle_clusters:[{wallet_count:3}]},{open_positions_count:5}])assert.equal(evaluateV5({...input(),...update},observed).verdict,'SKIP');
 for(let h=0;h<24;h++)assert.equal(evaluateV5({...input(),current_utc_hour:h},observed).rule_check.R6,'pass');
 assert.equal(evaluateV5({...input(),token_age_minutes:361},{...observed,newAthWithin120m:false}).rule_check.R4,'fail');assert.equal(evaluateV5({...input(),token_age_minutes:361},observed).rule_check.R4,'pass');
 assert.throws(()=>evaluateV5({...input(),top10_pct:null},observed),RulesInputError);
 assert.throws(()=>evaluateV5({...input(),dev_sell_history:[{}]},observed),RulesInputError);
 assert.equal(evaluateV5(input(),{...observed,curveMonotonic:false}).verdict,'VALID_SETUP');
 assert.equal(evaluateV5({...input(),global_pumpfun_volume_24h_percentile:null,open_positions_detail:[{current_value_sol:.1}]},observed).verdict,'VALID_SETUP');
});
test('F3 floors size, never silently oversizes available funds; missing scoring facts get no bonus',()=>{
 const s=sizingV5({...input(),available_capital_sol:.0123456789});assert.equal(s.size,.012345678);
 const a=evaluateV5({...input(),funding_source_trace:null,narrative_heat:null},observed);assert.equal(a.score,7.5);assert.equal(a.verdict,'VALID_SETUP');assert.equal(a.rule_check.R8,'pass');
});
test('fixed exit policy: hard stop, half at 2x, trailing only after confirmed TP, 90-minute band',()=>{
 const p={entryPriceSol:1,openedAt:0},m={};assert.equal(exitV5(p,.8,1000,m).reason,'stop-loss');assert.equal(exitV5(p,.9,1000,m).reason,'stop-loss');const tp={};assert.equal(exitV5(p,2,1000,tp).fraction,.5);assert.equal(exitV5(p,1.6,1000,tp).fraction,.5);tp.tpConfirmed=true;assert.equal(exitV5(p,1.7,1000,tp).reason,'rules-trailing-15');
 assert.equal(exitV5(p,1.05,90*60000,{}).reason,'rules-time-exit');assert.equal(exitV5(p,1.2,90*60000,{}),null);assert.equal(exitV5(p,.94,90*60000,{}),null);
});
function context(now,equity=3.33){return {snapshotId:'fixed',wallet:{running:true},limits:{maxBatchOrders:5},candidates:[{mint:'fixture-mint',pool:'pool',rulesEvidence:{checkedAt:now,inputs:input(),observations:observed}}],rulesAccount:{account_equity_sol:equity,available_capital_sol:equity-.055,open_positions_count:0,open_positions_detail:[],current_utc_hour:12,sol_price_usd:150}};}
test('small wallet buys automatically without any confirmation or approval map',async()=>{
 let now=1900000000000;const c=new RulesClient({clock:()=>now});assert.equal((await c.verify()).externalModelCalls,0);
 for(const equity of [.5,3.33]){const ctx=context(now,equity),reply=await c.decide('kade',ctx);assert.equal(reply.decision.action,'BUY');assert.equal(reply.decision.stop_loss_pct,20);assert.equal(c.reports[0].awaitingAcknowledgment,false);assert.equal(c.reports[0].result.requires_user_acknowledgment,false);assert.ok(reply.decision.order_sol<=equity*.5);assert.ok(reply.riskEvidenceByMint['fixture-mint'].rulesGrant);}
 assert.equal(c.approvals,undefined);assert.deepEqual(c.acknowledge('old-ui'),{automatic:true,acknowledgmentRequired:false});now+=31000;assert.equal((await c.decide('kade',context(now,.5))).decision.action,'BUY');
});
test('missing or stale data cannot generate permission and are explicitly reported',async()=>{
 const now=1900000000000,c=new RulesClient({clock:()=>now}),ctx=context(now);ctx.candidates[0].rulesEvidence=null;assert.equal((await c.decide('kade',ctx)).decision.action,'HOLD');assert.equal(c.reports[0].code,'RULES_EVIDENCE_UNAVAILABLE');
 ctx.candidates[0].rulesEvidence={checkedAt:now-5001,inputs:input(),observations:observed};assert.equal((await c.decide('kade',ctx)).decision.action,'HOLD');
 const e=new RulesEvidence({url:undefined});assert.equal((await e.read({mint:'mint',pool:'pool'})).error,'RULES_EVIDENCE_NOT_CONFIGURED');
});
test('research adapter only sends public mint/pool, enforces coverage/freshness and strips secret/address fields',async()=>{
 const now=1900000000000,coverage={top10ExcludesLpAndCurve:true,devHistoryFromLaunch:true,block0Complete:true,bundlesComplete:true,volumePercentileAsOfVerified:true};let complete=true;
 const e=new RulesEvidence({url:'https://research-fixture.invalid/evidence',clock:()=>now,fetcher:async url=>{assert.equal(url.searchParams.get('mint'),'mint');assert.equal(url.searchParams.get('pool'),'pool');assert.equal([...url.searchParams.keys()].length,2);return new Response(JSON.stringify({mint:'mint',pool:'pool',checkedAt:now,source:'fixture',coverage:{...coverage,block0Complete:complete},inputs:{...input(),PRIVATE_KEY:'must-not-leak',ownerAddress:'must-not-leak',funding_source_trace:{status:'clean',address:'must-not-leak'}},observations:{...observed,signer:'must-not-leak'}}));}});
 const row=await e.read({mint:'mint',pool:'pool'});assert.equal(row.inputs.top10_pct,10);assert.ok(!JSON.stringify(row).includes('must-not-leak'));complete=false;e.cache.clear();assert.equal((await e.read({mint:'mint',pool:'pool'})).error,'RULES_EVIDENCE_UNVERIFIED');
});
