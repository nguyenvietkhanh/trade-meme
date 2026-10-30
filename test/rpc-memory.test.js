import test from 'node:test';
import {PublicKey} from '@solana/web3.js';
import assert from 'node:assert/strict';
import {keylessConnection,MAINNET_GENESIS_HASH} from '../src/rpc.js';
const endpoint='https://rpc-memory.example';
function genesis(request){return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:MAINNET_GENESIS_HASH}));}
test('oversized declared RPC bodies are cancelled before parsing and never accepted as empty safety data',async t=>{
 let cancelled=0,reads=0;t.mock.method(globalThis,'fetch',async(_url,options)=>{const r=JSON.parse(options.body);if(r.method==='getGenesisHash')return genesis(r);reads++;return new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'Content-Length':String(9*1024*1024)}});});
 const rpc=keylessConnection([endpoint]);await assert.rejects(rpc.getBalance(new PublicKey('11111111111111111111111111111111')),/RPC_UNAVAILABLE|RPC/);assert.equal(reads,1);assert.equal(cancelled,1);assert.match(JSON.stringify(rpc.rpcDiagnostics()),/RPC_RESPONSE_TOO_LARGE/);
});
test('chunked RPC bodies without Content-Length are bounded and cancel the reader',async t=>{
 let cancelled=0,chunks=0;t.mock.method(globalThis,'fetch',async(_url,options)=>{const r=JSON.parse(options.body);if(r.method==='getGenesisHash')return genesis(r);return new Response(new ReadableStream({pull(controller){chunks++;controller.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled++;}}));});
 const rpc=keylessConnection([endpoint]);await assert.rejects(rpc.getBalance(new PublicKey('11111111111111111111111111111111')),/RPC_UNAVAILABLE|RPC/);assert.equal(cancelled,1);assert.ok(chunks<=10);assert.match(JSON.stringify(rpc.rpcDiagnostics()),/RPC_RESPONSE_TOO_LARGE/);
});
