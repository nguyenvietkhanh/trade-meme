import {randomBytes,createHash,createPublicKey,verify} from 'node:crypto';
import {PublicKey,VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {DEFAULT_OWNER} from './security.js';
import {SOL,DEFAULTS} from './engine.js';
import {rankMarket} from './strategy.js';
import {LIVE_LIMITS} from './solana.js';

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
 constructor(execution){this.execution=execution;this.owner=DEFAULT_OWNER;this.apiKey=process.env.JUPITER_API_KEY??'';this.intent=null;this.watched=[];}
 configure({apiKey,heliusKey}){
  for(const value of [apiKey,heliusKey])if(value&&(typeof value!=='string'||!/^[\x21-\x7e]{8,256}$/.test(value)))throw Error('API key không hợp lệ.');
  if(heliusKey)this.execution.configureHelius(heliusKey);if(apiKey)this.apiKey=apiKey;
  return {walletMode:'owner',rpcProvider:this.execution.provider,apiKeyConfigured:!!this.apiKey};
 }
 async status(){
  try{await this.execution.network();const balanceSol=await this.execution.balance(this.owner),tokenBalances={};
   if(this.watched.length)for(const a of await this.execution.holdings(this.owner)){const d=a.account.data;if(d.length>=165){const mint=new PublicKey(d.subarray(0,32)).toBase58();if(this.watched.includes(mint))tokenBalances[mint]=(BigInt(tokenBalances[mint]??'0')+d.readBigUInt64LE(64)).toString();}}
   return {...this.configure({}),publicKey:this.owner,balanceSol,tokenBalances,lastSyncAt:Date.now()};}
  catch{throw Error('Chưa đọc được số dư ví chủ. Kiểm tra Helius/RPC rồi thử lại.');}
 }
 async prepare(input,feed){
  if(!this.apiKey)throw Error('Nhập Jupiter API key trước khi lấy giao dịch swap.');
  if(this.intent){if(this.intent.signature||await this.execution.height()<=this.intent.lastValidBlockHeight)throw Error('Còn giao dịch trước cần ký hoặc đối soát.');this.intent=null;}
  if(feed.error||!feed.updatedAt||Date.now()-feed.updatedAt>90000||!Number.isFinite(feed.solUsd)||feed.solUsd<=0)throw Error('Chờ dữ liệu thị trường mới.');
  const side=input.side;if(!['BUY','SELL'].includes(side))throw Error('Loại lệnh không hợp lệ.');
  const market=feed.markets.find(m=>m.mint===input.mint);if(!market)throw Error('Token chưa có dữ liệu trong tập quét.');
  const holdings=await this.execution.holdings(this.owner);
  let held=0n;for(const a of holdings){const d=a.account.data;if(d.length>=165&&new PublicKey(d.subarray(0,32)).toBase58()===market.mint)held+=d.readBigUInt64LE(64);}
  let amount;
  if(side==='BUY'){
   if(!rankMarket(market,DEFAULTS).eligible)throw Error('Token chưa đạt toàn bộ bộ lọc.');
   if(held>0n)throw Error('Ví đã giữ token này; không trộn với tài sản có sẵn.');
   const balance=await this.execution.balance(this.owner);if(balance-.03-.005<.05)throw Error('Chưa đủ SOL ngoài khoản dự phòng 0,05 SOL.');
   await this.execution.mintCheck(market.mint);amount='30000000';
  }else{
   if(typeof input.amount!=='string'||!/^\d{1,20}$/.test(input.amount)||BigInt(input.amount)<=0n||BigInt(input.amount)>held)throw Error('Lượng bán vượt số token đang có.');
   amount=input.amount;
  }
  const request={ownerAddress:this.owner,apiKey:this.apiKey,input:side==='BUY'?SOL:market.mint,output:side==='BUY'?market.mint:SOL,amount};
  let prepared=await this.execution.prepare(request);
  if(side==='SELL'&&input.reason==='recover-capital'&&Number.isFinite(input.targetSol)&&input.targetSol>0){
   const target=BigInt(Math.ceil(input.targetSol*1e9));
   if(prepared.minNativeOutLamports>0n&&prepared.minNativeOutLamports<target){amount=(BigInt(amount)*target*1001n/(prepared.minNativeOutLamports*1000n)+1n).toString();if(BigInt(amount)>=held)throw Error('Chưa đủ giá trị để thu hồi vốn và giữ phần thả nổi.');prepared=await this.execution.prepare({...request,amount});}
   if(prepared.minNativeOutLamports<target)throw Error('Báo giá ròng chưa đạt mục tiêu thu hồi vốn.');
  }
  const tx=VersionedTransaction.deserialize(prepared.bytes);
  this.intent={id:randomBytes(16).toString('hex'),owner:this.owner,side,mint:market.mint,symbol:market.symbol,priceUsd:market.priceUsd,solUsd:feed.solUsd,amount,reason:side==='BUY'?'autonomous-low-cap':String(input.reason??'owner-exit').slice(0,50),lastValidBlockHeight:prepared.lastValidBlockHeight,messageHash:hash(tx),at:Date.now()};
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
  if(!intent||intent.owner!==this.owner||intent.messageHash!==signed.messageHash||!['BUY','SELL'].includes(intent.side)||!Number.isFinite(intent.solUsd)||intent.solUsd<=0||!Number.isSafeInteger(intent.lastValidBlockHeight))throw Error('Nhật ký chờ không hợp lệ.');
  new PublicKey(intent.mint);
  const status=await this.execution.status(signed.signature);
  const clear=()=>{if(this.intent?.id===intent.id)this.intent=null;};
  if(status?.err){const tx=await this.execution.rpc.getParsedTransaction(signed.signature,{maxSupportedTransactionVersion:0,commitment:'confirmed'});if(!tx)return {status:'pending'};clear();return {status:'failed',signature:signed.signature,feeSol:tx.meta.fee/1e9};}
  if(!['confirmed','finalized'].includes(status?.confirmationStatus)){
   if(!status&&await this.execution.height()>intent.lastValidBlockHeight){clear();return {status:'expired',signature:signed.signature};}
   return {status:'pending',signature:signed.signature};
  }
  const receipt=await this.execution.receipt(signed.signature,this.owner,intent.mint);if(!receipt)return {status:'pending'};
  if(!Number.isInteger(receipt.decimals)||receipt.decimals<0||receipt.decimals>9)throw Error('Không xác minh được decimals.');
  if(intent.side==='BUY'&&(intent.amount!=='30000000'||receipt.tokenDelta<=0n||receipt.solDelta>=0||-receipt.solDelta>LIVE_LIMITS.orderSol+.005))throw Error('Receipt mua không khớp giới hạn.');
  if(intent.side==='SELL'&&(receipt.tokenDelta!==-BigInt(intent.amount)||receipt.solDelta<=0))throw Error('Receipt bán không khớp lượng đã ký.');
  clear();return {status:'confirmed',signature:signed.signature,slot:receipt.slot,solDelta:receipt.solDelta,tokenDelta:receipt.tokenDelta.toString(),decimals:receipt.decimals};
 }
}
