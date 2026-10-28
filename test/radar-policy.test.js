import test from 'node:test';
import assert from 'node:assert/strict';
import {radarPairAgeEligible,RADAR_MIN_PAIR_AGE_MS} from '../src/radar-policy.js';
import {aiMarketEligible} from '../src/autonomous-policy.js';
test('LIVE radar accepts exactly ten hours and older; unknown, zero and future pool timestamps are excluded',()=>{
 const now=Date.UTC(2026,9,28);for(const pairCreatedAt of [now-RADAR_MIN_PAIR_AGE_MS,now-RADAR_MIN_PAIR_AGE_MS-1])assert.equal(radarPairAgeEligible({pairCreatedAt},now),true);
 for(const pairCreatedAt of [now-RADAR_MIN_PAIR_AGE_MS+1,now,now+1,0,undefined,null,NaN])assert.equal(radarPairAgeEligible({pairCreatedAt},now),false);
});
test('radar age filtering does not alter the existing AI entry eligibility contract',()=>{
 const now=Date.now(),young={pairCreatedAt:now-60000,change5mPct:5};assert.equal(radarPairAgeEligible(young,now),false);assert.equal(aiMarketEligible(young),true);
});
