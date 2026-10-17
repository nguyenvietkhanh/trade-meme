import {Connection,PublicKey,VersionedTransaction,TransactionMessage,SystemProgram} from '@solana/web3.js';
import bs58 from 'bs58';
import {buildPumpSwap,PUMP_PROGRAM} from './pump-swap.js';
import {SOL} from './engine.js';
import {keylessConnection,PUBLIC_RPC_ENDPOINTS,MAINNET_GENESIS_HASH} from './rpc.js';
import {PROFIT_RECIPIENT,PROFIT_RULES,TRADE_RULES} from './desk-rules.js';
export const TOKEN=new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN2022=new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ATA=new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const PROGRAMS=new Set(['11111111111111111111111111111111','ComputeBudget111111111111111111111111111111',TOKEN.toBase58(),ATA.toBase58(),PUMP_PROGRAM.toBase58()]);
export class TradePolicyError extends Error{}
export const LIVE_LIMITS=Object.freeze({budgetSol:TRADE_RULES.initialSol,orderSol:TRADE_RULES.orderSol,reserveSol:TRADE_RULES.reserveSol,maxPositions:TRADE_RULES.maxPositions,maxDailyLossSol:TRADE_RULES.maxDailyLossSol,maxOverheadLamports:5000000,maxPriorityLamports:20000,maxPriceImpact:.02,slippageBps:TRADE_RULES.slippageBps});
const atomic=s=>{if(!/^\d+$/.test(String(s)))throw new TradePolicyError('Số lượng token không hợp lệ.');return BigInt(s);};
export function validateQuote(q,input,output,amount){
 if(q.inputMint!==input||q.outputMint!==output||q.swapMode!=='ExactIn'||atomic(q.inAmount)!==atomic(amount)||atomic(q.outAmount)<=0n||atomic(q.otherAmountThreshold)<=0n||atomic(q.otherAmountThreshold)>atomic(q.outAmount))throw new TradePolicyError('Báo giá không khớp lệnh đã cho phép.');
 if(!Number.isFinite(Number(q.priceImpactPct))||Number(q.priceImpactPct)<0||Number(q.priceImpactPct)>LIVE_LIMITS.maxPriceImpact)throw new TradePolicyError('Price impact vượt 2%.');
 if(!Number.isInteger(q.slippageBps)||q.slippageBps<1)throw new TradePolicyError('Thiếu slippage được xác minh.');
 if(!Array.isArray(q.routePlan)||!q.routePlan.length||q.slippageBps>LIVE_LIMITS.slippageBps)throw new TradePolicyError('Route hoặc slippage không hợp lệ.');
}
export function validateSimulation({beforeSol,afterSol,before,after,input,output,amount,minOut}){
 if(!Number.isSafeInteger(beforeSol)||!Number.isSafeInteger(afterSol))throw new TradePolicyError('Không xác minh được thay đổi SOL.');
 const spend=beforeSol-afterSol;
 if(input===SOL&&spend>Number(amount)+LIVE_LIMITS.maxOverheadLamports)throw new TradePolicyError('Giao dịch có thể chi SOL quá giới hạn.');
 if(input!==SOL&&afterSol-beforeSol<Number(minOut)-LIVE_LIMITS.maxOverheadLamports)throw new TradePolicyError('SOL nhận sau phí thấp hơn giới hạn.');
 let outputChange=0n,inputChange=0n;
 for(let i=0;i<after.length;i++){
  const a=after[i],b=before[i];
  if(!a){if(b&&b.mint!==SOL)throw new TradePolicyError('Giao dịch đóng tài khoản token ngoài dự kiến.');continue;}
  if(a.mint!==input&&a.mint!==output&&JSON.stringify(a)!==JSON.stringify(b))throw new TradePolicyError('Giao dịch thay đổi token ngoài lệnh cho phép.');
  if(a.owner!==b?.owner&&b)throw new TradePolicyError('Giao dịch đổi chủ token.');
  if(a.delegate!==b?.delegate&&b)throw new TradePolicyError('Giao dịch đổi quyền token.');
  if(a.mint===output)outputChange+=atomic(a.amount)-atomic(b?.amount??'0');
  if(a.mint===input)inputChange+=atomic(b?.amount??'0')-atomic(a.amount);
 }
 if(output!==SOL&&outputChange<atomic(minOut))throw new TradePolicyError('Mô phỏng không nhận đủ token đầu ra.');
 if(input!==SOL&&inputChange!==atomic(amount))throw new TradePolicyError('Số token bị trừ không khớp lệnh.');
}
function tokenData(info){
 if(!info)return null;
 const data=Buffer.isBuffer(info.data)?info.data:Buffer.from(info.data[0],'base64');
 if(data.length<165)return null;
 return {mint:new PublicKey(data.subarray(0,32)).toBase58(),owner:new PublicKey(data.subarray(32,64)).toBase58(),amount:data.readBigUInt64LE(64).toString(),delegate:data.subarray(72,165).toString('hex'),raw:data.toString('base64')};
}
export class SolanaExecution{
 constructor(url){this.rpc=keylessConnection(url?[url]:PUBLIC_RPC_ENDPOINTS);this.provider='Solana RPC công khai';}
 async network(){if(await this.rpc.getGenesisHash()!==MAINNET_GENESIS_HASH)throw new TradePolicyError('RPC không phải Solana mainnet.');}
 async balance(address,minContextSlot){return (await this.rpc.getBalance(new PublicKey(address),minContextSlot?{commitment:'confirmed',minContextSlot}:'confirmed'))/1e9;}
 async mintCheck(mint){
  const key=new PublicKey(mint),info=await this.rpc.getParsedAccountInfo(key),data=info.value?.data;
  if(!info.value?.owner.equals(TOKEN)||typeof data!=='object'||!('parsed'in data)||data.parsed.type!=='mint')throw new TradePolicyError('Chỉ hỗ trợ SPL Token cổ điển; không ký token extension/transfer hook.');
  const m=data.parsed.info;
  if(m.mintAuthority||m.freezeAuthority)throw new TradePolicyError('Token còn quyền mint hoặc freeze.');
  if(!Number.isInteger(m.decimals)||m.decimals<0||m.decimals>9||atomic(m.supply)<=0n)throw new TradePolicyError('Thông tin mint không hợp lệ.');
  const largest=await this.rpc.getTokenLargestAccounts(key);
  if(largest.value.some(a=>atomic(a.amount)*100n>atomic(m.supply)*20n))throw new TradePolicyError('Một tài khoản token nắm quá 20% cung; cần kiểm tra phân bổ.');
  return {decimals:m.decimals};
 }
 async holdings(owner){
  const key=new PublicKey(owner),all=[];
  for(const programId of [TOKEN,TOKEN2022]){const result=await this.rpc.getTokenAccountsByOwner(key,{programId});all.push(...result.value);}
  if(all.length>64)throw new TradePolicyError('Ví có quá nhiều tài khoản token để kiểm tra an toàn.');return all;
 }
 async prepare({keypair,ownerAddress,input,output,amount,poolAddress}){
  await this.network();const owner=keypair?.publicKey??new PublicKey(ownerAddress);
  const {tx,quote:q,lastValidBlockHeight}=await buildPumpSwap(this.rpc,{owner,input,output,amount,poolAddress});
  validateQuote(q,input,output,amount);
  const bytes=tx.serialize();if(bytes.length>1232)throw new TradePolicyError('Giao dịch vượt kích thước hỗ trợ.');
  if(tx.message.header.numRequiredSignatures!==1||!tx.message.staticAccountKeys[0].equals(owner))throw new TradePolicyError('Người ký không khớp ví bot.');
  const tables=[];for(const lookup of tx.message.addressTableLookups){const r=await this.rpc.getAddressLookupTable(lookup.accountKey);if(!r.value)throw new TradePolicyError('Không đọc được lookup table.');tables.push(r.value);}
  const keys=tx.message.getAccountKeys({addressLookupTableAccounts:tables});
  if(tx.message.compiledInstructions.some(i=>!PROGRAMS.has(keys.get(i.programIdIndex).toBase58())))throw new TradePolicyError('Giao dịch gọi chương trình ngoài danh sách hỗ trợ.');
  const fee=await this.rpc.getFeeForMessage(tx.message);if(!Number.isSafeInteger(fee.value)||fee.value>25000)throw new TradePolicyError('Phí mạng vượt giới hạn 0,000025 SOL.');
  const owned=await this.holdings(owner),addresses=[owner,...owned.map(a=>a.pubkey)];
  for(const mint of [input,output])if(mint!==SOL){const ata=PublicKey.findProgramAddressSync([owner.toBuffer(),TOKEN.toBuffer(),new PublicKey(mint).toBuffer()],ATA)[0];if(!addresses.some(a=>a.equals(ata)))addresses.push(ata);}
  const beforeInfo=await this.rpc.getMultipleAccountsInfo(addresses),sim=await this.rpc.simulateTransaction(tx,{sigVerify:false,replaceRecentBlockhash:true,accounts:{encoding:'base64',addresses:addresses.map(a=>a.toBase58())}});
  if(sim.value.err||!sim.value.accounts||sim.value.accounts.length!==addresses.length)throw new TradePolicyError('Mô phỏng giao dịch thất bại.');
  if(!beforeInfo[0]?.owner.equals(SystemProgram.programId)||sim.value.accounts[0]?.owner!==SystemProgram.programId.toBase58()||sim.value.accounts[0]?.executable||sim.value.accounts[0]?.data?.[0])throw new TradePolicyError('Giao dịch thay đổi cấu trúc ví SOL.');
  const before=beforeInfo.slice(1).map(tokenData),after=sim.value.accounts.slice(1).map(tokenData);
  if(after.some(a=>a&&a.owner!==owner.toBase58()))throw new TradePolicyError('Tài khoản nhận token không thuộc ví bot.');
  validateSimulation({beforeSol:beforeInfo[0]?.lamports,afterSol:sim.value.accounts[0]?.lamports,before,after,input,output,amount:String(amount),minOut:q.otherAmountThreshold});
  const minNativeOutLamports=output===SOL?BigInt(Math.min(Number(q.otherAmountThreshold)-fee.value,sim.value.accounts[0].lamports-beforeInfo[0].lamports-(Number(q.outAmount)-Number(q.otherAmountThreshold)))):null;
  if(output===SOL&&minNativeOutLamports<=0n)throw new TradePolicyError('SOL nhận sau phí không dương; không yêu cầu ví ký.');
  if(keypair)tx.sign([keypair]);
  return {bytes:tx.serialize(),signature:keypair?bs58.encode(tx.signatures[0]):null,lastValidBlockHeight,quote:q,minNativeOutLamports};
 }
 async prepareProfit(ownerAddress,lamports,initialSol=.3){
  if(!Number.isSafeInteger(lamports)||lamports<PROFIT_RULES.minTransferLamports||lamports>PROFIT_RULES.maxTransferLamports)throw new TradePolicyError('Số lãi chuyển không hợp lệ.');
  if(!Number.isFinite(initialSol)||initialSol<=0||initialSol>.3)throw new TradePolicyError('Ngân sách gốc không hợp lệ.');
  await this.network();const owner=new PublicKey(ownerAddress),recipient=new PublicKey(PROFIT_RECIPIENT),balance=await this.rpc.getBalance(owner),block=await this.rpc.getLatestBlockhash();
  const tx=new VersionedTransaction(new TransactionMessage({payerKey:owner,recentBlockhash:block.blockhash,instructions:[SystemProgram.transfer({fromPubkey:owner,toPubkey:recipient,lamports})]}).compileToV0Message());
  const fee=await this.rpc.getFeeForMessage(tx.message);
  if(!Number.isSafeInteger(fee.value)||fee.value>PROFIT_RULES.feeBufferLamports||balance-lamports-fee.value<Math.max(PROFIT_RULES.reserveLamports,Math.ceil(initialSol*1e9)))throw new TradePolicyError('Không đủ dự phòng vốn/phí để chuyển lãi.');
  const sim=await this.rpc.simulateTransaction(tx,{sigVerify:false,replaceRecentBlockhash:true});if(sim.value.err)throw new TradePolicyError('Kiểm tra chuyển lãi thất bại.');
  return {bytes:tx.serialize(),lastValidBlockHeight:block.lastValidBlockHeight};
 }
 async profitReceipt(signature,ownerAddress,amount){
  const tx=await this.rpc.getParsedTransaction(signature,{maxSupportedTransactionVersion:0,commitment:'confirmed'});if(!tx)return null;
  const keys=tx.transaction.message.accountKeys,from=keys.findIndex(k=>k.pubkey.toBase58()===ownerAddress),to=keys.findIndex(k=>k.pubkey.toBase58()===PROFIT_RECIPIENT),instructions=tx.transaction.message.instructions;
  if(tx.meta?.err||from!==0||to<0||instructions.length!==1)throw new TradePolicyError('Receipt chuyển lãi không hợp lệ.');
  const ix=instructions[0],delta=tx.meta.postBalances[to]-tx.meta.preBalances[to],debit=tx.meta.preBalances[from]-tx.meta.postBalances[from];
  if(ix.program!=='system'||ix.parsed?.type!=='transfer'||ix.parsed.info.source!==ownerAddress||ix.parsed.info.destination!==PROFIT_RECIPIENT||String(ix.parsed.info.lamports)!==String(amount)||delta!==Number(amount)||debit!==Number(amount)+tx.meta.fee)throw new TradePolicyError('Receipt chuyển lãi không khớp đích hoặc số SOL.');
  return {slot:tx.slot,amountLamports:String(amount),feeSol:tx.meta.fee/1e9,solDelta:-debit/1e9,recipient:PROFIT_RECIPIENT};
 }
 async fundingTransaction(owner,recipient,lamports){
  if(!Number.isSafeInteger(lamports)||lamports<=0||lamports>300000000)throw new TradePolicyError('Số SOL nạp vượt giới hạn.');
  await this.network();const block=await this.rpc.getLatestBlockhash();const payer=new PublicKey(owner);
  const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:block.blockhash,instructions:[SystemProgram.transfer({fromPubkey:payer,toPubkey:new PublicKey(recipient),lamports})]}).compileToV0Message());return Buffer.from(tx.serialize()).toString('base64');
 }
 async withdrawal(keypair,recipient){
  await this.network();const block=await this.rpc.getLatestBlockhash(),from=keypair.publicKey;
  const balance=await this.rpc.getBalance(from),lamports=balance-10000;if(lamports<=0)throw new TradePolicyError('Không đủ SOL để rút sau phí.');
  const message=new TransactionMessage({payerKey:from,recentBlockhash:block.blockhash,instructions:[SystemProgram.transfer({fromPubkey:from,toPubkey:new PublicKey(recipient),lamports})]}).compileToV0Message();
  const fee=await this.rpc.getFeeForMessage(message);if(fee.value===null||fee.value>10000)throw new TradePolicyError('Không xác minh được phí rút.');
  const tx=new VersionedTransaction(message);tx.sign([keypair]);return {bytes:tx.serialize(),signature:bs58.encode(tx.signatures[0]),lastValidBlockHeight:block.lastValidBlockHeight,amountLamports:lamports};
 }
 async send(bytes){return this.rpc.sendRawTransaction(bytes,{skipPreflight:false,maxRetries:2,preflightCommitment:'confirmed'});}
 async status(signature){const r=await this.rpc.getSignatureStatuses([signature],{searchTransactionHistory:true});return r.value[0];}
 async height(){return this.rpc.getBlockHeight('finalized');}
 async receipt(signature,owner,mint){
  const tx=await this.rpc.getParsedTransaction(signature,{maxSupportedTransactionVersion:0,commitment:'confirmed'});if(!tx)return null;if(tx.meta?.err)throw new TradePolicyError('Giao dịch đã thất bại trên mạng.');
  const i=tx.transaction.message.accountKeys.findIndex(k=>k.pubkey.toBase58()===owner);if(i<0)throw new TradePolicyError('Receipt không có ví bot.');
  const token=(list)=>(list??[]).filter(b=>b.owner===owner&&b.mint===mint).reduce((sum,b)=>sum+atomic(b.uiTokenAmount.amount),0n);
  const pre=token(tx.meta.preTokenBalances),post=token(tx.meta.postTokenBalances);
  const decimals=[...(tx.meta.postTokenBalances??[]),...(tx.meta.preTokenBalances??[])].find(b=>b.owner===owner&&b.mint===mint)?.uiTokenAmount.decimals;
  return {slot:tx.slot,solDelta:(tx.meta.postBalances[i]-tx.meta.preBalances[i])/1e9,tokenDelta:post-pre,rawBalance:post.toString(),decimals,feeSol:tx.meta.fee/1e9};
 }
}
