import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,VersionedTransaction,TransactionMessage,SystemProgram,TransactionInstruction} from '@solana/web3.js';
import bs58 from 'bs58';
import {DirectWallet,verifyOwnerTransaction} from '../src/direct-wallet.js';
import {createOwnerLedger,nextOwnerOrder,applyOwnerReceipt,ownerExit} from '../src/owner-ledger.js';
import {SolanaExecution,TOKEN} from '../src/solana.js';
import {SOL} from '../src/engine.js';
const kp=Keypair.generate(),owner=kp.publicKey.toBase58(),mint=Keypair.generate().publicKey.toBase58();
const market=()=>({mint,symbol:'TEST',priceUsd:1,updatedAt:Date.now(),dexId:'pumpswap',hasProfile:true,pairCreatedAt:Date.now()-86400000,valuationUsd:1000000,valuationSource:'marketCap',liquidityUsd:250000,volume24hUsd:1000000,volume5mUsd:10000,volume1hUsd:30000,change5mPct:3,change1hPct:10,change6hPct:20,change24hPct:30,buys5m:40,sells5m:5,signalConfirmed:true});
const unsigned=()=>new VersionedTransaction(new TransactionMessage({payerKey:kp.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:kp.publicKey,toPubkey:Keypair.generate().publicKey,lamports:30000000})]}).compileToV0Message());
const encode=tx=>Buffer.from(tx.serialize()).toString('base64');
function setup(){let sends=0,request;const execution={provider:'Helius',configureHelius(){},network:async()=>{},balance:async()=>10,holdings:async()=>[],mintCheck:async()=>{},height:async()=>100,prepare:async r=>{request=r;return {bytes:unsigned().serialize(),lastValidBlockHeight:200};},send:async bytes=>{sends++;return bs58.encode(VersionedTransaction.deserialize(bytes).signatures[0]);},status:async()=>({confirmationStatus:'confirmed'}),receipt:async()=>({slot:90,solDelta:-.0301,tokenDelta:3000000n,rawBalance:'999000000',decimals:6})};const desk=new DirectWallet(execution);desk.owner=owner;desk.configure({apiKey:'unit-jupiter-key'});return {desk,execution,get sends(){return sends;},get request(){return request;}};}
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
test('the real preparation path checks a simulated swap and returns an unsigned transaction for the owner',async()=>{
 const original=globalThis.fetch,execution=new SolanaExecution();
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:kp.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[new TransactionInstruction({programId:new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'),keys:[{pubkey:kp.publicKey,isSigner:true,isWritable:true}],data:Buffer.alloc(0)})]}).compileToV0Message());
 const tokenData=Buffer.alloc(165);new PublicKey(mint).toBuffer().copy(tokenData);kp.publicKey.toBuffer().copy(tokenData,32);tokenData.writeBigUInt64LE(3000000n,64);
 execution.network=async()=>{};execution.holdings=async()=>[];
 execution.rpc={getSlot:async()=>100,getFeeForMessage:async()=>({value:5000}),getMultipleAccountsInfo:async addresses=>{assert.equal(addresses.length,2);return [{owner:SystemProgram.programId,lamports:300000000,data:Buffer.alloc(0)},null];},simulateTransaction:async(unsigned,config)=>{assert.ok(unsigned.signatures[0].every(b=>b===0));assert.equal(config.sigVerify,false);return {value:{err:null,accounts:[{owner:SystemProgram.programId.toBase58(),lamports:269995000,data:['','base64'],executable:false},{owner:TOKEN.toBase58(),lamports:2039280,data:[tokenData.toString('base64'),'base64'],executable:false}]}};}};
 globalThis.fetch=async input=>{const url=new URL(input);let data;if(url.pathname.endsWith('/quote')){const buy=url.searchParams.get('inputMint')===SOL;data={inputMint:url.searchParams.get('inputMint'),outputMint:url.searchParams.get('outputMint'),inAmount:url.searchParams.get('amount'),outAmount:buy?'3000000':'30000000',otherAmountThreshold:buy?'2900000':'29900000',swapMode:'ExactIn',priceImpactPct:'0.001',slippageBps:150,routePlan:[{}],contextSlot:100};}else data={swapTransaction:encode(tx),lastValidBlockHeight:200,prioritizationFeeLamports:0};return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});};
 try{const prepared=await execution.prepare({ownerAddress:owner,apiKey:'unit-test-api-key',input:SOL,output:mint,amount:'30000000'});assert.equal(prepared.signature,null);const result=VersionedTransaction.deserialize(prepared.bytes);assert.ok(result.signatures[0].every(b=>b===0));assert.equal(result.message.staticAccountKeys[0].toBase58(),owner);}
 finally{globalThis.fetch=original;}
});
