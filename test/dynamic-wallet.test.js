import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {Keypair,TransactionMessage,VersionedTransaction,SystemProgram} from '@solana/web3.js';
import {walletOrderSol,validHistoricalBuy,WALLET_SIZING_VERSION,LEGACY_WALLET_SIZING_VERSION} from '../src/desk-rules.js';
import {createOwnerLedger,allocateOwnerCapital,nextOwnerOrder,applyOwnerReceipt} from '../src/owner-ledger.js';
import {equity,riskCheck,recordBuy,SOL} from '../src/engine.js';
import {DirectWallet} from '../src/direct-wallet.js';
import {OwnerAgent} from '../src/owner-agent.js';
import {SolanaExecution} from '../src/solana.js';
import {verifiedMarket} from './fixtures/verified-market.js';
import {pumpFixture} from './fixtures/pump-rpc.js';
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,`${actual} != ${expected}`);

test('mainnet orders cap at 0.6 SOL and adapt to available native balance and never consume reserve or estimated overhead',()=>{
 for(const [balance,size]of [[1,.6],[2,.6],[.705,.6],[.704999999,.599999999],[.5,.395],[.3,.195],[.2,.095],[.105,0],[.1,0],[0,0],[NaN,0]])assert.equal(walletOrderSol(balance),size);
 assert.equal(walletOrderSol(1.000000009),.6);
 const s=createOwnerLedger('owner',10);assert.equal(s.cashSol,10);assert.equal(s.settings.initialSol,10);assert.equal(s.settings.orderSol,.6);
 const feed={solUsd:100,updatedAt:Date.now(),markets:[verifiedMarket()]};assert.equal(nextOwnerOrder(s,feed,10).orderSol,.6);
 assert.equal(createOwnerLedger('owner',0).settings.orderSol,0);
});
test('uncapped top-ups and outside withdrawals update cash/size without fabricating PnL or clearing risk flags',()=>{
 const s=createOwnerLedger('owner',1);s.cashSol=.9;s.realizedNetSol=-.1;s.buyPaused=true;
 near(allocateOwnerCapital(s,2),1.1);near(s.settings.initialSol,2.1);assert.equal(s.settings.orderSol,.6);near(equity(s,[],100)-s.settings.initialSol,-.1);
 near(allocateOwnerCapital(s,.5),-1.5);assert.equal(s.settings.orderSol,.395);near(s.externalWithdrawnSol,1.5);near(equity(s,[],100)-s.settings.initialSol,-.1);assert.equal(s.buyPaused,true);riskCheck(s,[],100);assert.equal(s.halted,null);
 const before=structuredClone(s);s.pending={signature:'unknown'};const pending=structuredClone(s);assert.equal(allocateOwnerCapital(s,5),0);assert.deepEqual(s,pending);s.pending=null;assert.equal(s.realizedNetSol,before.realizedNetSol);
});
test('fresh actual-size quotes are mandatory, and a changed balance cannot silently resize a planned order',async()=>{
 const kp=Keypair.generate(),mint=Keypair.generate().publicKey.toBase58(),m=verifiedMarket({mint}),owner=kp.publicKey.toBase58();let prepared=0,quoted;
 const execution={balance:async()=>2,holdings:async()=>[],mintCheck:async()=>{},roundTripQuote:async(_mint,amount)=>{quoted=amount;return {...m.evidence,probeSol:Number(amount)/1e9};},prepare:async request=>{prepared++;assert.equal(request.amount,'600000000');return {bytes:new VersionedTransaction(new TransactionMessage({payerKey:kp.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:kp.publicKey,toPubkey:Keypair.generate().publicKey,lamports:600000000})]}).compileToV0Message()).serialize(),lastValidBlockHeight:200};}};
 const desk=new DirectWallet(execution);desk.owner=owner;const feed={markets:[m],solUsd:100,updatedAt:Date.now()};
 await assert.rejects(desk.prepare({side:'BUY',mint,orderSol:.2},feed),e=>e.code==='BALANCE_CHANGED');assert.equal(prepared,0);
 execution.roundTripQuote=async()=>({...m.evidence,probeSol:.6,roundTripLossPct:7});await assert.rejects(desk.prepare({side:'BUY',mint},feed),/Quote vòng/);assert.equal(prepared,0);
 execution.roundTripQuote=async(_mint,amount)=>{quoted=amount;return {...m.evidence,probeSol:.6};};const result=await desk.prepare({side:'BUY',mint,orderSol:.6},feed);
 assert.equal(quoted,'600000000');assert.equal(result.intent.amount,'600000000');assert.equal(result.intent.walletBalanceLamports,2000000000);assert.equal(validHistoricalBuy(result.intent),true);assert.equal(prepared,1);
});
test('historical fixed-size intents remain reconcilable, but arbitrary dynamic amounts need bound sizing metadata',()=>{
 assert.equal(validHistoricalBuy({amount:'30000000'}),true);assert.equal(validHistoricalBuy({amount:'200000000'}),true);assert.equal(validHistoricalBuy({amount:'600000000'}),false);
 assert.equal(validHistoricalBuy({amount:'600000000',sizingVersion:WALLET_SIZING_VERSION,walletBalanceLamports:2000000000}),true);
 assert.equal(validHistoricalBuy({amount:'600000000',sizingVersion:WALLET_SIZING_VERSION,walletBalanceLamports:500000000}),false);
 assert.equal(validHistoricalBuy({amount:'395000000',sizingVersion:WALLET_SIZING_VERSION,walletBalanceLamports:500000000}),true);
 assert.equal(validHistoricalBuy({amount:'400000000',sizingVersion:LEGACY_WALLET_SIZING_VERSION,walletBalanceLamports:2000000000}),true);
});
test('the real SDK execution guard accepts 0.6 SOL from 2 SOL and rejects an outdated 0.2 SOL request',async()=>{
 const f=await pumpFixture({walletLamports:2000000000}),execution=new SolanaExecution();execution.rpc=f.rpc;
 const request={ownerAddress:f.user.toBase58(),poolAddress:f.poolKey.toBase58(),input:SOL,output:f.mint.toBase58(),amount:'600000000'};
 await assert.rejects(execution.prepare(request),/6%/);f.map.get(f.pool.poolQuoteTokenAccount.toBase58()).data.writeBigUInt64LE(1000000000000n,64);assert.equal((await execution.prepare(request)).quote.inAmount,'600000000');await assert.rejects(execution.prepare({...request,amount:'200000000'}),/trần 0,6 SOL/);
});
test('after a confirmed receipt, capital synchronization requests a balance at least as new as that receipt slot',async()=>{
 const dir=await mkdtemp('/tmp/meme-wallet-slot-');try{
  const kp=Keypair.generate(),owner=kp.publicKey.toBase58(),mint=Keypair.generate().publicKey.toBase58(),s=createOwnerLedger(owner,1),m=verifiedMarket({mint,priceUsd:1});
  applyOwnerReceipt(s,{intent:{owner,side:'BUY',mint,symbol:'T',amount:'200000000',solUsd:100,priceUsd:1}},{status:'confirmed',signature:'slot-bound',slot:123,tokenDelta:'20000000',solDelta:-.2001,decimals:6});
  let readSlot;const execution={balance:async(_owner,slot)=>{readSlot=slot;assert.equal(slot,123);return .7999;},holdings:async()=>[]};
  const agent=new OwnerAgent(dir,{},execution,owner);agent.state=s;s.running=true;agent.vault.keypair=kp;await agent.tick({markets:[m],solUsd:100,updatedAt:Date.now()});
  assert.equal(readSlot,123);assert.equal(s.settings.initialSol,1);assert.equal(s.capitalAllocations,undefined);near(s.cashSol,.7999);assert.equal(s.positions.length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('journals above the old capital cap and a zero-balance journal restore and restart without losing history',async()=>{
 const dir=await mkdtemp('/tmp/meme-large-wallet-');try{
  const owner=Keypair.generate().publicKey.toBase58(),s=createOwnerLedger(owner,20),m=verifiedMarket({priceUsd:1});
  recordBuy(s,m,100,{quantity:400,costSol:4.0001,priceUsd:1,rawQuantity:'400000000',decimals:6,signature:'large-fixture'},Date.now(),'fixture','live');
  const agent=new OwnerAgent(dir,{}, {},owner);await agent.restore(s);const restarted=new OwnerAgent(dir,{}, {},owner);await restarted.load();
  assert.equal(restarted.state.settings.initialSol,20);near(restarted.state.cashSol,15.9999);assert.equal(restarted.state.positions[0].rawQuantity,'400000000');assert.equal(restarted.state.trades[0].signature,'large-fixture');assert.equal(restarted.state.running,false);
  await agent.restore(createOwnerLedger(owner,0));const empty=new OwnerAgent(dir,{}, {},owner);await empty.load();assert.equal(empty.state.settings.initialSol,0);assert.equal(empty.state.settings.orderSol,0);riskCheck(empty.state,[],100);assert.equal(empty.state.halted,null);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('adaptive smaller orders use fresh actual-size quotes and refuse an earlier plan after a withdrawal',async()=>{
 const kp=Keypair.generate(),mint=Keypair.generate().publicKey.toBase58(),m=verifiedMarket({mint}),owner=kp.publicKey.toBase58();let balance=.5,quotes=[],prepares=0;
 const execution={balance:async()=>balance,holdings:async()=>[],mintCheck:async()=>{},roundTripQuote:async(_mint,amount)=>{quotes.push(amount);return {...m.evidence,quoteCheckedAt:Date.now(),probeSol:Number(amount)/1e9};},prepare:async r=>{prepares++;assert.equal(r.amount,'395000000');return {bytes:new VersionedTransaction(new TransactionMessage({payerKey:kp.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:kp.publicKey,toPubkey:Keypair.generate().publicKey,lamports:Number(r.amount)})]}).compileToV0Message()).serialize(),lastValidBlockHeight:200};}};
 const desk=new DirectWallet(execution);desk.owner=owner;const feed={markets:[m],solUsd:100,updatedAt:Date.now()};
 const result=await desk.prepare({side:'BUY',mint,orderSol:.395},feed);assert.equal(result.intent.amount,'395000000');assert.equal(validHistoricalBuy(result.intent),true);assert.deepEqual(quotes,['395000000']);
 desk.cancel(result.intent.id);balance=.2;await assert.rejects(desk.prepare({side:'BUY',mint,orderSol:.395},feed),e=>e.code==='BALANCE_CHANGED');assert.equal(prepares,1);
 balance=.105;await assert.rejects(desk.prepare({side:'BUY',mint},feed),/dự phòng/);assert.equal(prepares,1);
});
test('SDK simulation preserves 0.1 SOL gas even for an almost fully allocated small wallet',async()=>{
 const f=await pumpFixture({walletLamports:500000000}),execution=new SolanaExecution();execution.rpc=f.rpc;
 f.map.get(f.pool.poolQuoteTokenAccount.toBase58()).data.writeBigUInt64LE(1000000000000n,64);
 const r={ownerAddress:f.user.toBase58(),poolAddress:f.poolKey.toBase58(),input:SOL,output:f.mint.toBase58(),amount:'395000000'};
 assert.equal((await execution.prepare(r)).quote.inAmount,'395000000');
 const original=f.rpc.simulateTransaction;f.rpc.simulateTransaction=async(...args)=>{const sim=await original(...args);sim.value.accounts[0].lamports=99999999;return sim;};
 await assert.rejects(execution.prepare(r),/dự phòng|giới hạn/);
});
