import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankMarket} from '../src/strategy.js';
import {DEFAULTS,freshState,tick} from '../src/engine.js';
const now=Date.UTC(2026,9,17,12);
const m={mint:'mint',symbol:'TEST',valuationUsd:1000000,valuationSource:'marketCap',dexId:'pumpswap',hasProfile:true,signalConfirmed:true,volume5mUsd:10000,volume1hUsd:30000,change1hPct:10,change6hPct:20,change24hPct:30,priceUsd:.01,updatedAt:now,liquidityUsd:200000,volume24hUsd:1000000,change5mPct:3,buys5m:40,sells5m:5,pairCreatedAt:now-86400000};
test('score is transparent and all conditions are required for an automatic entry',()=>{
 const rank=rankMarket(m,DEFAULTS,now);assert.equal(rank.score,100);assert.equal(rank.eligible,true);assert.deepEqual(rank.reasons,[]);
 for(const override of [{valuationUsd:100000000},{valuationUsd:0},{liquidityUsd:24999},{volume24hUsd:49999},{change5mPct:30},{buys5m:9},{sells5m:100},{pairCreatedAt:0},{pairCreatedAt:now-1000},{updatedAt:now-90001}]){
  const rank=rankMarket({...m,...override},DEFAULTS,now);assert.equal(rank.eligible,false);assert.ok(rank.reasons.length);
 }
});
test('autonomous loop buys eligible token, logs rejection reason, and avoids duplicate positions',()=>{
 const s=freshState(now);s.running=true;
 const markets=[m,{...m,mint:'bad',symbol:'BAD',change5mPct:50}];
 tick(s,markets,150,now);assert.equal(s.positions.length,1);assert.equal(s.positions[0].mint,'mint');
 assert.equal(s.decisionStats.bought,1);assert.equal(s.decisionStats.rejected,1);assert.equal(s.decisionStats.evaluated,2);
 assert.ok(s.decisions.some(d=>d.mint==='bad'&&d.action==='SKIP'&&d.reason.includes('5m')));
 tick(s,markets,150,now+1);assert.equal(s.positions.length,1);assert.equal(s.decisionStats.bought,1);
});
test('paused engine records marks but never chooses new entries',()=>{
 const s=freshState(now);tick(s,[m],150,now);assert.equal(s.positions.length,0);assert.equal(s.decisions.length,0);assert.equal(s.curve.length,1);
});
