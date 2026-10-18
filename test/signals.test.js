import {verifiedMarket} from './fixtures/verified-market.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {observeMarkets} from '../src/signals.js';
import {rankMarket} from '../src/strategy.js';
import {freshState} from '../src/engine.js';
const now=Date.UTC(2026,9,17,12);
const market={mint:'test',pairAddress:'pool',priceUsd:1,liquidityUsd:100000,change5mPct:3,change1hPct:10,buys5m:40,sells5m:5};
test('requires separated observations, rejects abrupt liquidity removal and does not create earlier confirmation',()=>{
 const s=freshState(now);assert.equal(observeMarkets(s,[market],now)[0].signalConfirmed,false);
 assert.equal(observeMarkets(s,[market],now+1000)[0].signalConfirmed,false);
 assert.equal(observeMarkets(s,[market],now+10000)[0].signalConfirmed,true);
 assert.equal(observeMarkets(s,[{...market,liquidityUsd:50000}],now+20000)[0].signalConfirmed,false);
 assert.equal(observeMarkets(s,[{...market,pairAddress:'new-pool'}],now+30000)[0].signalConfirmed,false);
});
test('strict age range, momentum and evidence remain mandatory, and paid boosts reduce score',()=>{
 const s=freshState(now).settings,m=verifiedMarket({},now);
 assert.equal(rankMarket(m,s,now).eligible,true);
 for(const override of [{dexId:'raydium'},{pairCreatedAt:now-25*3600000},{pairCreatedAt:now-60000},{liquidityQuoteSol:19},{change5mPct:-9},{change1hPct:151},{signalConfirmed:false}])assert.equal(rankMarket({...m,...override},s,now).eligible,false);
 assert.equal(rankMarket({...m,boosted:true},s,now).score,rankMarket({...m,boosted:false},s,now).score-5);
});
