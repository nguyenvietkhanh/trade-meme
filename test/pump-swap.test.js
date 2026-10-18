import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey,Keypair,SystemProgram} from '@solana/web3.js';
import {OFFLINE_PUMP_AMM_PROGRAM as program,PUMP_AMM_PROGRAM_ID,PUMP_AMM_FEE_CONFIG_PDA} from '@pump-fun/pump-swap-sdk';
import {buildPumpSwap} from '../src/pump-swap.js';
import {SOL} from '../src/engine.js';
import {SolanaExecution} from '../src/solana.js';
import {pumpFixture} from './fixtures/pump-rpc.js';
const request=f=>({owner:f.user,input:SOL,output:f.mint.toBase58(),amount:'200000000',poolAddress:f.poolKey.toBase58()});
function instruction(tx){const ix=tx.message.compiledInstructions.find(i=>tx.message.staticAccountKeys[i.programIdIndex].equals(PUMP_AMM_PROGRAM_ID));return program.coder.instruction.decode(Buffer.from(ix.data));}
test('direct PumpSwap exact-input buy encodes the 0.2 SOL cap and a positive minimum output in the real SDK instruction',async()=>{
 const f=await pumpFixture(),result=await buildPumpSwap(f.rpc,request(f)),ix=instruction(result.tx);
 assert.equal(ix.name,'buyExactQuoteInV2');assert.equal(ix.data.spendableQuoteIn.toString(),'200000000');assert.equal(ix.data.minBaseAmountOut.toString(),result.quote.otherAmountThreshold);assert.ok(BigInt(result.quote.otherAmountThreshold)>0n);assert.ok(result.tx.serialize().length<=1232);assert.equal(result.tx.message.header.numRequiredSignatures,1);assert.ok(result.tx.signatures[0].every(b=>b===0));
});
test('direct PumpSwap sell encodes exact raw units and minimum SOL output',async()=>{
 const f=await pumpFixture({buy:false}),result=await buildPumpSwap(f.rpc,{...request(f),input:f.mint.toBase58(),output:SOL,amount:'10000000'}),ix=instruction(result.tx);
 assert.equal(ix.name,'sellV2');assert.equal(ix.data.baseAmountIn.toString(),'10000000');assert.equal(ix.data.minQuoteAmountOut.toString(),result.quote.otherAmountThreshold);assert.ok(result.tx.serialize().length<=1232);
});
test('pool/program/mint, fee config, WSOL and stale state checks block invalid direct swaps',async()=>{
 const f=await pumpFixture(),r=request(f),pool=f.map.get(f.poolKey.toBase58());
 pool.owner=SystemProgram.programId;await assert.rejects(buildPumpSwap(f.rpc,r),/không thuộc/);pool.owner=PUMP_AMM_PROGRAM_ID;
 const fees=f.map.get(PUMP_AMM_FEE_CONFIG_PDA.toBase58());f.map.delete(PUMP_AMM_FEE_CONFIG_PDA.toBase58());await assert.rejects(buildPumpSwap(f.rpc,r),/cấu hình phí/);f.map.set(PUMP_AMM_FEE_CONFIG_PDA.toBase58(),fees);
 await assert.rejects(buildPumpSwap(f.rpc,{...r,output:Keypair.generate().publicKey.toBase58()}),/không khớp/);
 f.map.set(f.quoteAta.toBase58(),f.token(new PublicKey(SOL),f.user,100));await assert.rejects(buildPumpSwap(f.rpc,r),/WSOL/);f.map.delete(f.quoteAta.toBase58());
 let call=0;f.rpc.getSlot=async()=>++call===1?100:121;await assert.rejects(buildPumpSwap(f.rpc,r),/đã cũ/);
});
test('unsupported pools and excessive reserve impact stop before a wallet request',async()=>{
 for(const changes of [{isCashbackCoin:true},{isMayhemMode:true}]){const f=await pumpFixture({changes});await assert.rejects(buildPumpSwap(f.rpc,request(f)),/mayhem\/cashback/);}
 const f=await pumpFixture();await assert.rejects(buildPumpSwap(f.rpc,{...request(f),amount:'1000000000'}),/2%/);
});
test('simulation rejects insufficient output and excess SOL even for locally built PumpSwap instructions',async()=>{
 const f=await pumpFixture(),execution=new SolanaExecution();execution.rpc=f.rpc;const original=f.rpc.simulateTransaction;
 const r={ownerAddress:f.user.toBase58(),input:SOL,output:f.mint.toBase58(),amount:'200000000',poolAddress:f.poolKey.toBase58()};
 f.rpc.simulateTransaction=async(...args)=>{const sim=await original(...args);sim.value.accounts[0].lamports=90000000;return sim;};await assert.rejects(execution.prepare(r),/quá giới hạn/);
 f.rpc.simulateTransaction=async(...args)=>{const sim=await original(...args),data=Buffer.from(sim.value.accounts[1].data[0],'base64');data.writeBigUInt64LE(1n,64);sim.value.accounts[1].data[0]=data.toString('base64');return sim;};await assert.rejects(execution.prepare(r),/không nhận đủ/);
});
test('emergency sell SDK instructions encode at most 10% slippage and cannot relax a buy reserve limit',async()=>{
 const f=await pumpFixture({buy:false}),requestSell={owner:f.user,input:f.mint.toBase58(),output:SOL,amount:'10000000',poolAddress:f.poolKey.toBase58(),slippageBps:1000,maxReserveFraction:.1};
 const result=await buildPumpSwap(f.rpc,requestSell),ix=instruction(result.tx);
 assert.equal(result.quote.slippageBps,1000);assert.equal(ix.data.minQuoteAmountOut.toString(),(BigInt(result.quote.outAmount)*90n/100n).toString());
 await assert.rejects(buildPumpSwap(f.rpc,{...requestSell,slippageBps:1001}),/Slippage/);
 await assert.rejects(buildPumpSwap(f.rpc,{...request(f),maxReserveFraction:.1}),/Slippage/);
});
test('a local pool cannot relax the owner entry price reference supplied by Jupiter',async()=>{
 const f=await pumpFixture(),base=await buildPumpSwap(f.rpc,request(f));
 await assert.rejects(buildPumpSwap(f.rpc,{...request(f),referenceMinOut:(BigInt(base.quote.outAmount)+1n).toString()}),/Jupiter/);
 const reference=BigInt(base.quote.outAmount)*99n/100n,result=await buildPumpSwap(f.rpc,{...request(f),referenceMinOut:String(reference)});assert.ok(BigInt(result.quote.otherAmountThreshold)>=reference);
});

