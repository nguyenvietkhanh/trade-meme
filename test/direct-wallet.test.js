import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,VersionedTransaction,TransactionMessage,SystemProgram,TransactionInstruction} from '@solana/web3.js';
import bs58 from 'bs58';
import {DirectWallet,verifyOwnerTransaction} from '../src/direct-wallet.js';
import {createOwnerLedger,nextOwnerOrder,applyOwnerReceipt,ownerExit} from '../src/owner-ledger.js';
import {SolanaExecution,TOKEN} from '../src/solana.js';
import {SOL} from '../src/engine.js';
import {pumpFixture} from './fixtures/pump-rpc.js';
const kp=Keypair.generate(),owner=kp.publicKey.toBase58(),mint=Keypair.generate().publicKey.toBase58();
const market=()=>({mint,symbol:'TEST',priceUsd:1,updatedAt:Date.now(),dexId:'pumpswap',hasProfile:true,pairCreatedAt:Date.now()-86400000,valuationUsd:1000000,valuationSource:'marketCap',liquidityUsd:250000,volume24hUsd:1000000,volume5mUsd:10000,volume1hUsd:30000,change5mPct:3,change1hPct:10,change6hPct:20,change24hPct:30,buys5m:40,sells5m:5,signalConfirmed:true});
const unsigned=()=>new VersionedTransaction(new TransactionMessage({payerKey:kp.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:kp.publicKey,toPubkey:Keypair.generate().publicKey,lamports:30000000})]}).compileToV0Message());
const encode=tx=>Buffer.from(tx.serialize()).toString('base64');
function setup(){let sends=0,request;const execution={provider:'Helius',configureHelius(){},network:async()=>{},balance:async()=>10,holdings:async()=>[],mintCheck:async()=>{},height:async()=>100,prepare:async r=>{request=r;return {bytes:unsigned().serialize(),lastValidBlockHeight:200};},send:async bytes=>{sends++;return bs58.encode(VersionedTransaction.deserialize(bytes).signatures[0]);},status:async()=>({confirmationStatus:'confirmed'}),receipt:async()=>({slot:90,solDelta:-.0301,tokenDelta:3000000n,rawBalance:'999000000',decimals:6})};const desk=new DirectWallet(execution);desk.owner=owner;return {desk,execution,get sends(){return sends;},get request(){return request;}};}
test('direct preparation uses the connected owner as payer, fixes buy size and needs no server signer or volume',async()=>{
 const f=setup(),result=await f.desk.prepare({side:'BUY',mint,amount:'999999999'},{markets:[market()],solUsd:100,updatedAt:Date.now()});
 assert.equal(f.request.ownerAddress,owner);assert.equal(f.request.keypair,undefined);assert.equal(f.request.amount,'30000000');assert.equal(f.sends,0);assert.equal(result.intent.owner,owner);
 const tx=VersionedTransaction.deserialize(Buffer.from(result.transaction,'base64'));assert.ok(tx.signatures[0].every(b=>b===0));assert.equal(tx.message.staticAccountKeys[0].toBase58(),owner);
 const status=await f.desk.status();assert.equal(status.balanceSol,10);assert.equal(status.walletMode,'owner');assert.equal(status.apiKey,undefined);
});
test('only the exact owner-signed message is submitted, duplicate submits do not broadcast again',async()=>{
 const f=setup(),prepared=await f.desk.prepare({side:'BUY',mint},{markets:[market()],solUsd:100,updatedAt:Date.now()});
 await assert.rejects(f.desk.submit({id:prepared.intent.id,transaction:prepared.transaction}));assert.equal(f.sends,0);
 const wrong=unsigned();wrong.sign([kp]);await assert.rejects(f.desk.submit({id:prepared.intent.id,transaction:encode(wrong)}),/thay đổi/);assert.equal(f.sends,0);
 const tx=VersionedTransaction.deserialize(Buffer.from(prepared.transaction,'base64'));tx.sign([kp]);const transaction=encode(tx);
 await f.desk.submit({id:prepared.intent.id,transaction});await f.desk.submit({id:prepared.intent.id,transaction});assert.equal(f.sends,1);
 assert.throws(()=>verifyOwnerTransaction(transaction,Keypair.generate().publicKey.toBase58()),/đúng ví chủ/);
});
test('a signed pending transaction can be reconciled after a stateless server restart, never resent',async()=>{
 const f=setup(),prepared=await f.desk.prepare({side:'BUY',mint},{markets:[market()],solUsd:100,updatedAt:Date.now()});
 const tx=VersionedTransaction.deserialize(Buffer.from(prepared.transaction,'base64'));tx.sign([kp]);const transaction=encode(tx);
 const restarted=new DirectWallet(f.execution);restarted.owner=owner;
 const result=await restarted.reconcile({intent:prepared.intent,transaction});assert.equal(result.status,'confirmed');assert.equal(result.tokenDelta,'3000000');assert.equal(f.sends,0);
 const s=createOwnerLedger(owner,.3),pending={intent:prepared.intent,transaction};s.pending=pending;
 assert.equal(applyOwnerReceipt(s,pending,result),true);assert.equal(s.positions[0].rawQuantity,'3000000');assert.equal(s.trades.length,1);
 assert.equal(applyOwnerReceipt(s,pending,result),false);assert.equal(s.trades.length,1);assert.equal(s.pending,null);
});
test('main-wallet buy rejects a token already held and keeps native reserve even in a large main wallet',async()=>{
 const f=setup(),data=Buffer.alloc(165);new PublicKey(mint).toBuffer().copy(data);data.writeBigUInt64LE(1n,64);f.execution.holdings=async()=>[{account:{data}}];
 await assert.rejects(f.desk.prepare({side:'BUY',mint},{markets:[market()],solUsd:100,updatedAt:Date.now()}),/không trộn/);
 f.execution.holdings=async()=>[];f.execution.balance=async()=>.06;await assert.rejects(f.desk.prepare({side:'BUY',mint},{markets:[market()],solUsd:100,updatedAt:Date.now()}),/dự phòng/);assert.equal(f.sends,0);
});
test('owner ledger limits budget to 0.3 SOL, sells only app-owned units and counts actual failed fees',()=>{
 const s=createOwnerLedger(owner,10),m=market(),pending={intent:{owner,side:'BUY',mint,symbol:'TEST',priceUsd:1,solUsd:100,reason:'auto'}};
 assert.equal(s.cashSol,.3);assert.equal(s.settings.initialSol,.3);assert.throws(()=>createOwnerLedger(owner,.03));
 assert.equal(nextOwnerOrder(s,{markets:[m],solUsd:100,updatedAt:Date.now()},10).side,'BUY');
 applyOwnerReceipt(s,pending,{status:'confirmed',signature:'buy',tokenDelta:'3000000',solDelta:-.0301,decimals:6});
 assert.equal(s.positions[0].rawQuantity,'3000000');assert.equal(ownerExit(s,mint,.5).amount,'1500000');
 const sell={intent:{...pending.intent,side:'SELL',reason:'runner-double'}};
 applyOwnerReceipt(s,sell,{status:'confirmed',signature:'sell',tokenDelta:'-1500000',solDelta:.03,decimals:6});assert.equal(s.positions[0].rawQuantity,'1500000');
 const before=s.cashSol;applyOwnerReceipt(s,pending,{status:'failed',signature:'failed',feeSol:.000005});assert.ok(Math.abs(s.cashSol-before+.000005)<1e-12);
});
test('the real preparation path builds a PumpSwap swap using RPC only, with no Jupiter key or request',async()=>{
 const fixture=await pumpFixture({user:kp.publicKey,mint:new PublicKey(mint)}),execution=new SolanaExecution();execution.rpc=fixture.rpc;
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('An HTTP swap service must never be used');};
 try{const prepared=await execution.prepare({ownerAddress:owner,poolAddress:fixture.poolKey.toBase58(),input:SOL,output:mint,amount:'30000000'});
  assert.equal(prepared.signature,null);const result=VersionedTransaction.deserialize(prepared.bytes);assert.ok(result.signatures[0].every(b=>b===0));assert.equal(result.message.staticAccountKeys[0].toBase58(),owner);assert.ok(prepared.bytes.length<=1232);assert.equal(prepared.quote.inAmount,'30000000');assert.equal(prepared.quote.routePlan[0].swapInfo.label,'PumpSwap');
 }finally{globalThis.fetch=original;}
});
