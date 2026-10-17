import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
import {SolanaExecution} from '../src/solana.js';
import {DirectWallet} from '../src/direct-wallet.js';
import {OwnerAgent} from '../src/owner-agent.js';
// Full mainnet-beta fixture from Solana SDK ClusterType::get_genesis_hash, not the truncated CAIP identifier:
// https://github.com/solana-labs/solana/blob/master/sdk/src/genesis_config.rs
const MAINNET='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const DEVNET='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const TESTNET='4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY';
test('the full official 32-byte mainnet genesis permits balance reads and enabling the unlocked owner signer',async()=>{
 assert.equal(bs58.decode(MAINNET).length,32);assert.notEqual(bs58.decode(MAINNET.slice(0,32)).length,32);
 const original=globalThis.fetch,dir=await mkdtemp('/tmp/meme-full-genesis-'),kp=Keypair.generate(),owner=kp.publicKey.toBase58(),methods=[];
 globalThis.fetch=async(_url,options)=>{const request=JSON.parse(options.body);methods.push(request.method);assert.ok(['getGenesisHash','getBalance'].includes(request.method));return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:request.method==='getGenesisHash'?MAINNET:{context:{slot:100},value:300000000}}),{status:200});};
 try{
  const execution=new SolanaExecution();await execution.network();assert.equal(await execution.balance(owner),.3);
  const direct=new DirectWallet(execution);direct.owner=owner;const agent=new OwnerAgent(dir,direct,execution,owner);agent.vault.keypair=kp;
  const status=await agent.status();assert.equal(status.wallet.balanceSol,.3);assert.equal(status.wallet.swapReady,true);
  await agent.enable();assert.equal(agent.state.running,true);assert.equal(agent.state.settings.initialSol,.3);assert.ok(methods.includes('getBalance'));
 }finally{globalThis.fetch=original;await rm(dir,{recursive:true,force:true});}
});
test('network validation rejects truncated identifiers, devnet, testnet and malformed genesis values',async()=>{
 for(const result of [MAINNET.slice(0,32),DEVNET,TESTNET,'mainnet-beta','',null]){
  const execution=new SolanaExecution();execution.rpc={getGenesisHash:async()=>result};await assert.rejects(execution.network(),/mainnet/);
 }
});
