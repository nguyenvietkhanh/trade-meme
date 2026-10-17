import {test} from 'node:test';
import assert from 'node:assert/strict';
import {observeMarkets} from '../src/signals.js';
import {rankMarket} from '../src/strategy.js';
import {freshState} from '../src/engine.js';
const now=Date.UTC(2026,9,17,12);
const market={mint:'test',pairAddress:'pool',priceUsd:1,liquidityUsd:100000,change5mPct:3,buys5m:40,sells5m:5};
test('requires separated observations, rejects abrupt liquidity removal and does not create earlier confirmation',()=>{
 const s=freshState(now);assert.equal(observeMarkets(s,[market],now)[0].signalConfirmed,false);
 assert.equal(observeMarkets(s,[market],now+1000)[0].signalConfirmed,false);
 assert.equal(observeMarkets(s,[market],now+30000)[0].signalConfirmed,true);
 assert.equal(observeMarkets(s,[{...market,liquidityUsd:50000}],now+60000)[0].signalConfirmed,false);
 assert.equal(observeMarkets(s,[{...market,pairAddress:'new-pool'}],now+90000)[0].signalConfirmed,false);
});
test('PumpSwap, ten-hour age, profile, acceleration and timeframe guards are mandatory; boosts do not add score',()=>{
 const s=freshState(now).settings,m={...market,updatedAt:now,pairCreatedAt:now-86400000,dexId:'pumpswap',hasProfile:true,signalConfirmed:true,volume24hUsd:200000,volume5mUsd:10000,volume1hUsd:30000,valuationUsd:1000000,valuationSource:'marketCap',change1hPct:10,change6hPct:20,change24hPct:30};
 assert.equal(rankMarket(m,s,now).eligible,true);
 for(const override of [{dexId:'raydium'},{hasProfile:false},{pairCreatedAt:now-9*3600000},{volume5mUsd:10},{change1hPct:-1},{change6hPct:-40},{change24hPct:600},{signalConfirmed:false}])assert.equal(rankMarket({...m,...override},s,now).eligible,false);
 assert.equal(rankMarket({...m,boosted:true},s,now).score,rankMarket({...m,boosted:false},s,now).score);
 const weaker=rankMarket({...m,volume5mUsd:2000,volume1hUsd:18000,buys5m:20,sells5m:10},s,now);assert.ok(weaker.score<rankMarket(m,s,now).score);
});
