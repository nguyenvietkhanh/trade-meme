import {randomBytes,createHash,createPublicKey,verify} from 'node:crypto';
import {PublicKey,VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {DEFAULT_OWNER} from './security.js';
import {SOL,DEFAULTS} from './engine.js';
import {rankMarket} from './strategy.js';
import {walletOrderSol,validHistoricalBuy,WALLET_SIZING_VERSION,CURVE_RULES,WALLET_ORDER_FRACTION} from './desk-rules.js';
import {isPumpCurve} from './venues.js';
import {entryFeatures} from './training-records.js';
import {availableProfitLamports,PROFIT_RECIPIENT} from './profit.js';

const hash=tx=>createHash('sha256').update(tx.message.serialize()).digest('hex');
export function verifyOwnerTransaction(encoded,owner=DEFAULT_OWNER){
 if(typeof encoded!=='string'||encoded.length>1700)throw Error('Giao dịch không hợp lệ.');
 const bytes=Buffer.from(encoded,'base64');if(bytes.length>1232)throw Error('Giao dịch quá lớn.');
 const tx=VersionedTransaction.deserialize(bytes),key=new PublicKey(owner);
 if(tx.message.header.numRequiredSignatures!==1||!tx.message.staticAccountKeys[0].equals(key))throw Error('Giao dịch phải do đúng ví chủ ký.');
 const publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),key.toBuffer()]),format:'der',type:'spki'});
 if(!verify(null,tx.message.serialize(),publicKey,tx.signatures[0]))throw Error('Chữ ký giao dịch không hợp lệ.');
 return {tx,bytes,signature:bs58.encode(tx.signatures[0]),messageHash:hash(tx)};
}

