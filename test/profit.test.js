import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,VersionedTransaction,PublicKey,SystemProgram,SystemInstruction} from '@solana/web3.js';
import {availableProfitLamports,profitOrder,PROFIT_RECIPIENT} from '../src/profit.js';
import {createOwnerLedger,applyOwnerReceipt} from '../src/owner-ledger.js';
import {equity,riskCheck,recordBuy,recordSell} from '../src/engine.js';
import {SolanaExecution} from '../src/solana.js';
import {DirectWallet} from '../src/direct-wallet.js';
const kp=Keypair.generate(),owner=kp.publicKey.toBase58();
const profitable=()=>({cashSol:.32,initialSol:.3,realizedNetSol:.02,withdrawnSol:0,payoutFeesSol:0});
test('only realized cash above the initial budget can be paid; principal, unrealized profit and fees stay reserved',()=>{
 assert.equal(availableProfitLamports(profitable(),.32),19990000);
 for(const s of [{...profitable(),realizedNetSol:0},{...profitable(),cashSol:.3},{...profitable(),realizedNetSol:-.1},{...profitable(),withdrawnSol:.02},{...profitable(),initialSol:NaN}])assert.equal(availableProfitLamports(s,1),0);
 assert.equal(availableProfitLamports(profitable(),.05),0);assert.equal(availableProfitLamports(profitable(),.29),0);assert.equal(availableProfitLamports({...profitable(),cashSol:.301},.301),0);
 assert.equal(availableProfitLamports({...profitable(),withdrawnSol:.01,payoutFeesSol:.000005},.32),9985000);
});
test('confirmed profit distributions keep total return/drawdown accurate and are not duplicated after reconciliation',()=>{
 const s=createOwnerLedger(owner,.3);s.cashSol=.32;s.realizedNetSol=.02;const order=profitOrder(s,.32);assert.equal(order.recipient,PROFIT_RECIPIENT);
 const pending={intent:{...order,owner}},result={status:'confirmed',signature:'profit-confirmed',recipient:PROFIT_RECIPIENT,amountLamports:order.amount,solDelta:-Number(order.amount)/1e9-.000005,feeSol:.000005};
 assert.equal(applyOwnerReceipt(s,pending,result),true);assert.equal(applyOwnerReceipt(s,pending,result),false);assert.equal(s.payouts.length,1);assert.ok(Math.abs(equity(s,[],100)-.319995)<1e-12);assert.equal(s.trades.length,0);assert.equal(profitOrder(s,.3),null);riskCheck(s,[],100);assert.equal(s.halted,null);assert.ok(s.cashSol>=.3);
 assert.throws(()=>applyOwnerReceipt(s,{intent:order},{...result,signature:'wrong',recipient:owner}),/khớp/);
});
test('entry cost and losing trades must be recovered before distributing later gains',()=>{
 const s=createOwnerLedger(owner,.3),m={mint:'token',symbol:'T',priceUsd:1};recordBuy(s,m,100,{quantity:3,costSol:.032,priceUsd:1});recordSell(s,m,100,{quantity:3,proceedsSol:.02,priceUsd:1,closed:true});assert.equal(profitOrder(s,.288),null);
 recordBuy(s,m,100,{quantity:3,costSol:.032,priceUsd:1});recordSell(s,m,100,{quantity:3,proceedsSol:.05,priceUsd:1,closed:true});const p=profitOrder(s,.306);assert.ok(Number(p.amount)<6000000);assert.equal(p.recipient,PROFIT_RECIPIENT);
});
test('profit transfer uses one owner signature and a fixed destination; confirmed receipts must match exact debit and credit',async()=>{
 const e=new SolanaExecution(),blockhash=Keypair.generate().publicKey.toBase58();e.network=async()=>{};
 e.rpc={getBalance:async()=>320000000,getLatestBlockhash:async()=>({blockhash,lastValidBlockHeight:200}),getFeeForMessage:async()=>({value:5000}),simulateTransaction:async()=>({value:{err:null}})};
 const p=await e.prepareProfit(owner,19990000,.3),tx=VersionedTransaction.deserialize(p.bytes);assert.equal(tx.message.header.numRequiredSignatures,1);assert.ok(tx.signatures[0].every(n=>n===0));const decompiled=(await import('@solana/web3.js')).TransactionMessage.decompile(tx.message);const transfer=SystemInstruction.decodeTransfer(decompiled.instructions[0]);assert.equal(transfer.toPubkey.toBase58(),PROFIT_RECIPIENT);assert.equal(transfer.lamports,19990000n);
 e.rpc.getParsedTransaction=async()=>({slot:20,transaction:{message:{accountKeys:[{pubkey:kp.publicKey},{pubkey:new PublicKey(PROFIT_RECIPIENT)}],instructions:[{program:'system',parsed:{type:'transfer',info:{source:owner,destination:PROFIT_RECIPIENT,lamports:19990000}}}]}},meta:{fee:5000,preBalances:[320000000,0],postBalances:[300005000,19990000]}});
 const receipt=await e.profitReceipt('test',owner,'19990000');assert.equal(receipt.amountLamports,'19990000');assert.equal(receipt.feeSol,.000005);await assert.rejects(e.profitReceipt('test',owner,'19990001'),/khớp/);
 const desk=new DirectWallet(e);desk.owner=owner;e.balance=async()=>.32;const r=await desk.prepare({side:'PROFIT',amount:'19990000',recipient:PROFIT_RECIPIENT,profitState:profitable()},{});assert.equal(r.intent.side,'PROFIT');assert.equal(r.intent.recipient,PROFIT_RECIPIENT);
 const signed=VersionedTransaction.deserialize(Buffer.from(r.transaction,'base64'));signed.sign([kp]);e.status=async()=>({confirmationStatus:'confirmed'});const recovered=new DirectWallet(e);recovered.owner=owner;const reconciled=await recovered.reconcile({intent:r.intent,transaction:Buffer.from(signed.serialize()).toString('base64')});assert.equal(reconciled.recipient,PROFIT_RECIPIENT);assert.equal(reconciled.status,'confirmed');
});
test('capital recovered from one winning position can be distributed while other positions stay open',()=>{
 const s=createOwnerLedger(owner,.3),a={mint:'a',symbol:'A',priceUsd:1},b={mint:'b',symbol:'B',priceUsd:1};
 recordBuy(s,a,100,{quantity:30,costSol:.03,priceUsd:.1});recordBuy(s,b,100,{quantity:30,costSol:.03,priceUsd:.1});
 recordSell(s,a,100,{quantity:30*7/9,proceedsSol:.042,priceUsd:.18,closed:false},Date.now(),'recover-capital');
 const p=profitOrder(s,s.cashSol);assert.ok(p);assert.ok(Math.abs(Number(p.amount)-11990000)<=1);assert.equal(s.positions.length,2);assert.ok(s.cashSol<.3);
});
