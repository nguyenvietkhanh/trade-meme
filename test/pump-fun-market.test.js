import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey} from '@solana/web3.js';
import {PumpFunMarkets,curveActivity} from '../src/pump-fun-market.js';
import {SolanaExecution} from '../src/solana.js';
import {curveFixture} from './fixtures/curve-rpc.js';
const mint=Keypair.generate().publicKey.toBase58(),users=Array.from({length:20},()=>Keypair.generate().publicKey.toBase58());
function trades(now){return Array.from({length:20},(_,i)=>({mint,signature:'trade-'+i,user:users[i],timestamp:Math.floor(now/1000)-200+i*10,sol_amount:20000000+i*1000000,token_amount:100000000,is_buy:i%3!==0,slot:100+i,tx_index:0}));}
test('pump.fun activity uses independent buyers and actual trades, and flags truncated windows instead of inventing full H1 data',()=>{
 const now=Date.now(),rows=trades(now),a=curveActivity(rows,mint,now);assert.equal(a.historyComplete,true);assert.equal(a.buys5m,13);assert.equal(a.sells5m,7);assert.equal(a.uniqueBuyers5m,13);assert.ok(a.change1mPct>0);assert.equal(a.buys1h,13);
 const duplicated=curveActivity([...rows,rows[0]],mint,now);assert.equal(duplicated.sells5m,7);
 assert.equal(curveActivity(rows,mint,now,20).historyComplete,false);
 for(const bad of [{...rows[0],is_buy:null},{...rows[0],sol_amount:'NaN'},{...rows[0],user:'invalid'},{...rows[0],mint:'other'}])assert.throws(()=>curveActivity([bad],mint,now),/thiếu dữ liệu/);
});
test('source combines official curve reserves with market activity and never treats virtual SOL as withdrawable liquidity',async()=>{
 const now=Date.now(),f=await curveFixture({mint:new PublicKey(mint)}),e=new SolanaExecution();e.rpc=f.rpc;const calls=[];
 const source=new PumpFunMarkets(e,async url=>{calls.push(url);return new Response(JSON.stringify(url.includes('/trades/')?trades(now):[{mint,symbol:'NEW',name:'New curve',creator:f.curve.creator.toBase58(),created_timestamp:now-300000,complete:false,virtual_sol_reserves:999999999999999}]));});
 const r=await source.markets(100);assert.equal(r.markets.length,1);const m=r.markets[0];assert.equal(m.venue,'pumpfun');assert.equal(m.liquidityQuoteSol,30);assert.equal(m.liquidityUsd,3000);assert.equal(m.historyComplete,true);assert.equal(m.creatorSoldRecently,false);assert.equal(m.suspectedBundle,false);assert.ok(calls.some(u=>u.includes('/trades/all/')));
});
test('a slow/blocked curve feed runs in the background and cannot hold the ordinary market scan open',async()=>{
 let release;const wait=new Promise(r=>release=r),source=new PumpFunMarkets({},async()=>{await wait;return new Response('blocked',{status:403});});
 const first=source.cachedMarkets(100);assert.equal(first.markets.length,0);assert.ok(first.warnings.length);assert.ok(source.job);const job=source.job;source.cachedMarkets(100);assert.equal(source.job,job);release();await job;assert.equal(source.latest.markets.length,0);assert.ok(source.latest.warnings[0].includes('chưa khả dụng'));
});
test('a discovery 403 remains visible between refresh attempts, and only a successful response clears it',async t=>{
 let now=Date.now(),calls=0;t.mock.method(Date,'now',()=>now);
 const source=new PumpFunMarkets({},async()=>{calls++;return calls===1?new Response('blocked',{status:403}):new Response('[]');});
 const first=await source.markets(100);assert.equal(first.diagnostics.status,'unavailable');assert.equal(first.diagnostics.stages.discovery.errorCode,'HTTP_403');const failedAt=first.diagnostics.stages.discovery.checkedAt;
 now+=5000;const second=await source.markets(100);assert.equal(calls,1);assert.equal(second.diagnostics.stages.discovery.checkedAt,failedAt);assert.ok(second.warnings.some(w=>w.includes('chưa khả dụng')));assert.ok(second.diagnostics.message.includes('HTTP_403'));
 now+=30000;const recovered=await source.markets(100);assert.equal(calls,2);assert.equal(recovered.diagnostics.status,'empty');assert.equal(recovered.diagnostics.stages.discovery.errorCode,null);assert.equal(recovered.warnings.length,0);assert.equal(recovered.diagnostics.stages.discovery.lastSuccessAt,now);
});
test('diagnostics distinguish a successful list from failed/empty curve RPC without exposing raw errors',async()=>{
 let failed=true;const source=new PumpFunMarkets({curveMarketData:async()=>{if(failed)throw Error('private endpoint /?api-key=fixture-do-not-publish');return [];}},async()=>new Response(JSON.stringify([{mint,complete:false}])));
 const first=await source.markets(100);assert.equal(first.diagnostics.discoveredMints,1);assert.equal(first.diagnostics.stages.discovery.status,'ok');assert.equal(first.diagnostics.stages.curveRpc.status,'error');assert.equal(first.diagnostics.freshMarkets,0);assert.ok(!JSON.stringify(first).includes('fixture-do-not-publish'));
 failed=false;const recovered=await source.markets(100);assert.equal(recovered.diagnostics.stages.curveRpc.status,'ok');assert.equal(recovered.diagnostics.status,'waiting');assert.ok(recovered.diagnostics.message.includes('Chưa đọc được curve'));
});
test('trade-history 429 is separate from RPC success, survives skipped polls, recovers and expires honestly',async t=>{
 let now=Date.now(),blocked=true;t.mock.method(Date,'now',()=>now);
 const execution={curveMarketData:async()=>[{mint,venue:'pumpfun',dexId:'pumpfun',updatedAt:now,liquidityQuoteSol:30,liquidityUsd:3000,valuationUsd:40000,creatorAddress:users[0],tokenSupplyRaw:1e15}]};
 const source=new PumpFunMarkets(execution,async url=>url.includes('/trades/')?(blocked?new Response('limited',{status:429}):new Response(JSON.stringify(trades(now)))):new Response(JSON.stringify([{mint,complete:false}])));
 const first=await source.markets(100);assert.equal(first.diagnostics.stages.discovery.status,'ok');assert.equal(first.diagnostics.stages.curveRpc.status,'ok');assert.equal(first.diagnostics.stages.activity.errorCode,'HTTP_429');assert.equal(first.diagnostics.freshMarkets,0);
 now+=1000;const skipped=await source.markets(100);assert.equal(skipped.diagnostics.stages.activity.errorCode,'HTTP_429');assert.ok(skipped.warnings.length);
 now+=10000;blocked=false;const good=await source.markets(100);assert.equal(good.diagnostics.status,'ready');assert.equal(good.diagnostics.freshMarkets,1);assert.equal(good.diagnostics.completeActivityMarkets,1);assert.equal(good.diagnostics.stages.activity.errorCode,null);assert.equal(good.warnings.length,0);
 now+=31000;const stale=source.diagnostics(good.markets);assert.equal(stale.freshMarkets,0);assert.equal(stale.status,'stale');assert.ok(stale.message.includes('đã cũ'));
});