test('official SDK simulation checks referenced accounts without depending on full-wallet inventory',async()=>{
 const f=await pumpFixture(),execution=new SolanaExecution();execution.rpc=f.rpc;
 execution.holdings=async()=>{throw Error('Global wallet inventory must not be required by prepare');};
 const result=await execution.prepare({ownerAddress:f.user.toBase58(),input:SOL,output:f.mint.toBase58(),amount:'200000000',poolAddress:f.poolKey.toBase58()});
 assert.ok(result.bytes.length>0);assert.equal(result.quote.inAmount,'200000000');assert.equal(result.signature,null);
});

test('new BUY preparation refuses old sizes and larger requests before any RPC call',async()=>{
 const execution=new SolanaExecution();let rpcCalls=0;execution.network=async()=>{rpcCalls++;throw Error('Must reject before RPC');};
 for(const amount of ['20000000','30000000','200000001','300000000'])await assert.rejects(execution.prepare({input:SOL,amount}),/0,2 SOL/);
 assert.equal(rpcCalls,0);
});

test('per-mint token balances work independently of global inventory and reject mismatched owner/mint data',async()=>{
 const f=await pumpFixture({buy:false}),execution=new SolanaExecution(),mint=f.mint.toBase58(),calls=[];
 execution.rpc={getTokenAccountsByOwner:async(owner,filter)=>{calls.push(filter);if(!filter.mint)throw Error('Global index unavailable');assert.ok(owner.equals(f.user));assert.equal(filter.mint.toBase58(),mint);return {value:[{pubkey:f.baseAta,account:f.map.get(f.baseAta.toBase58())}]};}};
 assert.equal((await execution.holdings(f.user,mint))[0].account.data.readBigUInt64LE(64),100000000n);assert.equal(calls.length,1);
 const account=f.map.get(f.baseAta.toBase58());Keypair.generate().publicKey.toBuffer().copy(account.data,32);await assert.rejects(execution.holdings(f.user,mint),/không khớp/);
});
