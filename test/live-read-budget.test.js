import test from 'node:test';import assert from 'node:assert/strict';
import {LiveReadPlan} from '../src/live-read-plan.js';
import {MarketData} from '../src/paper-market-data.js';
import {ProviderBudget} from '../src/paper-provider-budget.js';
import {PaperPoolReader} from '../src/paper-amm-model.js';
test('owned positions remain in every fast plan, unowned candidates rotate twelve per ten seconds',()=>{
 const plan=new LiveReadPlan(),rows=Array.from({length:60},(_,i)=>({mint:'mint'+i,pairAddress:'pool'+i,change5mPct:10})),snapshot={markets:rows},positions=[{...rows[0]}];let fast=0,watch=0;const seen=new Set();
 for(let now=0;now<60000;now+=1000){const p=plan.plan(snapshot,positions,now);fast+=p.held.length;watch+=p.watch.length;for(const m of p.watch)seen.add(m.mint);assert.equal(p.held[0].mint,'mint0');assert.ok(p.watch.every(m=>m.mint!=='mint0'));}
 assert.equal(fast,60);assert.equal(watch,72);assert.equal(seen.size,59);
});
test('heavy pool metadata, failed attempts and rotating provider keys have finite cache limits',async()=>{
 const pools=new PaperPoolReader({}, {clock:()=>100000});for(let i=0;i<4000;i++){pools.cache.set('pool'+i,{at:i});pools.attempts.set('pool'+i,100000);}pools.prune();assert.equal(pools.cache.size,128);assert.ok(pools.cache.has('pool3999'));assert.equal(pools.attempts.size,512);
 const budget=new ProviderBudget({clock:()=>100000});for(let i=0;i<3000;i++)await budget.read('rotating:'+i,async()=>({price:i}));assert.equal(budget.cache.size,256);assert.equal(budget.inflight.size,0);
});
test('price cache drops departed markets and stale RPC observations do not override a fresh public price',async()=>{
 let now=100000;const market={mint:'held',pairAddress:'pool',updatedAt:now,priceUsd:10};const data=new MarketData({readPoolPrices:async()=>[{mint:'held',pairAddress:'pool',priceAt:now,spotPriceSol:1}]},{clock:()=>now});
 data.setFeed({markets:[market],updatedAt:now,solUsd:100});await data.pricesFor([market]);assert.equal(data.snapshot().markets[0].spotPriceSol,1);
 now+=2000;const stale=data.snapshot().markets[0];assert.equal(stale.spotPriceSol,undefined);assert.equal(stale.priceUsd,10);assert.equal(stale.updatedAt,100000);
 data.setFeed({markets:[],updatedAt:now,solUsd:100});assert.equal(data.prices.size,0);
});
