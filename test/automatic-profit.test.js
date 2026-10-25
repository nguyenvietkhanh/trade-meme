import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';
import {Keypair,PublicKey,SystemProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {AutomaticTreasury} from '../src/automatic-treasury.js';
import {earnedAIProfit} from '../src/automatic-profit.js';
import {PROFIT_RECIPIENT} from '../src/desk-rules.js';
import {aiBuyLimit} from '../src/autonomous-policy.js';
async function fixture(t){
 const dir=await mkdtemp(path.join(tmpdir(),'ai-profit-')),kp=Keypair.generate(),owner=kp.publicKey.toBase58();t.after(()=>rm(dir,{recursive:true,force:true}));let treasury,balance=1,receipt=null,sends=0,badRecipient=false,height=10;
 const execution={network:async()=>{},balance:async()=>balance,holdings:async()=>[],prepareAIProfit:async(_,amount)=>({bytes:new VersionedTransaction(new TransactionMessage({payerKey:kp.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:kp.publicKey,toPubkey:badRecipient?Keypair.generate().publicKey:new PublicKey(PROFIT_RECIPIENT),lamports:amount})]}).compileToV0Message()).serialize(),lastValidBlockHeight:99}),send:async bytes=>{sends++;const tx=VersionedTransaction.deserialize(bytes),saved=JSON.parse(await readFile(treasury.file,'utf8'));assert.equal(saved.aiProfit.pending.signature,bs58.encode(tx.signatures[0]));throw Error('Ambiguous RPC timeout');},status:async()=>receipt?{confirmationStatus:'confirmed'}:null,height:async()=>height,profitReceipt:async()=>receipt};
 const options={owner,legacyDir:dir,signerEnv:{LIVE_SIGNER_SECRET_KEY:bs58.encode(kp.secretKey)}};treasury=new AutomaticTreasury(dir,execution,options);await treasury.load();await treasury.connect();
 return {get tr(){return treasury;},get sends(){return sends;},set balance(x){balance=x;},set receipt(x){receipt=x;},set badRecipient(x){badRecipient=x;},set height(x){height=x;},reload:async()=>{treasury=new AutomaticTreasury(dir,execution,options);await treasury.load();return treasury;}};
}
test('AI buy cap is 90% and gas / execution buffer / earned profit take priority',()=>{assert.equal(aiBuyLimit(20e9,19.945e9),18e9);assert.equal(aiBuyLimit(100e6,45e6),45e6);assert.equal(aiBuyLimit(50e6,0),0);});
test('only realized incremental net profits transfer; signed payout survives restart/ambiguous send without double transfer',async t=>{
 const f=await fixture(t);await f.tr.sweepProfit();assert.equal(f.sends,0);
 f.tr.s.realizedPnlSol=.01;await f.tr.save();assert.equal(f.tr.status().availableSol,.9,'90% cap precedes spendable limit');
 await f.tr.sweepProfit();assert.equal(f.sends,1);assert.equal(f.tr.s.aiProfit.pending.status,'unknown');const amount=f.tr.s.aiProfit.pending.amount;assert.equal(amount,'9990000');
 const reloaded=await f.reload();await reloaded.sweepProfit();assert.equal(f.sends,1);assert.ok(reloaded.s.aiProfit.pending);
 const fee=.000005;f.balance=1-Number(amount)/1e9-fee;f.receipt={recipient:PROFIT_RECIPIENT,amountLamports:amount,feeSol:fee,solDelta:-Number(amount)/1e9-fee,slot:20};await reloaded.sweepProfit();
 assert.equal(reloaded.s.aiProfit.pending,null);assert.equal(reloaded.s.aiProfit.paidLamports,9990000);assert.equal(reloaded.s.aiProfit.feeLamports,5000);assert.equal(reloaded.s.telegramOutbox.at(-1).id.startsWith('profit:'),true);await reloaded.sync();assert.equal(reloaded.s.netDepositsSol,0,'profit withdrawal is not a deposit adjustment');assert.equal(earnedAIProfit(reloaded.s),5000);await reloaded.sweepProfit();assert.equal(f.sends,1);
});
test('profit transfer cannot touch gas or change the fixed recipient, and open appreciation never pays out',async t=>{
 const f=await fixture(t);f.tr.s.positions=[{costSol:1}];await f.tr.sweepProfit();assert.equal(f.sends,0);f.tr.s.positions=[];f.tr.s.realizedPnlSol=.02;f.balance=.05;await f.tr.sweepProfit();assert.equal(f.sends,0);f.balance=1;f.badRecipient=true;await f.tr.sweepProfit();assert.equal(f.sends,0);assert.equal(f.tr.s.aiProfit.error,'LIVE_PROFIT_TRANSACTION_INVALID');assert.equal(f.tr.s.aiProfit.pending,null);
});
test('parent rechecks 90% against the actual wallet and persists AI stop updates without moving money',async t=>{
 const f=await fixture(t),now=Date.now(),market={mint:'mint',pairAddress:'pool',marketCapUsd:10000,change5mPct:20,updatedAt:now};
 await assert.rejects(f.tr.request({id:'live:kade:cap',side:'BUY',aiOnly:true,aiStopLossPct:10,aiRiskAssessment:{approved:true,reason:'Fixture risk accepted',risks:[],unknowns:['holders']},mint:'mint',pairAddress:'pool',amount:'910000000',decisionAt:now-3000,readyAt:now-1000},market,'kade'),{code:'LIVE_CAPITAL_CHANGED'});assert.equal(f.sends,0);
 f.tr.s.positions=[{agentId:'kade',paperPositionId:'lot',mint:'mint',pairAddress:'pool',rawQuantity:'100',costSol:.1}];await f.tr.request({side:'SET_STOP',positionId:'lot',mint:'mint',aiStopLossPct:13},market,'kade');assert.equal(f.tr.s.positions[0].aiStopLossPct,13);assert.equal(f.tr.s.trades.length,0);assert.equal(f.sends,0);
 const loaded=await f.reload();assert.equal(loaded.s.positions[0].aiStopLossPct,13);
});
test('invalid profit receipt leaves cash and paid entitlement unchanged; an expired unknown transfer may be retried',async t=>{
 const f=await fixture(t);f.tr.s.realizedPnlSol=.02;await f.tr.sweepProfit();const amount=f.tr.s.aiProfit.pending.amount;
 f.receipt={recipient:Keypair.generate().publicKey.toBase58(),amountLamports:amount,feeSol:.000005,solDelta:-Number(amount)/1e9-.000005,slot:20};await f.tr.sweepProfit();assert.equal(f.tr.s.cashSol,1);assert.equal(f.tr.s.aiProfit.paidLamports,0);assert.ok(f.tr.s.aiProfit.pending);assert.equal(f.tr.s.aiProfit.error,'LIVE_PROFIT_RECEIPT_INVALID');assert.equal(f.sends,1);
 f.receipt=null;f.height=100;await f.tr.sweepProfit();assert.equal(f.tr.s.aiProfit.pending,null);assert.equal(f.tr.s.aiProfit.payouts[0].status,'expired');assert.equal(f.tr.s.aiProfit.paidLamports,0);
});
