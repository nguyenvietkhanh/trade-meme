import test from 'node:test';import assert from 'node:assert/strict';import {preFilter,signalTier,signalScore} from '../src/rules-signal.js';import {rulesConfig} from '../src/rules-config.js';
const p=rulesConfig({}),base={top10_pct:10,dev_wallet_pct:2,holder_count:100,quote_reserve_sol:6.76,volume_5m_sol:.5,buys_5m:5,sells_5m:3,change_5m_pct:4.41};
test('dead sample reserve 4e-9, null/zero volume and fewer than three trades are rejected cheaply',()=>{for(const update of [{quote_reserve_sol:4e-9},{quote_reserve_sol:null},{volume_5m_sol:0},{volume_5m_sol:null},{buys_5m:1,sells_5m:1}])assert.equal(preFilter({...base,...update},p).ok,false);assert.equal(preFilter(base,p).ok,true);});
test('28vWT 4 buys /3 sells +4.41% qualifies PROBE instead of flapping off, -8% is skipped',()=>{
 const i={...base,buys_5m:4,sells_5m:3},s=signalScore(i,{},p);assert.equal(signalTier(i,s.score,p).tier,'PROBE');assert.equal(signalTier({...i,change_5m_pct:-8},10,p).tier,'SKIP');assert.equal(signalTier(base,10,p).tier,'STANDARD');
});
test('116 buys /7 sells with very small SOL per trade is probe-only even at a high score',()=>{const i={...base,buys_5m:116,sells_5m:7,volume_5m_sol:.5};assert.equal(signalTier(i,10,p).wash,true);assert.equal(signalTier(i,10,p).tier,'PROBE');});
