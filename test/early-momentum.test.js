import test from 'node:test';
import assert from 'node:assert/strict';
import {earlyMomentumFeatures,selectMomentumCandidates} from '../src/early-momentum.js';
import {SOL} from '../src/engine.js';
import {tenMarket} from './fixtures/ten-market.js';

test('small-cap early expansion gets discovery slots without forcing BUY or excluding other caps',()=>{
 const row=(mint,cap,m5,v5=100,v1=1200,quoteMint=SOL)=>({mint,marketCapUsd:cap,change5mPct:m5,volume5mUsd:v5,volume1hUsd:v1,quoteMint});
 const rows=[row('late',115000,150),row('large',200000,90),row('early',8000,3,500,600,'PUMP'),row('boundary',2000,60),row('unknown',null,40),row('down',8000,-5)];
 assert.deepEqual(selectMomentumCandidates(rows,3).map(m=>m.mint),['early','late','large']);
 assert.equal(selectMomentumCandidates(rows,20).length,5);assert.deepEqual(selectMomentumCandidates(rows,0),[]);
 assert.equal(earlyMomentumFeatures(rows[2]).executionSupport,'verified_route_required');
 assert.equal(earlyMomentumFeatures({}).executionSupport,'unknown');
});
test('rolling volume expansion and participation preserve missing baselines and count semantics',()=>{
 const f=earlyMomentumFeatures({volume5mUsd:500,volume1hUsd:600,buys5m:8,sells5m:2});
 assert.ok(Math.abs(f.volume5mVsPrior55mMean-55)<1e-8);assert.equal(f.buyCountShare5m,.8);assert.equal(f.netBuyCount5m,6);assert.equal(f.prior15mRangePct,null);assert.equal(f.lastM1VolumeVsPrior15Mean,null);
 assert.equal(earlyMomentumFeatures({volume5mUsd:500,volume1hUsd:500}).volume5mVsPrior55mMean,null);
 assert.equal(earlyMomentumFeatures({buys5m:0,sells5m:0}).buyCountShare5m,null);
});
test('closed M1 base excludes the breakout candle and does not relabel stale bars',()=>{
 const now=Date.now(),m=tenMarket('orin',now),f=earlyMomentumFeatures(m,now);
 assert.equal(f.closedM1Count,35);assert.ok(Math.abs(f.lastM1MovePct-3)<1e-8);assert.equal(f.lastM1VolumeVsPrior15Mean,6);assert.ok(Math.abs(f.prior15mRangePct-(101/99.5-1)*100)<1e-8);assert.ok(f.lastCloseVsPrior15mHighPct>0);
 assert.equal(earlyMomentumFeatures(m,now+60000).prior15mRangePct,null);
});
