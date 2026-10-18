import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DiscoveryQueue} from '../src/discovery.js';
import {loadMarkets} from '../src/market.js';
import {SOL} from '../src/engine.js';
const mint='11111111111111111111111111111112';
const pair=(address,now,price='1')=>({chainId:'solana',dexId:'pumpswap',baseToken:{address,symbol:address===SOL?'SOL':'TEST',name:'Test'},quoteToken:{address:SOL},priceUsd:price,marketCap:100000,liquidity:{usd:30000,quote:100},volume:{m5:1000,h1:6000,h24:60000},txns:{m5:{buys:20,sells:10},h1:{buys:120,sells:60}},priceChange:{m5:3,h1:20},pairAddress:'pool-'+address,pairCreatedAt:now-1800000});

test('new pools are immediately revisited and old pool identities survive scanner restarts without an age cutoff',()=>{
 const now=Date.now(),q=new DiscoveryQueue([],now);q.remember([{mint,pairCreatedAt:now}],now);
 assert.deepEqual(q.nextBatch([],now),[mint]);
 const restarted=new DiscoveryQueue(q.snapshot(),now+900000);
 assert.deepEqual(restarted.nextBatch([],now+900000),[mint]);
 restarted.queried([mint],now+900000);assert.deepEqual(restarted.nextBatch([mint],now+905000),[]);
 assert.deepEqual(restarted.nextBatch([],now+365*86400000),[mint]);
 const old=JSON.parse(JSON.stringify(restarted.snapshot()));old[0].pairCreatedAt=now-365*86400000;assert.deepEqual(new DiscoveryQueue(old,now).nextBatch(),[mint]);
});

test('discovery memory is bounded, excludes invalid addresses and rotates the least recently queried candidates',()=>{
 const now=Date.now(),q=new DiscoveryQueue([],now),alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
 const rows=Array.from({length:650},(_,i)=>({mint:'1'.repeat(30)+alphabet[Math.floor(i/58)]+alphabet[i%58],pairCreatedAt:now-1800000}));
 q.remember([...rows,{mint:'not a mint'}],now);assert.equal(q.entries.size,600);
 const first=q.nextBatch([],now);assert.equal(first.length,30);q.queried(first,now);
 const second=q.nextBatch([],now+5000);assert.equal(second.some(m=>first.includes(m)),false);
 assert.equal(new DiscoveryQueue(q.snapshot(),now).entries.size,600);
});

test('a slow discovery refresh does not block price scans after the initial snapshot',async()=>{
 const now=Date.now(),q=new DiscoveryQueue([],now),first=[{status:'fulfilled',value:{pairs:[]}}];
 assert.equal(await q.discover(async()=>first,now),first);
 let release;const waiting=new Promise(r=>release=r),second=[{status:'fulfilled',value:{pairs:['new']}}];
 const snapshot=await q.discover(async()=>{await waiting;return second;},now+30000);
 assert.equal(snapshot,first);assert.ok(q.discoveryJob);
 release();await q.discoveryJob;assert.equal(await q.discover(async()=>{throw Error('unneeded refresh');},now+30001),second);
});

test('the shortlist cannot discard an eligible low-cap pool behind sixty liquid pools outside the market-cap limit',async t=>{
 const now=Date.now(),old=Array.from({length:65},(_,i)=>({...pair('old-'+i,now),marketCap:6000000,liquidity:{usd:1000000+i},pairCreatedAt:now-172800000}));
 t.mock.method(globalThis,'fetch',async url=>new Response(JSON.stringify(String(url).includes('geckoterminal')?{data:[]}:String(url).endsWith('/latest/v1')?[]:{pairs:String(url).endsWith(SOL)?[pair(SOL,now,'150')]:[...old,pair(mint,now)]})));
 const feed=await loadMarkets();assert.equal(feed.markets.length,60);assert.equal(feed.markets[0].mint,mint);
});

test('a matured pool absent from all current discovery sources is revisited with a fresh price',async t=>{
 const now=Date.now(),q=new DiscoveryQueue([{mint,firstSeenAt:now-1000000,lastSeenAt:now-1000000,pairCreatedAt:now-1000000,lastQueriedAt:now-1000000}],now),urls=[];
 t.mock.method(globalThis,'fetch',async url=>{
  const u=String(url);urls.push(u);return new Response(JSON.stringify(u.includes('geckoterminal')?{data:[]}:u.endsWith('/latest/v1')?[]:{pairs:u.endsWith(SOL)?[pair(SOL,now,'150')]:u.endsWith('/tokens/'+mint)?[pair(mint,now,'2')]:[]}));
 });
 const feed=await loadMarkets([],{},q);assert.equal(feed.markets[0].mint,mint);assert.equal(feed.markets[0].priceUsd,2);assert.equal(feed.sources.revisitedTokens,1);assert.ok(urls.some(u=>u.endsWith('/tokens/'+mint)));
});

test('liquid inactive pools inside the cap range cannot crowd an active candidate out of the shortlist',async t=>{
 const now=Date.now(),inactive=Array.from({length:65},(_,i)=>({...pair('inactive-'+i,now),liquidity:{usd:1000000+i,quote:1000},txns:{m5:{buys:0,sells:0},h1:{buys:0,sells:0}}}));
 t.mock.method(globalThis,'fetch',async url=>new Response(JSON.stringify(String(url).includes('geckoterminal')?{data:[]}:String(url).endsWith('/latest/v1')?[]:{pairs:String(url).endsWith(SOL)?[pair(SOL,now,'150')]:[...inactive,pair(mint,now)]})));
 const feed=await loadMarkets();assert.equal(feed.markets[0].mint,mint);assert.equal(feed.markets.length,60);
});

test('cached discovery never becomes fresh executable prices; each scan re-fetches mint prices',async t=>{
 const now=Date.now(),q=new DiscoveryQueue([],now);let price=1,searches=0;
 t.mock.method(globalThis,'fetch',async url=>{
  const u=String(url);let value;
  if(u.includes('geckoterminal'))value={data:[]};else if(u.endsWith('/latest/v1'))value=[];
  else if(u.includes('/search?')){searches++;value={pairs:[pair(mint,now,'999')]};}
  else value={pairs:[pair(u.endsWith(SOL)?SOL:mint,now,u.endsWith(SOL)?'150':String(price))]};
  return new Response(JSON.stringify(value));
 });
 const first=await loadMarkets([],{},q);assert.equal(first.markets[0].priceUsd,1);
 price=2;const next=await loadMarkets([],{},q);assert.equal(next.markets[0].priceUsd,2);assert.equal(searches,3);
});
