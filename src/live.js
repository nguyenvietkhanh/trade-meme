import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {PublicKey} from '@solana/web3.js';
import {freshState,recordBuy,recordSell,riskCheck,exitPlan,event,SOL} from './engine.js';
import {rankMarket} from './strategy.js';
import {writeDurable} from './persistence.js';
import {LIVE_LIMITS,TradePolicyError} from './solana.js';
import {DEFAULT_OWNER} from './security.js';
export class LiveTrader{
 constructor(dir,vault,execution){this.file=path.join(dir,'live-state.json');this.vault=vault;this.execution=execution;this.state={...freshState(),cashSol:0,peakEquity:0,dayStartEquity:0,withdrawnSol:0,enabled:false,funded:false,pending:null,journal:[],lastError:null,lastSyncAt:null};this.queue=Promise.resolve();}
 serial(fn){const task=this.queue.then(fn);this.queue=task.catch(()=>{});return task;}
 async load(){try{const s=JSON.parse(await readFile(this.file,'utf8'));if(s.version!==2||!Array.isArray(s.journal))throw Error('schema');this.state=s;}catch(e){if(e.code!=='ENOENT')throw Error('Sổ mainnet không hợp lệ; không tự tạo đè.');}}
 async save(){await writeDurable(this.file,this.state);}
 status(){const s=this.state;return {mode:'live',...this.vault.status(),enabled:s.enabled,funded:s.funded,balanceSol:s.observedBalanceSol??s.cashSol,positions:s.positions,trades:s.trades.slice(0,50),pending:s.pending?{signature:s.pending.signature,status:s.pending.status}:null,halted:s.halted,error:s.lastError,entryBlockedReason:s.entryBlockedReason??null,lastSyncAt:s.lastSyncAt,settings:s.settings,events:s.events.slice(0,30),needsUnlock:!!(this.vault.exists&&!this.vault.keypair)};}
 key(){const kp=this.vault.keypair;if(!kp)throw Error('Két ví đang khóa. Mở khóa trước khi ký.');return kp;}
 apiKey(){const key=this.vault.apiKey||process.env.JUPITER_API_KEY;if(!key)throw Error('Thiếu Jupiter API key. Chưa bật giao dịch thật.');return key;}
 async enable(confirm){return this.serial(async()=>{
  if(confirm!=='ENABLE MAINNET 0.3 SOL')throw Error('Thiếu xác nhận bật mainnet.');
  this.key();this.apiKey();await this.execution.network();const balance=await this.execution.balance(this.vault.publicKey);
  if(!this.state.funded){if(balance>LIVE_LIMITS.budgetSol+.00000001)throw Error('Ví bot khởi đầu chỉ được giữ tối đa 0,3 SOL.');if(balance<LIVE_LIMITS.reserveSol+LIVE_LIMITS.orderSol+.005)throw Error('Chưa đủ SOL để giữ dự phòng và vào lệnh.');this.state.settings.initialSol=balance;this.state.cashSol=balance;this.state.dayStartEquity=balance;this.state.peakEquity=balance;this.state.funded=true;}
  if(balance<.055&&!this.state.positions.length)throw Error('Chưa đủ SOL để giữ dự phòng.');
  if(this.state.halted)throw Error(this.state.halted);
  this.state.observedBalanceSol=balance;this.state.lastSyncAt=Date.now();this.state.enabled=true;this.state.running=true;this.state.lastError=null;event(this.state,'Đã bật ký lệnh mainnet trong giới hạn 0,03 SOL/lệnh.');await this.save();return this.status();
 });}
 async pause(){return this.serial(async()=>{this.state.enabled=false;this.state.running=false;event(this.state,'Dừng ký lệnh mới. Vị thế mainnet vẫn mở.');await this.save();return this.status();});}
 async reconcile(markets,solUsd){
  const s=this.state,p=s.pending;if(!p)return;
  const status=await this.execution.status(p.signature);
  if(status?.err){p.status='failed';s.journal.unshift(p);s.pending=null;s.lastError='Giao dịch thất bại trên chain; kiểm tra phí và nhật ký.';s.enabled=false;await this.save();return;}
  if(status?.confirmationStatus==='confirmed'||status?.confirmationStatus==='finalized'){
   const receipt=await this.execution.receipt(p.signature,this.vault.publicKey,p.mint);if(!receipt)return;
   const m=p.market??markets.find(m=>m.mint===p.mint),rate=p.solUsd;s.lastReceiptSlot=receipt.slot;
   if(s.journal.some(j=>j.signature===p.signature)){s.pending=null;await this.save();return;}
   if(p.side==='WITHDRAW'){if(receipt.solDelta>=0||!p.amountLamports)throw Error('Receipt rút không hợp lệ.');s.cashSol+=receipt.solDelta;s.withdrawnSol=(s.withdrawnSol??0)+Number(p.amountLamports)/1e9;s.enabled=false;p.status='confirmed';s.journal.unshift(p);s.pending=null;event(s,'Đã xác nhận rút SOL về ví chủ.');await this.save();return;}
   const qty=Number(receipt.tokenDelta<0n?-receipt.tokenDelta:receipt.tokenDelta)/10**receipt.decimals;
   if(p.side==='BUY'){
    if(receipt.tokenDelta<=0n||receipt.solDelta>=0)throw Error('Receipt mua không khớp; cần đối soát thủ công.');
    recordBuy(s,m,rate,{quantity:qty,costSol:-receipt.solDelta,priceUsd:-receipt.solDelta*rate/qty,rawQuantity:receipt.rawBalance,decimals:receipt.decimals,signature:p.signature},Date.now(),p.reason,'live');
   }else{
    if(receipt.tokenDelta>=0n||receipt.solDelta<=0)throw Error('Receipt bán không khớp; cần đối soát thủ công.');
    recordSell(s,m,rate,{quantity:qty,proceedsSol:receipt.solDelta,priceUsd:receipt.solDelta*rate/qty,rawBalance:receipt.rawBalance,closed:receipt.rawBalance==='0',signature:p.signature},Date.now(),p.reason,'live');
   }
   p.status='confirmed';s.journal.unshift(p);s.journal=s.journal.slice(0,500);s.pending=null;s.lastError=null;await this.save();return;
  }
  if(!status&&await this.execution.height()>p.lastValidBlockHeight){p.status='expired';s.journal.unshift(p);s.pending=null;s.enabled=false;s.lastError='Giao dịch đã hết hạn. Không gửi lệnh thay thế tự động.';await this.save();}
 }
 async submit(m,side,fraction,reason,solUsd){
  const s=this.state;if(s.pending)throw Error('Đang chờ giao dịch trước được đối soát.');
  const kp=this.key(),apiKey=this.apiKey();let amount;
  if(side==='BUY'){
   if(s.halted||s.positions.length>=5||s.cashSol-.03-.005<.05)throw Error('Giới hạn vốn/vị thế không cho phép mua.');
   if(s.positions.some(p=>p.mint===m.mint)||s.cooldowns[m.mint]>Date.now())throw Error('Token đã giữ hoặc đang cooldown.');
   await this.execution.mintCheck(m.mint);amount='30000000';
  }else{
   const p=s.positions.find(p=>p.mint===m.mint);if(!p?.rawQuantity)throw Error('Không có số dư token đã đối soát.');
   const raw=BigInt(p.rawQuantity);amount=(fraction>=1?raw:raw*BigInt(Math.floor(fraction*1e9))/1000000000n).toString();if(BigInt(amount)<=0n)throw Error('Lượng token quá nhỏ.');
  }
  const request={keypair:kp,apiKey,input:side==='BUY'?SOL:m.mint,output:side==='BUY'?m.mint:SOL,amount};
  let prepared=await this.execution.prepare(request);
  if(side==='SELL'&&reason==='recover-capital'){
   const p=s.positions.find(p=>p.mint===m.mint);
   const target=BigInt(Math.ceil(p.initialCostUsd*1.4/solUsd*1e9));
   if(prepared.minNativeOutLamports<target){
    if(prepared.minNativeOutLamports<=0n)throw new TradePolicyError('Không đủ SOL ròng để thu hồi vốn.');
    const raw=BigInt(p.rawQuantity),adjusted=(BigInt(amount)*target*1001n/(prepared.minNativeOutLamports*1000n))+1n;
    if(adjusted>=raw)throw new TradePolicyError('Chưa đủ giá trị để thu hồi vốn và giữ phần thả nổi.');
    prepared=await this.execution.prepare({...request,amount:adjusted.toString()});
   }
   if(prepared.minNativeOutLamports<target)throw new TradePolicyError('Báo giá ròng chưa đạt mục tiêu thu hồi vốn; chờ lần quét sau.');
  }
  // Write signature BEFORE broadcast. Unknown outcomes block any new order.
  s.pending={signature:prepared.signature,lastValidBlockHeight:prepared.lastValidBlockHeight,status:'signed',side,mint:m.mint,market:m,reason,solUsd,at:Date.now()};await this.save();
  try{const signature=await this.execution.send(prepared.bytes);if(signature!==prepared.signature)throw Error('Signature mismatch');s.pending.status='broadcast';await this.save();}catch{s.lastError='Chưa xác định kết quả gửi. Chờ đối soát signature; không gửi lệnh khác.';await this.save();}
 }
 async close(mint,feed){return this.serial(async()=>{
  if(feed.error||!feed.updatedAt||Date.now()-feed.updatedAt>90000)throw Error('Chưa có giá mới để thoát lệnh.');
  const m=feed.markets.find(m=>m.mint===mint);if(!m)throw Error('Không có giá token.');await this.submit(m,'SELL',1,'owner-exit',feed.solUsd);return this.status();
 });}
 async withdraw(recipient,confirm){return this.serial(async()=>{
  if(recipient!==DEFAULT_OWNER)throw Error('Chỉ rút về ví chủ đã cố định.');
  if(confirm!=='WITHDRAW TO OWNER')throw Error('Thiếu xác nhận rút.');
  if(this.state.pending||this.state.positions.length)throw Error('Đợi đối soát và đóng hết vị thế trước khi rút SOL.');
  this.state.enabled=false;const prepared=await this.execution.withdrawal(this.key(),recipient);
  this.state.pending={signature:prepared.signature,lastValidBlockHeight:prepared.lastValidBlockHeight,amountLamports:prepared.amountLamports,status:'signed',side:'WITHDRAW',mint:SOL,reason:'owner-withdraw',solUsd:0,at:Date.now()};await this.save();
  try{await this.execution.send(prepared.bytes);this.state.pending.status='broadcast';await this.save();}catch{this.state.lastError='Chờ đối soát giao dịch rút; không gửi lại.';await this.save();}return this.status();
 });}
 async tick(feed){if(this.ticking)return;this.ticking=true;return this.serial(async()=>{
  const s=this.state;
  if(!this.vault.publicKey)return;
  try{
   if(s.pending)await this.reconcile(feed.markets,feed.solUsd);
   if(s.pending)return;
   const balance=await this.execution.balance(this.vault.publicKey,s.lastReceiptSlot);s.lastSyncAt=Date.now();s.observedBalanceSol=balance;s.balanceMismatch=s.funded&&Math.abs(balance-s.cashSol)>.000001;
   if(s.balanceMismatch){s.enabled=false;s.lastError='Số dư SOL thay đổi ngoài sổ giao dịch. Dừng ký để đối soát.';await this.save();return;}
   s.cashSol=balance;
   if(!s.enabled||!this.vault.keypair||!feed.solUsd||feed.error||Date.now()-feed.updatedAt>90000){await this.save();return;}
   // Verify every held raw balance before planning another transaction.
   const holdings=await this.execution.holdings(this.vault.publicKey);
   for(const p of s.positions){let raw=0n;for(const a of holdings){const data=a.account.data;if(data.length>=165&&data.subarray(0,32).equals(new PublicKey(p.mint).toBuffer()))raw+=data.readBigUInt64LE(64);}if(raw.toString()!==p.rawQuantity)throw Error('Token balance mismatch');}
   s.entryBlockedReason=s.positions.some(p=>!feed.markets.some(m=>m.mint===p.mint&&m.updatedAt<=Date.now()&&Date.now()-m.updatedAt<=90000))?'Chưa có giá mới cho một vị thế. Khóa mua mới; vẫn theo dõi thoát các vị thế còn dữ liệu.':null;
   const value=riskCheck(s,feed.markets,feed.solUsd);s.curve.push({at:Date.now(),equitySol:value});s.curve=s.curve.slice(-1440);
   for(const p of s.positions){const m=feed.markets.find(m=>m.mint===p.mint);if(!m||Date.now()-m.updatedAt>90000||m.updatedAt>Date.now())continue;p.lastPriceUsd=m.priceUsd;const plan=exitPlan(p,m,feed.solUsd,s.settings);if(plan){try{await this.submit(m,'SELL',plan.fraction,plan.reason,feed.solUsd);}catch(e){if(!(e instanceof TradePolicyError))throw e;event(s,`Chưa thoát ${m.symbol}: ${e.message}`);await this.save();}return;}}
   if(!s.halted&&!s.entryBlockedReason&&s.positions.length<LIVE_LIMITS.maxPositions&&s.cashSol-LIVE_LIMITS.orderSol-.005>=LIVE_LIMITS.reserveSol){let checked=0;for(const m of [...feed.markets].sort((a,b)=>rankMarket(b,s.settings).score-rankMarket(a,s.settings).score))if(rankMarket(m,s.settings).eligible&&!s.positions.some(p=>p.mint===m.mint)&&!(s.cooldowns[m.mint]>Date.now())){
    try{await this.submit(m,'BUY',1,'autonomous-low-cap',feed.solUsd);return;}catch(e){if(!(e instanceof TradePolicyError))throw e;s.cooldowns[m.mint]=Date.now()+1800000;event(s,`Bỏ qua ${m.symbol}: ${e.message}`);if(++checked>=3)break;}
   }}
   await this.save();
  }catch{ s.enabled=false;s.lastError='Không xác minh được RPC, token, báo giá hoặc đối soát. Đã dừng ký; xem cấu hình và lịch sử trước khi bật lại.';await this.save();}
 }).finally(()=>{this.ticking=false;});}
}
