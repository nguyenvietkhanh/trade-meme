import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey} from '@solana/web3.js';
import {OFFLINE_PUMP_AMM_PROGRAM as program,PUMP_AMM_PROGRAM_ID} from '@pump-fun/pump-swap-sdk';
import BN from 'bn.js';
import bs58 from 'bs58';
import {decodeSwapTrades,flowSummary,createSwapFlowReader} from '../src/paper-swap-flow.js';
import {SOL} from '../src/engine.js';
const now=Date.parse('2026-10-25T05:00:10Z'),pool=Keypair.generate().publicKey,mint=Keypair.generate().publicKey,user=Keypair.generate().publicKey,m={dexId:'pumpswap',mint:mint.toBase58(),pairAddress:pool.toBase58()};
function value(type){if(typeof type==='string'){if(type==='pubkey')return user;if(type==='bool')return false;if(type==='string')return '';if(type==='bytes')return Buffer.alloc(0);return ['u64','i64','u128','i128','u256','i256'].includes(type)?new BN(0):0;}if(type.option)return null;if(type.vec)return [];if(type.array)return Array.from({length:type.array[1]},()=>value(type.array[0]));if(type.defined)return data(type.defined.name);throw Error('Unexpected fixture type');}
function data(name){return Object.fromEntries(program.idl.types.find(x=>x.name===name).type.fields.map(f=>[f.name,value(f.type)]));}
function transaction(side='buyEvent',who=user){const d={...data(side),timestamp:new BN(now/1000),pool,user:who};d[side==='buyEvent'?'quoteAmountIn':'quoteAmountOut']=new BN(100000000);d[side==='buyEvent'?'baseAmountOut':'baseAmountIn']=new BN(1000000);const discriminator=program.idl.events.find(e=>e.name===side).discriminator,encoded=Buffer.concat([Buffer.from(discriminator),program.coder.types.encode(side,d)]),tx={slot:100,blockTime:now/1000,transaction:{message:{staticAccountKeys:[user,PUMP_AMM_PROGRAM_ID,pool],header:{numRequiredSignatures:1}}},meta:{err:null,logMessages:[],innerInstructions:[{instructions:[{programIdIndex:1,data:bs58.encode(Buffer.concat([Buffer.from([228,69,165,46,81,203,154,29]),encoded]))}]}]}};return {tx,encoded};}
test('only actual PumpSwap program CPI or program-scoped logs produce wallet trade events',()=>{
 const {tx,encoded}=transaction(),row=decodeSwapTrades(tx,m,'sig');assert.equal(row.complete,true);assert.equal(row.events.length,1);assert.equal(row.events[0].side,'BUY');assert.equal(row.events[0].user,user.toBase58());assert.equal(row.events[0].quoteSol,.1);
 const spoof={...tx,meta:{...tx.meta,innerInstructions:[],logMessages:['Program '+user.toBase58()+' invoke [1]','Program data: '+encoded.toString('base64'),'Program '+user.toBase58()+' success']}};assert.equal(decodeSwapTrades(spoof,m,'spoof').events.length,0);
 const logs={...tx,meta:{...tx.meta,innerInstructions:[],logMessages:['Program '+PUMP_AMM_PROGRAM_ID.toBase58()+' invoke [1]','Program data: '+encoded.toString('base64'),'Program '+PUMP_AMM_PROGRAM_ID.toBase58()+' success']}};assert.equal(decodeSwapTrades(logs,m,'logs').events.length,1);assert.equal(decodeSwapTrades({...tx,meta:{...tx.meta,err:{InstructionError:[1,'fail']}}},m,'failed').events.length,0);assert.equal(decodeSwapTrades(tx,{...m,pairAddress:user.toBase58()},'wrong-pool').events.length,0);
 assert.equal(decodeSwapTrades({...tx,meta:{...tx.meta,innerInstructions:[],logMessages:null}},m,'missing-events').complete,false);assert.equal(decodeSwapTrades({...tx,transaction:{...tx.transaction,signatures:['another']}},m,'requested').complete,false);
});
test('PDA/router users are not relabeled as independently identified signing wallets and partial windows remain unknown',()=>{
 const router=PublicKey.findProgramAddressSync([Buffer.from('fixture')],PUMP_AMM_PROGRAM_ID)[0],{tx}=transaction('buyEvent',router),decoded=decodeSwapTrades(tx,m,'router');assert.equal(decoded.events[0].user,null);const signatures=[{signature:'router',blockTime:now/1000,err:null}],summary=flowSummary(m,signatures,new Map([['router',decoded]]),now,now);assert.equal(summary.windowComplete,true);assert.equal(summary.walletsComplete,false);assert.equal(summary.lastTenComplete,false);
 const busy=Array.from({length:40},(_,i)=>({signature:'busy'+i,blockTime:now/1000-i,err:null}));assert.equal(flowSummary(m,busy,new Map(),now,now).windowComplete,false);
});
test('a full signature window computes actual distinct signers, last ten trades and volume shares',()=>{
 const signatures=[],receipts=new Map();for(let i=0;i<10;i++){const signature='s'+i,who=Keypair.generate().publicKey;signatures.push({signature,blockTime:now/1000-i,err:null});receipts.set(signature,{complete:true,events:[{id:signature,signature,at:now-i*1000,slot:100-i,user:who.toBase58(),side:i<6?'BUY':'SELL',quoteSol:.1}]});}const summary=flowSummary(m,signatures,receipts,now,now);assert.equal(summary.windowComplete,true);assert.equal(summary.lastTenComplete,true);assert.equal(summary.uniqueBuyers,6);assert.equal(summary.uniqueSellers,4);assert.ok(Math.abs(summary.largestBuySharePct-10)<1e-9);receipts.delete('s0');assert.equal(flowSummary(m,signatures,receipts,now,now).windowComplete,false);assert.equal(flowSummary(m,signatures,receipts,now,now).lastTenComplete,false);
});
test('bounded read facade verifies pool identity and never calls any signing/broadcast method',async()=>{
 const poolData={...data('pool'),baseMint:mint,quoteMint:new PublicKey(SOL)},account=await program.coder.accounts.encode('pool',poolData);let reads=0;const rpc={getAccountInfo:async()=>({owner:PUMP_AMM_PROGRAM_ID,data:account}),getSignaturesForAddress:async()=>Array.from({length:20},(_,i)=>({signature:'r'+i,blockTime:now/1000-i,err:null})),getTransaction:async()=>{reads++;return transaction().tx;},sendTransaction:()=>{throw Error('forbidden');}},reader=createSwapFlowReader(rpc,{clock:()=>now});const first=await reader(m);assert.equal(reads,12);assert.equal(first.windowComplete,false);const second=await reader(m);assert.equal(reads,20);assert.equal(second.windowComplete,true);assert.equal(second.provider,'confirmed-pumpswap-events');
 await assert.rejects(createSwapFlowReader({...rpc,getAccountInfo:async()=>({owner:user,data:account})},{clock:()=>now})(m),/program mismatch/);
});
test('unsupported transaction versions are backoff-cached as incomplete, never as a clean flow window',async()=>{
 let at=now,reads=0;const account=await program.coder.accounts.encode('pool',{...data('pool'),baseMint:mint,quoteMint:new PublicKey(SOL)}),rpc={getAccountInfo:async()=>({owner:PUMP_AMM_PROGRAM_ID,data:account}),getSignaturesForAddress:async()=>[{signature:'unsupported',blockTime:now/1000,err:null}],getTransaction:async(_s,options)=>{assert.equal(options.maxSupportedTransactionVersion,0);reads++;throw Object.assign(Error('RPC error (-32015)'),{code:-32015});}};
 const read=createSwapFlowReader(rpc,{clock:()=>at});assert.equal((await read(m)).windowComplete,false);assert.equal(reads,1);at+=31000;assert.equal((await read(m)).windowComplete,false);assert.equal(reads,1);at+=600000;await read(m);assert.equal(reads,2);
});

