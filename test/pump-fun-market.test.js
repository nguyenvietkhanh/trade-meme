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
