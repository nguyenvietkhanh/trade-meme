import {VersionedTransaction,TransactionMessage,SystemInstruction,SystemProgram} from '@solana/web3.js';
import bs58 from 'bs58';
import {PROFIT_RECIPIENT,HISTORICAL_PROFIT_RECIPIENTS} from './desk-rules.js';
import {AI_POLICY} from './autonomous-policy.js';
import {verifyOwnerTransaction} from './direct-wallet.js';
const fail=code=>Object.assign(Error(code),{code});
const atomic=x=>{const n=Math.round(x*1e9);if(!Number.isSafeInteger(n))throw fail('LIVE_PROFIT_ACCOUNTING_INVALID');return n;};
export function initAIProfit(s,now){
 if(!s.aiProfit)s.aiProfit={version:1,startedAt:now,baselineLamports:atomic(s.realizedPnlSol??0),paidLamports:0,feeLamports:0,sequence:0,pending:null,payouts:[],error:null,retryAt:0};
 const p=s.aiProfit;if(p.version!==1||!Number.isSafeInteger(p.baselineLamports)||!['paidLamports','feeLamports','sequence'].every(k=>Number.isSafeInteger(p[k])&&p[k]>=0)||!Array.isArray(p.payouts))throw fail('LIVE_PROFIT_ACCOUNTING_INVALID');
 if(p.pending){const o=p.pending;if(!/^[1-9]\d{0,15}$/.test(o.amount)||!Number.isSafeInteger(Number(o.amount))||!Number.isSafeInteger(o.lastValidBlockHeight)||!HISTORICAL_PROFIT_RECIPIENTS.includes(o.recipient))throw fail('LIVE_PROFIT_ACCOUNTING_INVALID');checkTransaction(Buffer.from(o.transaction,'base64'),s.owner,o.amount,o.recipient);if(verifyOwnerTransaction(o.transaction,s.owner).signature!==o.signature)throw fail('LIVE_PROFIT_ACCOUNTING_INVALID');}
 return p;
}
export function earnedAIProfit(s){
 const p=s.aiProfit;if(!p)return 0;
 return Math.max(0,atomic(s.realizedPnlSol??0)-p.baselineLamports-p.paidLamports-p.feeLamports);
}
export function reservedAIProfit(s){return Math.max(earnedAIProfit(s),s.aiProfit?.pending?Number(s.aiProfit.pending.amount)+AI_POLICY.profitFeeBufferLamports:0);}
function checkTransaction(bytes,owner,amount,recipient=PROFIT_RECIPIENT){
 const tx=VersionedTransaction.deserialize(bytes),m=TransactionMessage.decompile(tx.message);
 if(tx.message.header.numRequiredSignatures!==1||m.payerKey.toBase58()!==owner||m.instructions.length!==1||!m.instructions[0].programId.equals(SystemProgram.programId))throw fail('LIVE_PROFIT_TRANSACTION_INVALID');
 const transfer=SystemInstruction.decodeTransfer(m.instructions[0]);
 if(transfer.fromPubkey.toBase58()!==owner||transfer.toPubkey.toBase58()!==recipient||transfer.lamports!==BigInt(amount))throw fail('LIVE_PROFIT_TRANSACTION_INVALID');
 return tx;
}
// Called under the same treasury lock as buys/sells. Signed bytes are durable
// before broadcast; an ambiguous transfer is reconciled, never signed twice.
export async function stepAIProfit(t){
 const s=t.s,p=initAIProfit(s,t.clock()),e=t.execution,now=t.clock();
 try{
  if(p.pending){
   const o=p.pending;checkTransaction(Buffer.from(o.transaction,'base64'),t.owner,o.amount,o.recipient);
   const proof=verifyOwnerTransaction(o.transaction,t.owner);if(proof.signature!==o.signature||!Number.isSafeInteger(o.lastValidBlockHeight))throw fail('LIVE_PROFIT_TRANSACTION_INVALID');
   let status=await e.status(o.signature),lateReceipt=null,expired=false;let fee=0,slot;
   if(!status&&await e.height()>o.lastValidBlockHeight){lateReceipt=await e.profitReceipt(o.signature,t.owner,o.amount,o.recipient);if(lateReceipt)status={confirmationStatus:'confirmed'};else expired=true;}
   if(status?.err){const tx=await e.rpc.getParsedTransaction(o.signature,{maxSupportedTransactionVersion:0,commitment:'confirmed'});if(!tx)return;fee=tx.meta?.fee;slot=tx.slot;o.status='failed';}
   else if(['confirmed','finalized'].includes(status?.confirmationStatus)){
    const r=lateReceipt??await e.profitReceipt(o.signature,t.owner,o.amount,o.recipient);if(!r)return;
    fee=atomic(r.feeSol);slot=r.slot;
    if(r.recipient!==o.recipient||r.amountLamports!==o.amount||atomic(r.solDelta)!==-Number(o.amount)-fee)throw fail('LIVE_PROFIT_RECEIPT_INVALID');
    o.status='confirmed';
   }else if(expired){o.status='expired';}else return;
   if(!Number.isSafeInteger(fee)||fee<0||fee>AI_POLICY.profitFeeBufferLamports||slot!==undefined&&!Number.isSafeInteger(slot))throw fail('LIVE_PROFIT_RECEIPT_INVALID');
   const debit=(o.status==='confirmed'?Number(o.amount):0)+fee,cash=atomic(s.cashSol)-debit;
   if(cash<0)throw fail('LIVE_PROFIT_CASH_MISMATCH');
   p.feeLamports+=fee;if(o.status==='confirmed')p.paidLamports+=Number(o.amount);s.cashSol=cash/1e9;
   if(slot)s.lastReceiptSlot=Math.max(s.lastReceiptSlot,slot);
   const {transaction,...record}=o;p.payouts=[{...record,at:now,feeLamports:fee},...p.payouts].slice(0,1000);p.pending=null;p.error=null;
   if(o.status==='confirmed'){
    s.telegramOutbox??=[];s.telegramOutbox.push({id:'profit:'+o.signature,createdAt:now,status:'queued',attempts:0,nextAttemptAt:0,text:['Meme Pilot · CHUYỂN LÃI ĐÃ XÁC NHẬN','SOL: '+(Number(o.amount)/1e9).toFixed(9),'Ví nhận: '+o.recipient,'Phí mạng: '+(fee/1e9).toFixed(9)+' SOL','https://solscan.io/tx/'+o.signature].join('\n')});
   }
   await t.save();return;
  }
  if(!t.signingReady()||now<(p.retryAt??0)||Object.values(s.orders).some(o=>!o.terminal))return;
  const earned=earnedAIProfit(s);if(earned<=AI_POLICY.profitFeeBufferLamports)return;
  const balance=atomic(await e.balance(t.owner,s.lastReceiptSlot||undefined));
  const amount=Math.min(earned-AI_POLICY.profitFeeBufferLamports,balance-AI_POLICY.reserveLamports-AI_POLICY.executionBufferLamports-AI_POLICY.profitFeeBufferLamports);if(amount<=0)return;
  const prepared=await e.prepareAIProfit(t.owner,amount),tx=checkTransaction(prepared.bytes,t.owner,amount);
  if(!t.vault.keypair)return;tx.sign([t.vault.keypair]);
  const o={id:'ai-profit:'+(++p.sequence),amount:String(amount),recipient:PROFIT_RECIPIENT,createdAt:now,status:'signed',signature:bs58.encode(tx.signatures[0]),transaction:Buffer.from(tx.serialize()).toString('base64'),lastValidBlockHeight:prepared.lastValidBlockHeight};
  p.pending=o;await t.save();
  try{if(await e.send(tx.serialize())!==o.signature)throw fail('LIVE_PROFIT_SIGNATURE_MISMATCH');o.status='pending';}catch{o.status='unknown';}
  p.error=null;await t.save();
 }catch(error){p.error=error.code??'LIVE_PROFIT_RETRY';p.retryAt=now+5000;await t.save();}
}
