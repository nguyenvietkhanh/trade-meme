import {test} from 'node:test';
import assert from 'node:assert/strict';
import {candleStructure,fetchStructure} from '../src/candles.js';
const now=Math.floor(Date.now()/60000)*60000;
const rows=Array.from({length:31},(_,i)=>[(now-(31-i)*60000)/1000,80,100,i===10?60:i===20?70:75,85,100]);
test('structure uses completed, contiguous OHLCV bars and actual rising pivot lows',()=>{
 const r=candleStructure(rows,80,now);assert.equal(r.higherLows,true);assert.equal(r.greenCandleConfirmed,true);assert.ok(Math.abs(r.pullback30mPct-20)<1e-8);
 assert.deepEqual(candleStructure(rows.slice(0,10),80,now),{});
 assert.deepEqual(candleStructure(rows.filter((_,i)=>i!==15),80,now),{});
 assert.deepEqual(candleStructure(rows.map((r,i)=>i===15?[...r.slice(0,3),200,...r.slice(4)]:r),80,now),{});
});
test('the candle adapter never scores the quote token as if it were the selected meme token',async()=>{
 const m={mint:'token',pairAddress:'pool',priceUsd:80};const r=await fetchStructure(m,async()=>new Response(JSON.stringify({meta:{base:{address:'wrong'}},data:{attributes:{ohlcv_list:rows}}})));assert.deepEqual(r,{});
});
