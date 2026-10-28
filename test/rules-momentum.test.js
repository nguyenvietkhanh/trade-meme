import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateV5} from '../src/rules-v5.js';
import {RulesEvidence} from '../src/rules-evidence.js';
import {RulesClient} from '../src/rules-client.js';
const now=Date.parse('2026-10-29T23:00:00Z');
const account={account_equity_sol:.5,wallet_balance_sol:.5,available_capital_sol:.445,open_positions_count:0,open_positions_detail:[],current_utc_hour:23,sol_price_usd:150};
const market=()=>({mint:'fixture',pairAddress:'pool',dexId:'pumpswap',priceAt:now,updatedAt:now,marketObservedAt:now,pairCreatedAt:now-60*60000,volume5mUsd:500,buys5m:20,sells5m:10,change5mPct:15});
function fixture(){let scans=0,quotes=0;const facts={top10ExcludesPool:true,top10Pct:12,devPct:2,holderCount:100,quoteReserveSol:20},execution={inspectMarketFacts:async()=>{scans++;return {...facts};},roundTripQuote:async(_mint,amount)=>{quotes++;return {roundTripQuoteOk:true,probeSol:Number(amount)/1e9,roundTripLossPct:3,buyImpactPct:.5,sellImpactPct:.5,quoteCheckedAt:now};}};return {e:new RulesEvidence({url:'',clock:()=>now,execution}),facts,execution,counts:()=>({scans,quotes})};}
const request=(m=market())=>({mint:m.mint,pool:m.pairAddress,rawMarket:m,account,solUsd:150});
test('RPC + observed flow + a real size-matched quote can buy at 23 UTC without invented research',async()=>{
 const f=fixture(),bundle=await f.e.read(request());assert.equal(bundle.error,undefined);assert.equal(bundle.inputs.dev_sell_history,undefined);assert.equal(bundle.inputs.bundle_clusters,undefined);assert.equal(bundle.inputs.global_pumpfun_volume_24h_percentile,undefined);assert.ok(bundle.researchUnknowns.length);
 const out=evaluateV5({...bundle.inputs,...account,token:'fixture'},bundle.observations);assert.equal(out.verdict,'VALID_SETUP');assert.equal(out.score,10);assert.equal(out.rule_check.R6,'pass');assert.equal(out.friction_detail.entry_protocol_fee_pct,null);assert.equal(out.dump_model.top5_exit_drop_pct,null);
 const c=new RulesClient({clock:()=>now}),reply=await c.decide('kade',{wallet:{running:true},limits:{maxBatchOrders:5},rulesAccount:account,candidates:[{mint:'fixture',pool:'pool',rulesEvidence:bundle}]});assert.equal(reply.decision.action,'BUY');assert.equal(reply.decision.order_sol,.25);assert.equal(c.reports[0].awaitingAcknowledgment,false);assert.equal(reply.decision.stop_loss_pct,20);assert.ok(c.reports[0].researchUnknowns.length);assert.deepEqual(f.counts(),{scans:1,quotes:1});
});
test('known unsafe holder/dev, observed sells/bundles and exhausted momentum remain blocked',async()=>{
 for(const change of [{change5mPct:-1},{change5mPct:101},{buys5m:1},{sells5m:30},{volume5mUsd:1},{creatorSoldRecently:true},{suspectedBundle:true},{priceAt:now-5001}]){const f=fixture(),b=await f.e.read(request({...market(),...change}));assert.ok(b.error,JSON.stringify(change));assert.equal(f.counts().quotes,0);}
 for(const change of [{top10Pct:26},{devPct:6},{top10ExcludesPool:false},{devPct:undefined},{quoteReserveSol:4},{holderCount:19}]){const f=fixture();Object.assign(f.facts,change);assert.ok((await f.e.read(request())).error,JSON.stringify(change));assert.equal(f.counts().quotes,0);}
});
test('failed, stale or mismatched quotes do not grant a BUY and no orders are submitted',async()=>{
 for(const change of [{probeSol:1},{roundTripLossPct:7},{buyImpactPct:3},{quoteCheckedAt:now-5001},{roundTripQuoteOk:false}]){const f=fixture(),original=f.execution.roundTripQuote;f.execution.roundTripQuote=async(...args)=>({...await original(...args),...change});assert.equal((await f.e.read(request())).error,'RULES_QUOTE_UNAVAILABLE');}
});
test('core momentum inputs are independently required at evaluation, not trusted via a pass flag',async()=>{
 const f=fixture(),b=await f.e.read(request()),i={...b.inputs,...account,token:'fixture'};
 for(const update of [{change_5m_pct:101},{quote_reserve_sol:0},{buys_5m:0},{top10_pct:26},{dev_wallet_pct:6},{open_positions_count:5},{round_trip_quote_loss_pct:7}])assert.equal(evaluateV5({...i,...update},b.observations).verdict,'SKIP');
 assert.equal(evaluateV5(i,{...b.observations,creatorSoldRecently:true}).verdict,'SKIP');assert.equal(evaluateV5(i,{...b.observations,suspectedBundle:true}).verdict,'SKIP');assert.throws(()=>evaluateV5({...i,round_trip_quote_loss_pct:-1},b.observations));
});
