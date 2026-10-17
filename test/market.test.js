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
test('new Solana profile discovery finds tokens outside the fixed search terms',async t=>{
 const mint='11111111111111111111111111111112';
 const requested=[];
 t.mock.method(globalThis,'fetch',async url=>{
  requested.push(String(url));
  const value=String(url).endsWith('/token-profiles/latest/v1')?[{chainId:'solana',tokenAddress:mint},{chainId:'ethereum',tokenAddress:'0x123'},{chainId:'solana',tokenAddress:'invalid'}]:{pairs:String(url).endsWith(SOL)?[{...pair(SOL,'SOL',999999),priceUsd:'150'}]:String(url).includes('/tokens/')?[pair(mint,'NEW',250000)]:[]};
  return new Response(JSON.stringify(value),{status:200});
 });
 const feed=await loadMarkets();assert.equal(feed.markets.length,1);assert.equal(feed.markets[0].mint,mint);assert.equal(feed.sources.newSolanaProfiles,1);assert.ok(requested.some(u=>u.endsWith('/tokens/'+mint)));
});
test('optional profile outage does not block existing market data',async t=>{
 t.mock.method(globalThis,'fetch',async url=>String(url).endsWith('/token-profiles/latest/v1')?new Response('unavailable',{status:503}):new Response(JSON.stringify({pairs:String(url).endsWith(SOL)?[{...pair(SOL,'SOL',999999),priceUsd:'150'}]:[pair('existing','MEME',200000)]}),{status:200}));
 const feed=await loadMarkets();assert.equal(feed.markets.length,1);assert.equal(feed.sources.newSolanaProfiles,0);assert.ok(feed.warnings.length);
});
test('combined discovered and watched tokens respect the provider 30-address limit',async t=>{
 const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
 const profiles=Array.from({length:30},(_,i)=>'1'.repeat(31)+alphabet[i]);
 const holdings=Array.from({length:21},(_,i)=>'2'.repeat(31)+alphabet[i]);
 const requests=[];
 t.mock.method(globalThis,'fetch',async url=>{
  const text=String(url);
  if(text.endsWith('/token-profiles/latest/v1'))return new Response(JSON.stringify(profiles.map(tokenAddress=>({chainId:'solana',tokenAddress}))),{status:200});
  if(text.includes('/tokens/')&&!text.endsWith(SOL)){
   const tokens=text.split('/').at(-1).split(',');requests.push(tokens);return new Response(JSON.stringify({pairs:tokens.map(m=>pair(m,'MEME',200000))}),{status:200});
  }
  return new Response(JSON.stringify({pairs:text.endsWith(SOL)?[{...pair(SOL,'SOL',999999),priceUsd:'150'}]:[]}),{status:200});
 });
 const feed=await loadMarkets(holdings);assert.equal(requests.length,2);assert.ok(requests.every(b=>b.length<=30));assert.ok(holdings.every(m=>feed.markets.some(p=>p.mint===m)));
});
