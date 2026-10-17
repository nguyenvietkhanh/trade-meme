import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SolanaExecution} from '../src/solana.js';
import {Keypair} from '@solana/web3.js';
test('owner supplied Helius key selects the HTTPS mainnet RPC without exposing it in provider status',()=>{
 const execution=new SolanaExecution();
 execution.configureHelius('test-private-helius-key&value');
 assert.equal(execution.provider,'Helius');
 const endpoint=new URL(execution.rpc.rpcEndpoint);
 assert.equal(endpoint.origin,'https://mainnet.helius-rpc.com');
 assert.equal(endpoint.searchParams.get('api-key'),'test-private-helius-key&value');
 assert.equal([...endpoint.searchParams].length,1);
 assert.throws(()=>execution.configureHelius('bad\nkey'));
 assert.throws(()=>new SolanaExecution('http://example.invalid'));
});
test('configured Helius RPC carries JSON-RPC requests and parses confirmed balances with the pinned client',async()=>{
 const original=globalThis.fetch,methods=[];
 globalThis.fetch=async(url,options)=>{
  const endpoint=new URL(url);assert.equal(endpoint.hostname,'mainnet.helius-rpc.com');assert.equal(endpoint.searchParams.get('api-key'),'test-only-helius-api-key');
  const request=JSON.parse(options.body);methods.push(request.method);
  const result=request.method==='getGenesisHash'?'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp':{context:{slot:50},value:300000000};
  return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}),{status:200,headers:{'Content-Type':'application/json'}});
 };
 try{const execution=new SolanaExecution();execution.configureHelius('test-only-helius-api-key');await execution.network();assert.equal(await execution.balance(Keypair.generate().publicKey),.3);assert.deepEqual(methods,['getGenesisHash','getBalance']);}
 finally{globalThis.fetch=original;}
});
