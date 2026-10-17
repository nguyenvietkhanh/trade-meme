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