// This service never possesses a wallet key or signs. The owner's wallet signs in the browser.
export class DirectWallet{
 constructor(execution){this.execution=execution;this.owner=DEFAULT_OWNER;this.intent=null;this.watched=[];}
 configure(){return {walletMode:'owner',rpcProvider:this.execution.provider,swapProvider:'PumpSwap + pump.fun',swapReady:true,signingMode:'owner-wallet',unattendedSigning:false,profitRecipient:PROFIT_RECIPIENT};}
 async status(minContextSlot){
  try{await this.execution.network();const balanceSol=await this.execution.balance(this.owner,minContextSlot),tokenBalances={};
   if(this.watched.length)for(const a of await this.execution.holdings(this.owner)){const d=a.account.data;if(d.length>=165){const mint=new PublicKey(d.subarray(0,32)).toBase58();if(this.watched.includes(mint))tokenBalances[mint]=(BigInt(tokenBalances[mint]??'0')+d.readBigUInt64LE(64)).toString();}}
   return {...this.configure({}),publicKey:this.owner,balanceSol,tokenBalances,lastSyncAt:Date.now()};}
  catch{throw Error('Chưa đọc được số dư ví chủ. Các RPC công khai có thể đang giới hạn lượt gọi; bấm thử lại kết nối.');}
 }
 async prepare(input,feed){
  if(this.intent){if(this.intent.signature||await this.execution.height()<=this.intent.lastValidBlockHeight)throw Error('Còn giao dịch trước cần ký hoặc đối soát.');this.intent=null;}
  if(input.side==='PROFIT'){
   const balance=await this.execution.balance(this.owner),allowed=availableProfitLamports(input.profitState??{},balance);
   if(!allowed||String(input.amount)!==String(allowed)||input.recipient!==PROFIT_RECIPIENT)throw Error('Chưa có đủ lãi đã chốt sau dự phòng vốn và phí.');
   const prepared=await this.execution.prepareProfit(this.owner,allowed,Math.max(.05,input.profitState.initialSol-(input.profitState.remainingCostSol??0))),tx=VersionedTransaction.deserialize(prepared.bytes);
   this.intent={id:randomBytes(16).toString('hex'),owner:this.owner,side:'PROFIT',symbol:'SOL',recipient:PROFIT_RECIPIENT,amount:String(allowed),reason:'realized-profit',lastValidBlockHeight:prepared.lastValidBlockHeight,messageHash:hash(tx),at:Date.now()};
   return {intent:this.intent,transaction:Buffer.from(prepared.bytes).toString('base64')};
  }
  const side=input.side;if(!['BUY','SELL'].includes(side))throw Error('Loại lệnh không hợp lệ.');
  if(side==='BUY'&&(feed.error||!feed.updatedAt||Date.now()-feed.updatedAt>DEFAULTS.maxPriceAgeMs||feed.updatedAt>Date.now()||!Number.isFinite(feed.solUsd)||feed.solUsd<=0))throw Error('Chờ dữ liệu thị trường mới.');
  const market=feed.markets.find(m=>m.mint===input.mint);if(!market)throw Error('Token chưa có dữ liệu trong tập quét.');
  const holdings=await this.execution.holdings(this.owner,market.mint);
  let held=0n;for(const a of holdings){const d=a.account.data;if(d.length>=165&&new PublicKey(d.subarray(0,32)).toBase58()===market.mint)held+=d.readBigUInt64LE(64);}
  const curve=isPumpCurve(market)||input.venue==='pumpfun';let amount,sizing={};
  if(side==='BUY'){
   const rank=rankMarket({...market,solUsd:feed.solUsd},DEFAULTS);if(!rank.eligible)throw Error('Token chưa đạt toàn bộ bộ lọc.');
   if(held>0n)throw Error('Ví đã giữ token này; không trộn với tài sản có sẵn.');
   const balance=await this.execution.balance(this.owner,input.minContextSlot),size=walletOrderSol(balance,curve?CURVE_RULES.orderFraction:WALLET_ORDER_FRACTION);if(!size)throw Error('Chưa đủ SOL ngoài khoản dự phòng 0,05 SOL và phí.');
   if(input.orderSol!=null&&Math.round(input.orderSol*1e9)!==Math.round(size*1e9))throw Object.assign(Error('Số dư đã đổi; tính lại cỡ lệnh theo thị trường và quote.'),{code:'BALANCE_CHANGED'});
   amount=String(Math.round(size*1e9));
   const proof=!curve&&this.execution.roundTripQuote?await this.execution.roundTripQuote(market.mint,amount,market):market.evidence;
   if(!proof||proof.probeSol!==size||!rankMarket({...market,evidence:{...market.evidence,...proof},solUsd:feed.solUsd},DEFAULTS).eligible)throw Error('Quote vòng chưa đạt cho cỡ lệnh thực tế.');
   sizing={sizingVersion:WALLET_SIZING_VERSION,walletBalanceLamports:Math.floor(balance*1e9+1e-6),entryQuoteProof:proof,entryFeatures:entryFeatures(market,feed.solUsd,proof)};
   await this.execution.mintCheck(market.mint);
  }else{
   if(typeof input.amount!=='string'||!/^\d{1,20}$/.test(input.amount)||BigInt(input.amount)<=0n||BigInt(input.amount)>held)throw Error('Lượng bán vượt số token đang có.');
   amount=input.amount;
  }
  const reference=side==='BUY'&&!curve&&this.execution.entryQuote?await this.execution.entryQuote(market.mint,amount):null;
  const request={venue:curve?'pumpfun':'pumpswap',referencePriceSol:market.priceUsd/feed.solUsd,minContextSlot:input.minContextSlot,...(reference?{referenceMinOut:reference.minOut}:{}),ownerAddress:this.owner,poolAddress:market.pairAddress,closeEmptyInput:side==='SELL'&&input.closeEmptyInput===true,input:side==='BUY'?SOL:market.mint,output:side==='BUY'?market.mint:SOL,amount,reason:String(input.reason??'')};
  let prepared=await this.execution.prepare(request);
  if(side==='BUY'&&curve){if(!prepared.entryQuoteProof||prepared.entryQuoteProof.probeSol!==Number(amount)/1e9||Date.now()-prepared.entryQuoteProof.quoteCheckedAt>CURVE_RULES.maxQuoteAgeMs)throw Error('Thiếu quote curve mới theo cỡ lệnh thực tế.');sizing.entryQuoteProof=prepared.entryQuoteProof;sizing.entryFeatures=entryFeatures(market,feed.solUsd,prepared.entryQuoteProof);}
  const tx=VersionedTransaction.deserialize(prepared.bytes);
  const q=prepared.quote;
  const quoteBenchmark=q?{checkedAt:q.quotedAt??null,contextSlot:q.contextSlot??null,outAmount:q.outAmount,minOut:q.otherAmountThreshold,netSol:prepared.minNativeOutLamports!=null?Number(prepared.minNativeOutLamports)/1e9:null}:null;
  this.intent={...sizing,quoteBenchmark,venue:prepared.venue??(curve?'pumpfun':'pumpswap'),id:randomBytes(16).toString('hex'),owner:this.owner,side,mint:market.mint,symbol:market.symbol,priceUsd:market.priceUsd,solUsd:feed.solUsd,entryLiquidityUsd:market.liquidityUsd,entryVolume5mUsd:market.volume5mUsd,pairAddress:prepared.poolAddress??market.pairAddress,exitTrigger:side==='SELL'?input.exitTrigger??null:null,amount,closeEmptyInput:prepared.closedInputAccount??null,reason:side==='BUY'?'autonomous-low-cap':String(input.reason??'owner-exit').slice(0,50),lastValidBlockHeight:prepared.lastValidBlockHeight,messageHash:hash(tx),at:Date.now()};
  return {intent:this.intent,transaction:Buffer.from(prepared.bytes).toString('base64')};
 }
 async submit({id,transaction}){
  if(!this.intent||id!==this.intent.id)throw Error('Yêu cầu đã hết phiên. Giữ giao dịch đã ký để đối soát, không ký lại.');
  const signed=verifyOwnerTransaction(transaction,this.owner);
  if(signed.messageHash!==this.intent.messageHash)throw Error('Ví đã thay đổi nội dung giao dịch; không gửi.');
  if(this.intent.signature){if(this.intent.signature!==signed.signature)throw Error('Signature không khớp.');return {signature:signed.signature,status:'pending'};}
  this.intent.signature=signed.signature;
  try{const signature=await this.execution.send(signed.bytes);if(signature!==signed.signature)throw Error('Signature mismatch');return {signature,status:'pending'};}
  catch{return {signature:signed.signature,status:'unknown'};}
 }
 cancel(id){if(this.intent?.id===id){if(this.intent.signature)throw Error('Giao dịch đã gửi; phải đối soát.');this.intent=null;}return {cancelled:true};}
 async reconcile({intent,transaction}){
  const signed=verifyOwnerTransaction(transaction,this.owner);
  if(!intent||intent.owner!==this.owner||intent.messageHash!==signed.messageHash||!['BUY','SELL','PROFIT'].includes(intent.side)||(intent.side!=='PROFIT'&&(!Number.isFinite(intent.solUsd)||intent.solUsd<=0))||!Number.isSafeInteger(intent.lastValidBlockHeight))throw Error('Nhật ký chờ không hợp lệ.');
  if(intent.side!=='PROFIT')new PublicKey(intent.mint);else if(intent.recipient!==PROFIT_RECIPIENT||!/^\d{1,9}$/.test(intent.amount)||Number(intent.amount)<1000000||Number(intent.amount)>300000000)throw Error('Nhật ký chuyển lãi không hợp lệ.');
  const status=await this.execution.status(signed.signature);
  const clear=()=>{if(this.intent?.id===intent.id)this.intent=null;};
  if(status?.err){const tx=await this.execution.rpc.getParsedTransaction(signed.signature,{maxSupportedTransactionVersion:0,commitment:'confirmed'});if(!tx)return {status:'pending'};clear();return {status:'failed',signature:signed.signature,feeSol:tx.meta.fee/1e9,slot:tx.slot};}
  if(!['confirmed','finalized'].includes(status?.confirmationStatus)){
   if(!status&&await this.execution.height()>intent.lastValidBlockHeight){clear();return {status:'expired',signature:signed.signature};}
   return {status:'pending',signature:signed.signature};
  }
  if(intent.side==='PROFIT'){
   const receipt=await this.execution.profitReceipt(signed.signature,this.owner,intent.amount);if(!receipt)return {status:'pending'};
   clear();return {status:'confirmed',signature:signed.signature,...receipt};
  }
  const receipt=await this.execution.receipt(signed.signature,this.owner,intent.mint);if(!receipt)return {status:'pending'};
  if(!Number.isInteger(receipt.decimals)||receipt.decimals<0||receipt.decimals>9)throw Error('Không xác minh được decimals.');
  if(intent.side==='BUY'&&(!validHistoricalBuy(intent)||receipt.tokenDelta<=0n||receipt.solDelta>=0||-receipt.solDelta>Number(intent.amount)/1e9+.005))throw Error('Receipt mua không khớp giới hạn.');
  if(intent.side==='SELL'&&(receipt.tokenDelta!==-BigInt(intent.amount)||receipt.solDelta<=0))throw Error('Receipt bán không khớp lượng đã ký.');
  clear();return {status:'confirmed',signature:signed.signature,slot:receipt.slot,solDelta:receipt.solDelta,tokenDelta:receipt.tokenDelta.toString(),decimals:receipt.decimals,feeSol:receipt.feeSol??null};
 }
}
