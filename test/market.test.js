import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadMarkets} from '../src/market.js';
import {SOL} from '../src/engine.js';
const pair=(mint,symbol,liquidity,chainId='solana')=>({chainId,baseToken:{address:mint,symbol,name:symbol},priceUsd:'1',liquidity:{usd:liquidity},volume:{h24:200000},priceChange:{m5:2},txns:{m5:{buys:20,sells:5}},pairAddress:'pair-'+liquidity,pairCreatedAt:Date.now()-86400000});
test('provider adapter filters chains/native impersonators and selects highest-liquidity pool per mint',async t=>{
 t.mock.method(globalThis,'fetch',async url=>new Response(JSON.stringify({pairs:String(url).endsWith(SOL)?[{...pair(SOL,'SOL',999999),priceUsd:'150'}]:[pair('mint-one','MEME',100000),pair('mint-one','MEME',200000),pair('other-chain','MEME',999999,'ethereum'),pair('fake-sol','SOL',9999999),{...pair('invalid','BROKEN',999999),priceUsd:'Infinity'}]}),{status:200}));
 const feed=await loadMarkets();assert.equal(feed.solUsd,150);assert.equal(feed.markets.length,1);assert.equal(feed.markets[0].mint,'mint-one');assert.equal(feed.markets[0].liquidityUsd,200000);assert.equal(feed.markets[0].buys5m,20);
});
test('provider failure is surfaced instead of generating fallback prices',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('blocked',{status:403}));await assert.rejects(loadMarkets(),/Không truy cập được/);
});
test('open holdings are retained even outside the discovery display limit',async t=>{
 const list=Array.from({length:65},(_,i)=>pair('mint-'+i,'MEME'+i,100000+i));
 t.mock.method(globalThis,'fetch',async url=>new Response(JSON.stringify({pairs:String(url).endsWith(SOL)?[{...pair(SOL,'SOL',999999),priceUsd:'150'}]:list}),{status:200}));
 const feed=await loadMarkets(['mint-0']);assert.ok(feed.markets.find(m=>m.mint==='mint-0'));assert.equal(feed.markets.length,61);
});
