import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {keylessConnection,PUBLIC_RPC_ENDPOINTS} from '../src/rpc.js';
import {SolanaExecution} from '../src/solana.js';
const GENESIS='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const reply=(request,result)=>new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}),{status:200,headers:{'Content-Type':'application/json'}});
test('no-key RPC ignores obsolete Helius configuration and carries confirmed JSON-RPC balances',async()=>{
 const original=globalThis.fetch,old=process.env.HELIUS_API_KEY,methods=[];process.env.HELIUS_API_KEY='obsolete-key-must-not-be-used';
 globalThis.fetch=async(url,options)=>{const endpoint=new URL(url);assert.ok(PUBLIC_RPC_ENDPOINTS.includes(endpoint.origin));assert.equal(endpoint.search,'');const r=JSON.parse(options.body);methods.push(r.method);return reply(r,r.method==='getGenesisHash'?GENESIS:{context:{slot:50},value:300000000});};
 try{const e=new SolanaExecution();await e.network();assert.equal(await e.balance(Keypair.generate().publicKey),.3);assert.equal(e.configureHelius,undefined);assert.ok(methods.includes('getBalance'));assert.throws(()=>new SolanaExecution('http://example.invalid'));}
 finally{globalThis.fetch=original;if(old===undefined)delete process.env.HELIUS_API_KEY;else process.env.HELIUS_API_KEY=old;}
});
test('a throttled read switches to a verified mainnet RPC and remains on that endpoint',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{const r=JSON.parse(options.body);calls.push([url,r.method]);if(r.method==='getGenesisHash')return reply(r,GENESIS);if(url===PUBLIC_RPC_ENDPOINTS[0])return new Response('throttled',{status:429});return reply(r,{context:{slot:50},value:300000000});};
 try{const rpc=keylessConnection();assert.equal(await rpc.getBalance(Keypair.generate().publicKey),300000000);await rpc.getBalance(Keypair.generate().publicKey);assert.deepEqual(calls.filter(c=>c[1]==='getBalance').map(c=>c[0]),[...PUBLIC_RPC_ENDPOINTS,PUBLIC_RPC_ENDPOINTS[1]]);}
 finally{globalThis.fetch=original;}
});
test('wrong-chain RPCs are never used for a read and uncertain sends are not retried on another endpoint',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{const r=JSON.parse(options.body);calls.push([url,r.method]);if(r.method==='getGenesisHash')return reply(r,url===PUBLIC_RPC_ENDPOINTS[0]?'devnet':GENESIS);return reply(r,{context:{slot:50},value:300000000});};
 try{const rpc=keylessConnection();assert.equal(await rpc.getBalance(Keypair.generate().publicKey),300000000);assert.equal(calls.some(c=>c[0]===PUBLIC_RPC_ENDPOINTS[0]&&c[1]==='getBalance'),false);
  calls.length=0;globalThis.fetch=async(url,options)=>{const r=JSON.parse(options.body);calls.push([url,r.method]);if(r.method==='sendTransaction')throw Error('connection reset after write');return reply(r,GENESIS);};
  await assert.rejects(rpc.sendRawTransaction(Buffer.from([1,2,3])),/signature/);assert.equal(calls.filter(c=>c[1]==='sendTransaction').length,1);assert.equal(calls.some(c=>c[0]===PUBLIC_RPC_ENDPOINTS[0]),false);
 }finally{globalThis.fetch=original;}
});
test('connection diagnostics distinguish a wrong genesis from HTTP rejection without exposing URL credentials or keys',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{const request=JSON.parse(options.body);if(new URL(url).hostname==='wrong.example')return reply(request,'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');return new Response('do not echo response body or credentials',{status:403});};
 try{
  const rpc=keylessConnection(['https://wrong.example/?api-key=do-not-show','https://blocked.example/?api-key=do-not-show']);await assert.rejects(rpc.getBalance(Keypair.generate().publicKey));
  assert.deepEqual(rpc.rpcDiagnostics().failures,[{host:'wrong.example',reason:'Genesis không đúng Solana mainnet'},{host:'blocked.example',reason:'HTTP 403'}]);assert.ok(!JSON.stringify(rpc.rpcDiagnostics()).includes('do-not-show'));
 }finally{globalThis.fetch=original;}
});