test('wrong mint rejection is cached, bounded and rechecked after TTL without returning fake flow',async()=>{
 let at=now,reads=0;const account=await program.coder.accounts.encode('pool',{...data('pool'),baseMint:user,quoteMint:new PublicKey(SOL)}),rpc={getAccountInfo:async()=>{reads++;return {owner:PUMP_AMM_PROGRAM_ID,data:account};}};
 const read=createSwapFlowReader(rpc,{clock:()=>at});await assert.rejects(read(m),/mint mismatch/);for(let i=0;i<100;i++)await assert.rejects(read(m),e=>e.cachedReadRejection===true);assert.equal(reads,1);at+=600001;await assert.rejects(read(m),/mint mismatch/);assert.equal(reads,2);
});
test('simultaneous flow reads share one public RPC job',async()=>{
 let reads=0,windows=0,release;const gate=new Promise(r=>release=r),account=await program.coder.accounts.encode('pool',{...data('pool'),baseMint:mint,quoteMint:new PublicKey(SOL)}),rpc={getAccountInfo:async()=>{reads++;await gate;return {owner:PUMP_AMM_PROGRAM_ID,data:account};},getSignaturesForAddress:async()=>{windows++;return [];}};
 const read=createSwapFlowReader(rpc,{clock:()=>now}),first=read(m),second=read(m);release();const rows=await Promise.all([first,second]);assert.equal(reads,1);assert.equal(windows,1);assert.equal(rows[0],rows[1]);assert.equal(rows[0].windowComplete,true);
});
