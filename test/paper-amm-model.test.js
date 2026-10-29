import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey,SystemProgram} from '@solana/web3.js';
import {PUMP_AMM_FEE_CONFIG_PDA} from '@pump-fun/pump-swap-sdk';
import {PaperPoolReader} from '../src/paper-amm-model.js';
import {pumpFixture} from './fixtures/pump-rpc.js';
test('AMM fallback uses real SDK fees/reserves, exact raw amounts and updates a 90% price collapse',async()=>{
 const f=await pumpFixture();let now=100000;const m={mint:f.mint.toBase58(),pairAddress:f.poolKey.toBase58(),dexId:'pumpswap'},reader=new PaperPoolReader(f.rpc,{clock:()=>now});
 const q=await reader.quote({mint:m.mint,side:'BUY',amount:'50000000',minObservedAt:now},m);assert.equal(q.quoteSource,'model');assert.equal(q.quote.inAmount,'50000000');assert.ok(BigInt(q.quote.outAmount)>0n);assert.ok(q.roundTripLossPct>=0);assert.ok(Number.isInteger(q.decimals));
 const initial=reader.prices([m])[0];assert.equal(initial.priceAt,now);const vault=f.map.get(f.pool.poolQuoteTokenAccount.toBase58());vault.data.writeBigUInt64LE(vault.data.readBigUInt64LE(64)/10n,64);now+=2000;await reader.refresh([m]);const after=reader.prices([m])[0];assert.ok(after.spotPriceSol<initial.spotPriceSol*.11);assert.equal(after.priceAt,now);
 const sell=await reader.quote({mint:m.mint,side:'SELL',amount:q.quote.outAmount,minObservedAt:now},m);assert.ok(BigInt(sell.quote.outAmount)<5000000n);
});
test('model refuses wrong pool owner, missing fee accounts, unsupported token program and stale metadata',async()=>{
 const f=await pumpFixture(),m={mint:f.mint.toBase58(),pairAddress:f.poolKey.toBase58(),dexId:'pumpswap'};const request={mint:m.mint,side:'BUY',amount:'50000000',minObservedAt:1000};
 const fees=f.map.get(PUMP_AMM_FEE_CONFIG_PDA.toBase58());f.map.delete(PUMP_AMM_FEE_CONFIG_PDA.toBase58());await assert.rejects(new PaperPoolReader(f.rpc,{clock:()=>1000}).quote(request,m),/ownership/);f.map.set(PUMP_AMM_FEE_CONFIG_PDA.toBase58(),fees);
 f.map.get(f.poolKey.toBase58()).owner=SystemProgram.programId;await assert.rejects(new PaperPoolReader(f.rpc,{clock:()=>1000}).quote(request,m),/ownership/);
 const f2=await pumpFixture(),m2={...m,mint:f2.mint.toBase58(),pairAddress:f2.poolKey.toBase58()};f2.map.get(f2.mint.toBase58()).owner=new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');await assert.rejects(new PaperPoolReader(f2.rpc,{clock:()=>1000}).quote({...request,mint:m2.mint},m2),/token programs/);
});

test('RPC bootstrap overload backs off across pools without fabricating fresh reserve prices',async()=>{
 let now=100000,calls=0;const reader=new PaperPoolReader({}, {clock:()=>now,bootstrapIntervalMs:5000}),rows=[{mint:'one',pairAddress:'one',dexId:'pumpswap'},{mint:'two',pairAddress:'two',dexId:'pumpswap'}];
 reader.ensure=async()=>{calls++;throw Object.assign(Error('RPC_UNAVAILABLE'),{code:'RPC_UNAVAILABLE',retryAt:now+60000});};
 assert.deepEqual(await reader.refresh(rows),[]);assert.equal(calls,1);now+=5001;assert.deepEqual(await reader.refresh(rows),[]);assert.equal(calls,1);now+=55000;await reader.refresh(rows);assert.equal(calls,2);
});

test('deterministically unsupported token programs are rejected without repeated SDK/RPC bootstrap',async()=>{
 const f=await pumpFixture(),m={mint:f.mint.toBase58(),pairAddress:f.poolKey.toBase58(),dexId:'pumpswap'};let now=100000,reads=0;const original=f.rpc.getMultipleAccountsInfo.bind(f.rpc);f.rpc.getMultipleAccountsInfo=async(...args)=>{reads++;return original(...args);};f.map.get(f.mint.toBase58()).owner=new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');const reader=new PaperPoolReader(f.rpc,{clock:()=>now});
 await assert.rejects(reader.ensure(m),/token programs/);const initial=reads;assert.ok(initial>0);
 for(let i=0;i<100;i++)await assert.rejects(reader.ensure(m),e=>e.cachedReadRejection===true);
 assert.equal(reads,initial);assert.deepEqual(reader.prices([m]),[]);now+=600001;await assert.rejects(reader.ensure(m),/token programs/);assert.ok(reads>initial);
});