test('a read unavailable on an unindexed RPC retries the other verified mainnet endpoint',async t=>{
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  const r=JSON.parse(options.body);calls.push([url,r.method]);if(r.method==='getGenesisHash')return reply(r,GENESIS);
  if(url===PUBLIC_RPC_ENDPOINTS[0])return new Response(JSON.stringify({jsonrpc:'2.0',id:r.id,error:{code:-32010,message:'Token program excluded from account secondary indexes'}}));
  return reply(r,[]);
 });
 const result=await keylessConnection().getProgramAccounts(Keypair.generate().publicKey);
 assert.deepEqual(result,[]);assert.deepEqual(calls.filter(x=>x[1]==='getProgramAccounts').map(x=>x[0]),[...PUBLIC_RPC_ENDPOINTS]);
});

test('concurrent identical RPC reads and genesis checks are coalesced, with no price/balance result cache',async t=>{
 let genesis=0,balances=0,entered,release;const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
 t.mock.method(globalThis,'fetch',async(_url,options)=>{const r=JSON.parse(options.body);if(r.method==='getGenesisHash'){genesis++;return reply(r,GENESIS);}balances++;entered();await wait;return reply(r,{context:{slot:50},value:balances*100000000});});
 const rpc=keylessConnection(),key=Keypair.generate().publicKey,reads=Array.from({length:8},()=>rpc.getBalance(key));await started;assert.equal(genesis,1);assert.equal(balances,1);release();
 assert.deepEqual(await Promise.all(reads),Array(8).fill(100000000));assert.equal(await rpc.getBalance(key),200000000);assert.equal(genesis,1);
});

test('all throttled RPCs respect Retry-After and fail fast until the retry deadline, then recover',async t=>{
 let now=0,calls=0,available=false;
 t.mock.method(globalThis,'fetch',async(_url,options)=>{const r=JSON.parse(options.body);if(r.method==='getGenesisHash')return reply(r,GENESIS);calls++;return available?reply(r,{context:{slot:50},value:300000000}):new Response('{}',{status:429,headers:{'retry-after':'120'}});});
 const rpc=keylessConnection(undefined,{clock:()=>now,random:()=>0}),key=Keypair.generate().publicKey;
 await assert.rejects(rpc.getBalance(key));assert.equal(calls,2);assert.equal(rpc.rpcDiagnostics().cooldowns.length,2);
 now=119999;await assert.rejects(rpc.getBalance(key));assert.equal(calls,2);
 now=120000;available=true;assert.equal(await rpc.getBalance(key),300000000);assert.equal(calls,3);
});

test('unsupported holder scans are remembered per method without quarantining working balance reads',async t=>{
 let now=1000,unavailable=false;const calls=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{const r=JSON.parse(options.body);if(r.method==='getGenesisHash')return reply(r,GENESIS);calls.push([url,r.method]);
  if(url===PUBLIC_RPC_ENDPOINTS[1]&&unavailable)return new Response('{}',{status:503});
  if(r.method==='getProgramAccounts'&&url===PUBLIC_RPC_ENDPOINTS[0])return new Response(JSON.stringify({jsonrpc:'2.0',id:r.id,error:{code:-32010,message:'unindexed'}}));
  return reply(r,r.method==='getProgramAccounts'?[]:{context:{slot:50},value:300000000});});
 const rpc=keylessConnection(undefined,{clock:()=>now,random:()=>0}),key=Keypair.generate().publicKey;
 assert.deepEqual(await rpc.getProgramAccounts(key),[]);unavailable=true;assert.equal(await rpc.getBalance(key),300000000);
 await assert.rejects(rpc.getProgramAccounts(key));assert.equal(calls.filter(c=>c[0]===PUBLIC_RPC_ENDPOINTS[0]&&c[1]==='getProgramAccounts').length,1);assert.equal(await rpc.getBalance(key),300000000);
});

test('a late healthy RPC response cannot erase a rate limit received by another concurrent method',async t=>{
 let entered,release;const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
 t.mock.method(globalThis,'fetch',async(_url,options)=>{const r=JSON.parse(options.body);if(r.method==='getGenesisHash')return reply(r,GENESIS);
  if(r.method==='getBalance'){entered();await wait;return reply(r,{context:{slot:50},value:300000000});}return new Response('{}',{status:429});});
 const rpc=keylessConnection(undefined,{clock:()=>1000,random:()=>0}),balance=rpc.getBalance(Keypair.generate().publicKey);await started;
 await assert.rejects(rpc.getSlot());release();assert.equal(await balance,300000000);assert.equal(rpc.rpcDiagnostics().cooldowns.length,2);
});
