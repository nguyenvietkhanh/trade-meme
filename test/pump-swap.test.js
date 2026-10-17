import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey,Keypair,SystemProgram} from '@solana/web3.js';
import {OFFLINE_PUMP_AMM_PROGRAM as program,PUMP_AMM_PROGRAM_ID,PUMP_AMM_FEE_CONFIG_PDA} from '@pump-fun/pump-swap-sdk';
import {buildPumpSwap} from '../src/pump-swap.js';
import {SOL} from '../src/engine.js';
import {SolanaExecution} from '../src/solana.js';
import {pumpFixture} from './fixtures/pump-rpc.js';
const request=f=>({owner:f.user,input:SOL,output:f.mint.toBase58(),amount:'30000000',poolAddress:f.poolKey.toBase58()});
function instruction(tx){const ix=tx.message.compiledInstructions.find(i=>tx.message.staticAccountKeys[i.programIdIndex].equals(PUMP_AMM_PROGRAM_ID));return program.coder.instruction.decode(Buffer.from(ix.data));}
test('direct PumpSwap exact-input buy encodes the 0.03 SOL cap and a positive minimum output in the real SDK instruction',async()=>{
 const f=await pumpFixture(),result=await buildPumpSwap(f.rpc,request(f)),ix=instruction(result.tx);
 assert.equal(ix.name,'buyExactQuoteInV2');assert.equal(ix.data.spendableQuoteIn.toString(),'30000000');assert.equal(ix.data.minBaseAmountOut.toString(),result.quote.otherAmountThreshold);assert.ok(BigInt(result.quote.otherAmountThreshold)>0n);assert.ok(result.tx.serialize().length<=1232);assert.equal(result.tx.message.header.numRequiredSignatures,1);assert.ok(result.tx.signatures[0].every(b=>b===0));
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
 const r={ownerAddress:f.user.toBase58(),input:SOL,output:f.mint.toBase58(),amount:'30000000',poolAddress:f.poolKey.toBase58()};
 f.rpc.simulateTransaction=async(...args)=>{const sim=await original(...args);sim.value.accounts[0].lamports=260000000;return sim;};await assert.rejects(execution.prepare(r),/quá giới hạn/);
 f.rpc.simulateTransaction=async(...args)=>{const sim=await original(...args),data=Buffer.from(sim.value.accounts[1].data[0],'base64');data.writeBigUInt64LE(1n,64);sim.value.accounts[1].data[0]=data.toString('base64');return sim;};await assert.rejects(execution.prepare(r),/không nhận đủ/);
});
