import test from 'node:test';
import assert from 'node:assert/strict';
import {planRulesOrder} from '../src/rules-allocation.js';
import {evaluateV5} from '../src/rules-v5.js';
import {RulesClient} from '../src/rules-client.js';
const obs={evidenceProfile:'onchain-momentum'};
const base={account_equity_sol:.5,wallet_balance_sol:.5,available_capital_sol:.445,sol_price_usd:150,current_utc_hour:1,open_positions_count:0,open_positions_detail:[],top10_pct:10,dev_wallet_pct:2,token_age_minutes:60,holder_count:100,quote_reserve_sol:20,change_5m_pct:15,buys_5m:20,sells_5m:10,volume_5m_sol:3,round_trip_quote_loss_pct:3,priority_fee_sol:.000025,quote_probe_sol:.25};
test('0.5 SOL wallet can autonomously buy 0.25 SOL at maximum grade, not a forced full allocation',()=>{
 const p=planRulesOrder(base,obs);assert.equal(p.size,.25);assert.equal(p.fraction,.5);const r=evaluateV5(base,obs);assert.equal(r.verdict,'VALID_SETUP');assert.equal(r.R1_detail.proposed_size_sol,.25);assert.equal(r.requires_user_acknowledgment,false);
 const weaker={...base,top10_pct:20,dev_wallet_pct:4,quote_reserve_sol:5,volume_5m_sol:1};const w=planRulesOrder(weaker,obs);assert.ok(w.size>0&&w.size<.25);assert.equal(w.fraction,.1);
 assert.equal(planRulesOrder({...base,quote_reserve_sol:5},obs).size,.1,'2% real reserve clips an otherwise larger order');
});
test('allocation respects wallet cash rather than portfolio equity, reserves and available capital',()=>{
 for(const cash of [0,.05,.055,.06,.1,.5,1,10])for(const equity of [cash,cash+10])for(const available of [0,.001,.01,.1,100]){
  const r=planRulesOrder({...base,account_equity_sol:equity,wallet_balance_sol:cash,available_capital_sol:available},obs);
  assert.ok(r.size<=cash*.5+1e-10);assert.ok(r.size<=available+1e-10);assert.ok(r.size<=Math.max(0,cash-.055)+1e-10);assert.ok(r.size<=.4+1e-10);
 }
 const original=planRulesOrder(base,obs).size;assert.equal(planRulesOrder({...base,available_capital_sol:.08},obs).size,.08);assert.ok(original>.08);
});
test('multiple automatic BUY grants share available capital and cannot reuse a quote for a clipped size',async()=>{
 const now=Date.now(),c=new RulesClient({clock:()=>now}),ctx={snapshotId:'auto-batch',wallet:{running:true},limits:{maxBatchOrders:5},rulesAccount:Object.fromEntries(['account_equity_sol','wallet_balance_sol','available_capital_sol','sol_price_usd','current_utc_hour','open_positions_count','open_positions_detail'].map(k=>[k,base[k]])),candidates:[0,1,2].map(n=>({mint:'mint'+n,pool:'pool'+n,rulesEvidence:{checkedAt:now,inputs:base,observations:obs}}))};
 const out=await c.decide('kade',ctx),buys=out.decisions.filter(d=>d.action==='BUY');assert.equal(buys.length,1);assert.equal(buys[0].order_sol,.25);assert.ok(buys.reduce((n,d)=>n+d.order_sol+.005,0)<=.445);assert.ok(c.reports.every(r=>!r.awaitingAcknowledgment));assert.equal(c.reports[1].result.rule_check.R9,'fail');
 // Two lower-size signals have their own exact quotes and can run concurrently.
 const weak={...base,quote_reserve_sol:5};const size=planRulesOrder(weak,obs).size;
 ctx.candidates=ctx.candidates.slice(0,2).map(c=>({...c,rulesEvidence:{checkedAt:now,inputs:{...weak,quote_probe_sol:size},observations:obs}}));const batch=await c.decide('kade',ctx);assert.equal(batch.decisions.filter(d=>d.action==='BUY').length,2);assert.ok(batch.decisions.reduce((n,d)=>n+(d.order_sol??0)+.005,0)<=.445);ctx.rulesAccount.open_positions_count=4;const oneSlot=await c.decide('kade',ctx);assert.equal(oneSlot.decisions.filter(d=>d.action==='BUY').length,1);
});
