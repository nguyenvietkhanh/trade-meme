import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,SystemProgram} from '@solana/web3.js';
import BN from 'bn.js';
import {SolanaExecution} from '../src/solana.js';
import {SOL} from '../src/engine.js';
import {curveState,curveRoundTrip,buildPumpCurve,canonicalPumpPoolPda} from '../src/pump-curve.js';
import {PUMP_PROGRAM} from '../src/pump-swap.js';
import {OFFLINE_PUMP_AMM_PROGRAM} from '@pump-fun/pump-swap-sdk';
import {curveFixture} from './fixtures/curve-rpc.js';
import {pumpFixture} from './fixtures/pump-rpc.js';
import {walletOrderSol,validHistoricalBuy,WALLET_SIZING_VERSION,CURVE_RULES} from '../src/desk-rules.js';

test('low-level execution rejects every curve BUY before any RPC or simulation, including Token-2022',async()=>{
 for(const token2022 of [false,true]){const f=await curveFixture({token2022}),e=new SolanaExecution();let calls=0;e.network=async()=>{calls++;};
  await assert.rejects(e.prepare({ownerAddress:f.user.toBase58(),input:SOL,output:f.mint.toBase58(),amount:'50000000',poolAddress:f.address.toBase58(),venue:'pumpfun'}),/Đã tắt BUY/);assert.equal(calls,0);
 }
});
test('curve transaction guard rejects wrong PDA/owner, virtual-only liquidity and buys crossing completion',async()=>{
 const f=await curveFixture();await assert.rejects(curveState(f.rpc,f.mint.toBase58(),Keypair.generate().publicKey.toBase58()),/PDA/);
 f.map.get(f.address.toBase58()).owner=SystemProgram.programId;await assert.rejects(curveState(f.rpc,f.mint.toBase58()),/chính thức/);
 const tiny=await curveFixture({changes:{realQuoteReserves:new BN(1000)}}),state=await curveState(tiny.rpc,tiny.mint.toBase58());assert.throws(()=>curveRoundTrip(state,'50000000'),/độ sâu/);
 const complete=await curveFixture({changes:{complete:true}});assert.throws(()=>curveRoundTrip({...state,curve:complete.curve},'50000000'),/hoàn tất/);
});
test('curve build enforces 2% signal-price drift, actual roundtrip fees, and full/partial token sale amounts',async()=>{
 const f=await curveFixture();await assert.rejects(buildPumpCurve(f.rpc,{owner:f.user,input:SOL,output:f.mint.toBase58(),amount:'50000000',poolAddress:f.address.toBase58(),referencePriceSol:1}),/2%/);
 const sale=await curveFixture({buy:false}),e=new SolanaExecution();e.rpc=sale.rpc;const p=await e.prepare({ownerAddress:sale.user.toBase58(),input:sale.mint.toBase58(),output:SOL,amount:'500000000000',poolAddress:sale.address.toBase58(),venue:'pumpfun'});assert.equal(p.quote.inAmount,'500000000000');assert.ok(p.minNativeOutLamports>0n);
 const full=await e.prepare({ownerAddress:sale.user.toBase58(),input:sale.mint.toBase58(),output:SOL,amount:'1000000000000',poolAddress:sale.address.toBase58(),venue:'pumpfun',closeEmptyInput:true});assert.equal(full.closedInputAccount,sale.ata.toBase58());
});
test('a completed curve never auto-buys the migrated pool, but sells resolve only the canonical official PumpSwap pool',async()=>{
 const f=await curveFixture({changes:{complete:true}}),e=new SolanaExecution();e.rpc=f.rpc;await assert.rejects(e.curveRoute(f.mint.toBase58(),'BUY',f.address.toBase58()),/tín hiệu/);
 await assert.rejects(e.curveRoute(f.mint.toBase58(),'SELL',f.address.toBase58()),/Đang migrate/);
 const pool=canonicalPumpPoolPda(f.mint);f.map.set(pool.toBase58(),f.info(PUMP_PROGRAM,Buffer.alloc(0)));assert.deepEqual(await e.curveRoute(f.mint.toBase58(),'SELL',f.address.toBase58()),{venue:'pumpswap',poolAddress:pool.toBase58()});
});
test('curve allocation is 5% without reintroducing daily/streak pauses, and versioned receipts bind size to the venue',()=>{
 assert.equal(CURVE_RULES.orderFraction,.05);assert.equal(walletOrderSol(1,.05),.05);assert.equal(walletOrderSol(2,.05),.1);assert.equal(walletOrderSol(.05,.05),0);assert.equal(walletOrderSol(1),.2);
 const intent={sizingVersion:WALLET_SIZING_VERSION,walletBalanceLamports:1000000000,venue:'pumpfun',amount:'50000000'};assert.equal(validHistoricalBuy(intent),true);assert.equal(validHistoricalBuy({...intent,amount:'200000000'}),false);assert.equal(validHistoricalBuy({...intent,venue:'pumpswap'}),false);
});

test('a curve position can actually build and simulate its sale through the canonical migrated PumpSwap pool',async()=>{
 const curve=await curveFixture({changes:{complete:true}}),pool=await pumpFixture({user:curve.user,mint:curve.mint,buy:false});
 for(const [key,info]of curve.map)if(!pool.map.has(key))pool.map.set(key,info);
 pool.map.set(curve.address.toBase58(),curve.map.get(curve.address.toBase58()));pool.map.get(pool.pool.poolBaseTokenAccount.toBase58()).data.writeBigUInt64LE(100000000000n,64);
 const simulate=pool.rpc.simulateTransaction;pool.rpc.simulateTransaction=async(tx,config)=>{const result=await simulate(tx,config),ix=tx.message.compiledInstructions.find(i=>tx.message.staticAccountKeys[i.programIdIndex].equals(PUMP_PROGRAM)),decoded=OFFLINE_PUMP_AMM_PROGRAM.coder.instruction.decode(Buffer.from(ix.data));result.value.accounts[0].lamports=1000000000+Number(decoded.data.minQuoteAmountOut.toString())-20000;return result;};
 const e=new SolanaExecution();e.rpc=pool.rpc;const p=await e.prepare({ownerAddress:curve.user.toBase58(),input:curve.mint.toBase58(),output:SOL,amount:'100000000',poolAddress:curve.address.toBase58(),venue:'pumpfun'});
 assert.equal(p.venue,'pumpswap');assert.equal(p.poolAddress,canonicalPumpPoolPda(curve.mint).toBase58());assert.equal(p.quote.routePlan[0].swapInfo.label,'PumpSwap');assert.ok(p.minNativeOutLamports>0n);
});
