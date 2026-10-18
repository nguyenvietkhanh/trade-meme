import {verifiedMarket} from './fixtures/verified-market.js';
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
const market=()=>verifiedMarket({mint,priceUsd:1,pairAddress:'11111111111111111111111111111112'});
const unsigned=()=>new VersionedTransaction(new TransactionMessage({payerKey:kp.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:kp.publicKey,toPubkey:Keypair.generate().publicKey,lamports:200000000})]}).compileToV0Message());
const encode=tx=>Buffer.from(tx.serialize()).toString('base64');
function setup(){let sends=0,request;const execution={provider:'Helius',configureHelius(){},network:async()=>{},balance:async()=>1,holdings:async()=>[],mintCheck:async()=>{},height:async()=>100,prepare:async r=>{request=r;return {bytes:unsigned().serialize(),lastValidBlockHeight:200};},send:async bytes=>{sends++;return bs58.encode(VersionedTransaction.deserialize(bytes).signatures[0]);},status:async()=>({confirmationStatus:'confirmed'}),receipt:async()=>({slot:90,solDelta:-.2001,tokenDelta:20000000n,rawBalance:'999000000',decimals:6})};const desk=new DirectWallet(execution);desk.owner=owner;return {desk,execution,get sends(){return sends;},get request(){return request;}};}
test('direct preparation uses the connected owner as payer, fixes buy size and needs no server signer or volume',async()=>{
 const f=setup(),result=await f.desk.prepare({side:'BUY',mint,amount:'999999999'},{markets:[market()],solUsd:100,updatedAt:Date.now()});
 assert.equal(f.request.ownerAddress,owner);assert.equal(f.request.keypair,undefined);assert.equal(f.request.amount,'200000000');assert.equal(f.sends,0);assert.equal(result.intent.owner,owner);
 const tx=VersionedTransaction.deserialize(Buffer.from(result.transaction,'base64'));assert.ok(tx.signatures[0].every(b=>b===0));assert.equal(tx.message.staticAccountKeys[0].toBase58(),owner);
 const status=await f.desk.status();assert.equal(status.balanceSol,1);assert.equal(status.walletMode,'owner');assert.equal(status.apiKey,undefined);
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
 const result=await restarted.reconcile({intent:prepared.intent,transaction});assert.equal(result.status,'confirmed');assert.equal(result.tokenDelta,'20000000');assert.equal(f.sends,0);
 const s=createOwnerLedger(owner,.3),pending={intent:prepared.intent,transaction};s.pending=pending;
 assert.equal(applyOwnerReceipt(s,pending,result),true);assert.equal(s.positions[0].rawQuantity,'20000000');assert.equal(s.trades.length,1);
 assert.equal(applyOwnerReceipt(s,pending,result),false);assert.equal(s.trades.length,1);assert.equal(s.pending,null);
});
test('main-wallet buy rejects a token already held and keeps native reserve even in a large main wallet',async()=>{
 const f=setup(),data=Buffer.alloc(165);new PublicKey(mint).toBuffer().copy(data);data.writeBigUInt64LE(1n,64);f.execution.holdings=async()=>[{account:{data}}];
 await assert.rejects(f.desk.prepare({side:'BUY',mint},{markets:[market()],solUsd:100,updatedAt:Date.now()}),/không trộn/);
 f.execution.holdings=async()=>[];f.execution.balance=async()=>.06;await assert.rejects(f.desk.prepare({side:'BUY',mint},{markets:[market()],solUsd:100,updatedAt:Date.now()}),/dự phòng/);assert.equal(f.sends,0);
});
test('owner ledger limits budget to 1.19 SOL, sells only app-owned units and counts actual failed fees',()=>{
 const s=createOwnerLedger(owner,10),m=market(),pending={intent:{owner,side:'BUY',mint,symbol:'TEST',priceUsd:1,solUsd:100,reason:'auto',amount:'30000000'}};
 assert.equal(s.cashSol,10);assert.equal(s.settings.initialSol,10);assert.throws(()=>createOwnerLedger(owner,NaN));
 assert.equal(nextOwnerOrder(s,{markets:[m],solUsd:100,updatedAt:Date.now()},10).orderSol,2);
 applyOwnerReceipt(s,pending,{status:'confirmed',signature:'buy',tokenDelta:'3000000',solDelta:-.0301,decimals:6});
 assert.equal(s.positions[0].rawQuantity,'3000000');assert.equal(ownerExit(s,mint,.5).amount,'1500000');
 const sell={intent:{...pending.intent,side:'SELL',reason:'runner-double'}};
 applyOwnerReceipt(s,sell,{status:'confirmed',signature:'sell',tokenDelta:'-1500000',solDelta:.03,decimals:6});assert.equal(s.positions[0].rawQuantity,'1500000');
 const before=s.cashSol;applyOwnerReceipt(s,pending,{status:'failed',signature:'failed',feeSol:.000005});assert.ok(Math.abs(s.cashSol-before+.000005)<1e-12);
});
test('the real preparation path builds a PumpSwap swap using RPC only, with no Jupiter key or request',async()=>{
 const fixture=await pumpFixture({user:kp.publicKey,mint:new PublicKey(mint)}),execution=new SolanaExecution();execution.rpc=fixture.rpc;
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('An HTTP swap service must never be used');};
 try{const prepared=await execution.prepare({ownerAddress:owner,poolAddress:fixture.poolKey.toBase58(),input:SOL,output:mint,amount:'200000000'});
  assert.equal(prepared.signature,null);const result=VersionedTransaction.deserialize(prepared.bytes);assert.ok(result.signatures[0].every(b=>b===0));assert.equal(result.message.staticAccountKeys[0].toBase58(),owner);assert.ok(prepared.bytes.length<=1232);assert.equal(prepared.quote.inAmount,'200000000');assert.equal(prepared.quote.routePlan[0].swapInfo.label,'PumpSwap');
 }finally{globalThis.fetch=original;}
});
test('stale entry feeds block BUY but allow a fresh on-chain SELL preparation',async()=>{
 const f=setup(),data=Buffer.alloc(165);new PublicKey(mint).toBuffer().copy(data);data.writeBigUInt64LE(1000000n,64);f.execution.holdings=async()=>[{account:{data}}];
 const feed={markets:[market()],solUsd:100,updatedAt:Date.now()-60000,error:'Dex offline'};
 await assert.rejects(f.desk.prepare({side:'BUY',mint},feed),/dữ liệu/);
 const sell=await f.desk.prepare({side:'SELL',mint,amount:'1000000',reason:'max-hold'},feed);assert.equal(sell.intent.side,'SELL');assert.equal(f.request.output,SOL);
});
test('the authoritative rank fixes a 0.2 SOL size even when a caller asks for more',async()=>{
 const f=setup(),m=market();m.hasProfile=false;m.sells5m=12;delete m.evidence.higherLows;delete m.evidence.pullback30mPct;delete m.evidence.greenCandleConfirmed;
 await assert.rejects(f.desk.prepare({side:'BUY',mint,orderSol:99},{markets:[m],solUsd:100,updatedAt:Date.now()}),/Số dư đã đổi/);const prepared=await f.desk.prepare({side:'BUY',mint},{markets:[m],solUsd:100,updatedAt:Date.now()});assert.equal(prepared.intent.amount,'200000000');assert.equal(f.request.amount,'200000000');
});
test('live entry binds the pool minimum output to a fresh Jupiter reference for the actual tier size',async()=>{
 const f=setup();let quotedAmount;f.execution.entryQuote=async(_mint,amount)=>{quotedAmount=amount;return {minOut:'1000',checkedAt:Date.now()};};
 await f.desk.prepare({side:'BUY',mint},{markets:[market()],solUsd:100,updatedAt:Date.now()});assert.equal(quotedAmount,'200000000');assert.equal(f.request.referenceMinOut,'1000');
});

test('each order reads only its own mint and never requires full-wallet token discovery',async()=>{
 const f=setup(),calls=[];f.execution.holdings=async(address,selectedMint)=>{calls.push({address,selectedMint});if(!selectedMint)throw Error('Full inventory unavailable');return [];};
 const result=await f.desk.prepare({side:'BUY',mint},{markets:[market()],solUsd:100,updatedAt:Date.now()});
 assert.equal(result.intent.side,'BUY');assert.deepEqual(calls,[{address:owner,selectedMint:mint}]);assert.equal(f.sends,0);
});
