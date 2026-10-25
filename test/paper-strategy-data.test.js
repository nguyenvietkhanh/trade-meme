import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StrategyDataFeed} from '../src/paper-strategy-data.js';
import {tenMarket,TEN_AT} from './fixtures/ten-market.js';
test('strategy data fetches real identity-bound bars and flow independently, caches a closed minute, and does not restamp observations',async()=>{
 let now=TEN_AT,calls=0;const m=tenMarket('orin'),flowMarket={...tenMarket('nova'),labQuoteAgentId:'nova'},feed=new StrategyDataFeed({readStrategyFlow:async x=>({...x.strategyData.flow,checkedAt:now})},{clock:()=>now,selectTargets:()=>[{...m,labQuoteAgentId:'orin'},flowMarket],fetcher:async url=>{calls++;assert.ok(String(url).includes('/ohlcv/minute'));return new Response(JSON.stringify({meta:{base:{address:m.mint}},data:{attributes:{ohlcv_list:m.strategyData.bars}}}));}});
 await feed.enrichCached([m,flowMarket]);assert.equal(feed.jobs.size,2);await Promise.all([...feed.jobs.values()]);const first=feed.applyCached([m,flowMarket]);assert.equal(first[0].strategyData.bars.length,35);assert.equal(first[1].strategyData.flow.checkedAt,TEN_AT);now+=2000;await feed.enrichCached([m,flowMarket]);await Promise.all([...feed.jobs.values()]);assert.equal(calls,1);assert.equal(feed.applyCached([flowMarket])[0].strategyData.flow.checkedAt,TEN_AT);assert.equal(feed.applyCached([m])[0].updatedAt,TEN_AT);assert.equal(feed.status().counts['candles:observed'],1);
});
test('wrong-mint data is never cached as a usable candle or wallet feature',async()=>{
 const m={...tenMarket('orin'),labQuoteAgentId:'orin'},feed=new StrategyDataFeed({}, {clock:()=>TEN_AT,selectTargets:()=>[m],fetcher:async()=>new Response(JSON.stringify({meta:{base:{address:'wrong'}},data:{attributes:{ohlcv_list:m.strategyData.bars}}}))});await feed.enrichCached([m]);await Promise.all([...feed.jobs.values()]);assert.equal(feed.applyCached([m])[0].strategyData.bars,undefined);assert.equal(feed.status().counts['candles:unavailable'],1);
});
test('slow wallet jobs rotate fairly even when candle ordering repeatedly puts the same pool first',async()=>{
 let now=TEN_AT;const calls=[],a={...tenMarket('nova'),needFlow:true},b={...tenMarket('echo'),needFlow:true};
 const feed=new StrategyDataFeed({readStrategyFlow:async m=>{calls.push(m.mint);now+=4000;return {...m.strategyData.flow,checkedAt:now};}},{clock:()=>now,selectTargets:()=>[a,b]});
 for(let i=0;i<4;i++){await feed.enrichCached([a,b],now);await Promise.all([...feed.jobs.values()]);}
 assert.equal(new Set(calls.slice(0,2)).size,2);assert.equal(calls[0],calls[2]);assert.equal(calls[1],calls[3]);assert.equal(feed.status().demand.flow,2);
});
test('candle freshness expires at minute rollover and impossible full-universe demand is disclosed',async()=>{
 let now=TEN_AT;const m={...tenMarket('orin'),needCandles:true},feed=new StrategyDataFeed({},{clock:()=>now,selectTargets:()=>Array.from({length:49},(_,i)=>({...m,mint:m.mint+i})),fetcher:async()=>new Response('{}',{status:429})});
 await feed.enrichCached([m]);await Promise.all([...feed.jobs.values()]);assert.equal(feed.status().demand.candles,49);assert.ok(feed.status().warnings.some(w=>w.includes('49')&&w.includes('30')));
 const c={status:{candles:'observed'},candleMinute:Math.floor(now/60000)*60000};feed.cache.set('cached',c);assert.equal(feed.status().counts['candles:observed'],1);now+=60000;assert.equal(feed.status().counts['candles:stale'],1);
});
test('an OHLCV 429 backs off without fabricated bars, and a delayed closed bar can recover within the minute',async()=>{
 let now=TEN_AT,calls=0;const m={...tenMarket('orin'),labQuoteAgentId:'orin'},feed=new StrategyDataFeed({}, {clock:()=>now,selectTargets:()=>[m],fetcher:async()=>{calls++;return new Response('{}',{status:429,headers:{'retry-after':'60'}});}});await feed.enrichCached([m]);await Promise.all([...feed.jobs.values()]);now+=11000;await feed.enrichCached([m]);await Promise.all([...feed.jobs.values()]);assert.equal(calls,1);assert.equal(feed.applyCached([m])[0].strategyData.bars,undefined);assert.equal(feed.status().provider.status,429);
 let complete=false;now=TEN_AT;const delayed=new StrategyDataFeed({}, {clock:()=>now,selectTargets:()=>[m],fetcher:async()=>new Response(JSON.stringify({meta:{base:{address:m.mint}},data:{attributes:{ohlcv_list:complete?m.strategyData.bars:m.strategyData.bars.slice(0,-1)}}}))});await delayed.enrichCached([m]);await Promise.all([...delayed.jobs.values()]);assert.equal(delayed.status().counts['candles:partial'],1);complete=true;now+=10000;await delayed.enrichCached([m]);await Promise.all([...delayed.jobs.values()]);assert.equal(delayed.status().counts['candles:observed'],1);
});
