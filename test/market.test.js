import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadMarkets} from '../src/market.js';
import {SOL} from '../src/engine.js';
import {Keypair} from '@solana/web3.js';
const pair=(mint,symbol,liquidity,chainId='solana')=>({chainId,dexId:'pumpswap',baseToken:{address:mint,symbol,name:symbol},priceUsd:'1',marketCap:1000000,liquidity:{usd:liquidity},volume:{h24:200000},priceChange:{m5:2},txns:{m5:{buys:20,sells:5}},pairAddress:'pair-'+liquidity,pairCreatedAt:Date.now()-86400000});
test('discovery never invokes a pre-migration feed; only PumpSwap and tracked legacy pools remain',async t=>{
 const mint=Keypair.generate().publicKey.toBase58();let dexId='pumpfun',calls=0;
 const disabled={cachedMarkets:()=>{calls++;throw Error('disabled source must never run');}};
 t.mock.method(globalThis,'fetch',async url=>new Response(JSON.stringify({pairs:String(url).endsWith(SOL)?[{...pair(SOL,'SOL',999999),priceUsd:'100'}]:[{...pair(mint,'CURVE',0),dexId}]})));
 const feed=await loadMarkets([],{},null,disabled);assert.equal(feed.markets.length,0);assert.equal(calls,0);assert.equal(feed.sources.preMigrationEnabled,false);
 dexId='pumpswap';const swap=await loadMarkets([],{},null,disabled);assert.equal(swap.markets[0].dexId,'pumpswap');assert.equal(calls,0);
 dexId='pumpfun';const held=await loadMarkets([mint],{[mint]:'pair-0'},null,disabled);assert.equal(held.markets[0].pairAddress,'pair-0');assert.equal(held.markets[0].dexId,'pumpfun');assert.equal(calls,0);
});
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
test('held positions retain their original pool even when another pool advertises more liquidity',async t=>{
 t.mock.method(globalThis,'fetch',async url=>new Response(JSON.stringify({pairs:String(url).endsWith(SOL)?[{...pair(SOL,'SOL',999999),priceUsd:'150'}]:[pair('held','MEME',2000),pair('held','MEME',999999)]}),{status:200}));
 const feed=await loadMarkets(['held'],{held:'pair-2000'});assert.equal(feed.markets[0].pairAddress,'pair-2000');assert.equal(feed.markets[0].liquidityUsd,2000);
});
test('new PumpSwap pools join discovery independently of token profile publication',async t=>{
 const mint='11111111111111111111111111111115';
 t.mock.method(globalThis,'fetch',async url=>{
  const u=String(url);let data;
  if(u.includes('geckoterminal.com'))data={data:[{relationships:{dex:{data:{id:'pumpswap'}},base_token:{data:{id:'solana_'+mint}}}}]};
  else if(u.endsWith('/token-profiles/latest/v1'))data=[];
  else data={pairs:u.endsWith(SOL)?[{...pair(SOL,'SOL',999999),priceUsd:'150'}]:u.includes('/tokens/')?[pair(mint,'NEW',200000)]:[]};
  return new Response(JSON.stringify(data));
 });
 const f=await loadMarkets();assert.equal(f.sources.newPumpSwapPools,1);assert.ok(f.markets.some(m=>m.mint===mint));
});
test('zero-like cap strings cannot disguise an FDV fallback as an actual market cap',async t=>{
 t.mock.method(globalThis,'fetch',async url=>new Response(JSON.stringify({pairs:String(url).endsWith(SOL)?[{...pair(SOL,'SOL',999999),priceUsd:'150'}]:[{...pair('ordinary-mint','SMALL',200000),marketCap:'0',fdv:123456},{...pair('samplepump','SMALL2',200000),marketCap:null,fdv:234567}]})));
 const f=await loadMarkets();assert.equal(f.markets.find(m=>m.mint==='ordinary-mint').valuationSource,'fdv');assert.equal(f.markets.find(m=>m.mint==='samplepump').valuationSource,'pump-fdv');
});
test('paper gainer shortlist includes low-liquidity +54% token outside the old first 60, retaining held pools',async t=>{
 const {rankPaperMarket}=await import('../src/paper-policy.js'),{compare5m}=await import('../src/paper-scalp.js');
 const list=Array.from({length:65},(_,i)=>({...pair('slow-'+i,'MEME'+i,200000+i),liquidity:{usd:200000+i,quote:100},marketCap:1000000,volume:{h24:100000,h1:10000,m5:1000},priceChange:{m5:3,h1:10},txns:{m5:{buys:20,sells:10},h1:{buys:100,sells:50}}}));
 list.push({...pair('gainer','FAST',10000),marketCap:30000,volume:{h24:100000,h1:10000,m5:1000},priceChange:{m5:54,h1:-20},txns:{m5:{buys:20,sells:10},h1:{buys:100,sells:50}}});
 t.mock.method(globalThis,'fetch',async url=>new Response(JSON.stringify({pairs:String(url).endsWith(SOL)?[{...pair(SOL,'SOL',999999),priceUsd:'150'}]:list})));
 const baseline=await loadMarkets();assert.equal(baseline.markets.some(m=>m.mint==='gainer'),false);
 const scalp=await loadMarkets(['slow-9'],{'slow-9':'pair-200009'},null,{rankMarket:rankPaperMarket,compare:compare5m});assert.equal(scalp.markets[0].mint,'gainer');assert.ok(scalp.markets.some(m=>m.mint==='slow-9'));assert.equal(scalp.markets.length,61);
});
