import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {OwnerSignerVault} from './owner-vault.js';
import {writeDurable} from './persistence.js';
import {DEFAULT_OWNER} from './security.js';
import {createOwnerLedger,nextOwnerOrder,applyOwnerReceipt,ownerExit} from './owner-ledger.js';
import {DEFAULTS,equity,event} from './engine.js';
import {rankMarket} from './strategy.js';
import {STRATEGY_VERSION} from './desk-rules.js';
import {auditDesk} from './auditor.js';

export function signerRequestAllowed(req,expectedOrigin,onRailway){
 if(onRailway)return typeof expectedOrigin==='string'&&expectedOrigin.startsWith('https://');
 return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&/^127\.0\.0\.1:\d+$/.test(req.headers.host??'');
}
function validatedState(s,owner){
 if(s?.owner!==owner||s.ownerLedgerVersion!==1||!Array.isArray(s.positions)||s.positions.length>5||!Array.isArray(s.trades)||!Array.isArray(s.events)||!Array.isArray(s.curve)||!Array.isArray(s.recordedSignatures)||!Number.isFinite(s.cashSol)||s.cashSol<0||!(s.settings?.initialSol>0&&s.settings.initialSol<=.3))throw Error('Nhật ký không thuộc ví chủ hoặc sai cấu trúc.');
 for(const p of s.positions)if(typeof p.rawQuantity!=='string'||!/^\d{1,20}$/.test(p.rawQuantity)||BigInt(p.rawQuantity)<=0n||!Number.isInteger(p.decimals)||p.decimals<0||p.decimals>9||!Number.isFinite(p.quantity)||p.quantity<=0||!Number.isFinite(p.costSol)||p.costSol<0)throw Error('Vị thế khôi phục không hợp lệ.');
 const withdrawnSol=s.withdrawnSol??0,payoutFeesSol=s.payoutFeesSol??0,realizedNetSol=s.realizedNetSol??s.cashSol+s.positions.reduce((sum,p)=>sum+p.costSol,0)+withdrawnSol+payoutFeesSol-s.settings.initialSol;
 if(!Number.isFinite(withdrawnSol)||withdrawnSol<0||!Number.isFinite(payoutFeesSol)||payoutFeesSol<0||!Number.isFinite(realizedNetSol)||!Array.isArray(s.payouts??[]))throw Error('Sổ chuyển lợi nhuận không hợp lệ.');
 if(s.pending&&(typeof s.pending.transaction!=='string'||s.pending.intent?.owner!==owner))throw Error('Khôi phục server chỉ nhận nhật ký pending có giao dịch đã ký đầy đủ.');
 if(s.strategyVersion!==STRATEGY_VERSION){
  for(const p of s.positions)if(p.phase==='runner'&&p.entryPriceUsd>0){const filled=s.trades.filter(t=>t.mint===p.mint&&t.side==='SELL'&&t.reason==='runner-double'&&t.at>=p.openedAt).map(t=>t.priceUsd).filter(Number.isFinite);const anchor=Math.max(p.entryPriceUsd,...filled);p.nextTakeProfitPriceUsd=p.entryPriceUsd*2**Math.max(1,Math.floor(Math.log2(anchor/p.entryPriceUsd))+1);}
 }
 s.cooldowns??={};for(const t of s.trades)if(t.side==='SELL'&&t.reason==='stop-loss'&&t.closed&&Number.isFinite(t.at))s.cooldowns[t.mint]=Math.max(s.cooldowns[t.mint]??0,t.at+DEFAULTS.reentryMs);
 if(s.haltKind==='drawdown'&&s.positions.length)s.liquidating=true;
 return {...s,strategyVersion:STRATEGY_VERSION,withdrawnSol,payoutFeesSol,realizedNetSol,payouts:s.payouts??[],settings:{...DEFAULTS,initialSol:s.settings.initialSol},running:false};
}
export class OwnerAgent{
 constructor(dir,direct,execution,owner=DEFAULT_OWNER){this.owner=owner;this.file=path.join(dir,'owner-agent-state.json');this.vault=new OwnerSignerVault(path.join(dir,'owner-signer.json'),owner);this.direct=direct;this.execution=execution;this.state=null;this.queue=Promise.resolve();this.busy=false;this.wallet=null;this.error=null;this.commandEpoch=0;}
 serial(fn){const task=this.queue.then(fn);this.queue=task.catch(()=>{});return task;}
 async load(){
  await this.vault.load();
  try{this.state=validatedState(JSON.parse(await readFile(this.file,'utf8')),this.owner);}
  catch(e){if(e.code!=='ENOENT')throw Error('Nhật ký bộ ký tự động không hợp lệ; không ghi đè.');}
 }
 async save(){if(this.state)await writeDurable(this.file,this.state);}
 trackedMints(){return [...new Set([...(this.state?.positions??[]).map(p=>p.mint),this.state?.pending?.intent?.mint].filter(Boolean))];}
 async restore(s){return this.serial(async()=>{
  if(this.state?.running||this.state?.pending)throw Error('Dừng và đối soát xong trước khi khôi phục.');
  this.state=validatedState(s,this.owner);await this.save();
 });}
 async enable(){return this.serial(async()=>{
  if(!this.vault.keypair)throw Error('Mở khóa bộ ký tự động trước khi chạy.');
  await this.execution.network();const balance=await this.execution.balance(this.owner);
  if(!this.state)this.state=createOwnerLedger(this.owner,balance);
  if(this.state.pending)throw Error('Đợi đối soát giao dịch đang chờ trước khi bật lại.');
  if(this.state.halted&&this.state.haltKind!=='daily'&&!this.state.liquidating)throw Error(this.state.halted);
  this.state.orderAttempts={};this.state.buyPaused=false;this.state.buyCircuitOpen=false;this.state.executionFailures=0;
  this.state.running=true;this.state.consecutiveFailures=0;this.lastDecisionFeed=null;this.error=null;event(this.state,'Bộ ký tự động đã bật: ký lệnh bằng ví chủ, không chờ trình duyệt.');try{await this.save();}catch(e){this.state.running=false;this.vault.lock();throw e;}
 });}
 async reviewRisk(feed){return this.serial(async()=>{
  const s=this.state;if(!s||s.running||s.pending||s.haltKind!=='drawdown'||s.positions.length)throw Error('Chỉ xem lại khi đã dừng vì drawdown và không còn lệnh chờ.');
  if(feed.error||!Number.isFinite(feed.solUsd)||feed.solUsd<=0||!feed.updatedAt||Date.now()-feed.updatedAt>DEFAULTS.maxPriceAgeMs||feed.updatedAt>Date.now()||s.positions.some(p=>!feed.markets.some(m=>m.mint===p.mint&&Number.isFinite(m.priceUsd)&&m.priceUsd>0&&m.updatedAt<=Date.now()&&Date.now()-m.updatedAt<=DEFAULTS.maxPriceAgeMs)))throw Error('Cần giá mới cho toàn bộ vị thế trước khi xem lại.');
  s.peakEquity=equity(s,feed.markets,feed.solUsd);s.haltKind=s.dailyLossBlocked?'daily':null;s.halted=s.dailyLossBlocked?'Đang khóa BUY do giới hạn lỗ/ngày đến 00:00 UTC.':null;
  event(s,'Chủ ví đã xem lại drawdown và đặt mốc đỉnh vốn mới; chưa tự bật lại.');await this.save();
 });}
 async pauseBuys(paused=true){if(paused&&this.state)this.state.buyPaused=true;return this.serial(async()=>{if(this.state){this.state.buyPaused=paused;event(this.state,paused?'Đã tạm dừng BUY; tiếp tục quản lý SELL.':'Chủ đã tiếp tục BUY; các giới hạn lỗ và dữ liệu vẫn áp dụng.');await this.save();}});}
 async pause(lock=false){this.commandEpoch++;if(this.state)this.state.running=false;return this.serial(async()=>{if(this.state)this.state.running=false;try{await this.save();}finally{if(lock)this.vault.lock();}});}
 async status(){
  let balanceSol=null,rpcError=null;try{balanceSol=await this.execution.balance(this.owner);}catch{const failures=this.execution.rpc?.rpcDiagnostics?.().failures??[];rpcError='Chưa đọc được số dư qua RPC. '+(failures.length?failures.map(r=>r.host+': '+r.reason).join(' · '):'RPC chưa trả số dư hợp lệ.');}
  return {signerAvailable:true,vault:this.vault.status(),wallet:{...this.direct.configure(),balanceSol,tokenBalances:{},swapReady:balanceSol!==null,unattendedSigning:true},ledger:this.state?{...this.state,pending:this.state.pending?{intent:this.state.pending.intent,signature:this.state.pending.signature,transaction:!!this.state.pending.transaction}:null}:null,audit:this.state?auditDesk(this.state):null,error:rpcError??this.error};
 }
 async execute(order,feed){
  const s=this.state;if(!s||!this.vault.keypair||s.pending)throw Error('Bộ ký chưa sẵn sàng hoặc còn lệnh chờ.');
  const key=order.side+':'+(order.mint??order.recipient)+':'+(order.amount??'fixed');s.orderAttempts??={};if((s.orderAttempts[key]??0)>=DEFAULTS.maxRetries+1)throw Error('Đã hết 3 lần retry cho lệnh này.');s.orderAttempts[key]=(s.orderAttempts[key]??0)+1;await this.save();
  let prepared;const epoch=this.commandEpoch,started=performance.now(),decisionAt=Date.now();
  try{
   prepared=await this.direct.prepare(order,feed);
   if(order.side==='SELL'&&BigInt(prepared.intent.amount)>BigInt(s.positions.find(p=>p.mint===order.mint)?.rawQuantity??'0'))throw Error('Lệnh vượt số token ứng dụng quản lý.');
   const prepareMs=performance.now()-started;
   const tx=VersionedTransaction.deserialize(Buffer.from(prepared.transaction,'base64'));
   if(tx.message.header.numRequiredSignatures!==1||tx.message.staticAccountKeys[0].toBase58()!==this.owner)throw Error('Sai người ký tự động.');
   if(order.side==='BUY'&&(s.buyPaused||s.buyCircuitOpen||Date.now()-feed.updatedAt>DEFAULTS.maxPriceAgeMs||!rankMarket({...feed.markets.find(m=>m.mint===order.mint),solUsd:feed.solUsd},DEFAULTS).eligible))throw Error('Dữ liệu BUY đã quá 30 giây hoặc kiểm chứng hết hạn; không ký.');
   if(epoch!==this.commandEpoch||!this.vault.keypair)throw Error('Đã dừng bộ ký; không ký lệnh mới.');
   const signStarted=performance.now();tx.sign([this.vault.keypair]);const signMs=performance.now()-signStarted;
   s.pending={attemptKey:key,intent:prepared.intent,transaction:Buffer.from(tx.serialize()).toString('base64'),signature:bs58.encode(tx.signatures[0]),timing:{decisionAt,quoteAgeMs:feed.updatedAt?Math.max(0,decisionAt-feed.updatedAt):null,prepareMs,signMs}};
   await this.save(); // Durable signed journal BEFORE any broadcast, including an uncertain send.
   if(epoch!==this.commandEpoch)return;
   const sendStarted=performance.now();s.pending.timing.broadcastStartedAt=Date.now();
   const result=await this.direct.submit({id:prepared.intent.id,transaction:s.pending.transaction});
   s.lastExecutionLatency={...s.pending.timing,broadcastRpcMs:performance.now()-sendStarted,submissionStatus:result.status,confirmationMs:null};await this.save();
  }catch(e){if(prepared&&!s.pending)this.direct.cancel(prepared.intent.id);throw e;}
 }
 async close(mint,feed){return this.serial(async()=>{
  if(!this.state||!this.vault.keypair)throw Error('Mở khóa bộ ký trước khi bán.');
  const p=this.state.positions.find(p=>p.mint===mint);if(!p)throw Error('Không có vị thế.');
  feed={...feed,solUsd:feed.solUsd>0?feed.solUsd:p.entrySolUsd,markets:[...feed.markets.filter(m=>m.mint!==mint),{...(feed.markets.find(m=>m.mint===mint)??{}),mint,symbol:p.symbol,priceUsd:p.lastPriceUsd,pairAddress:p.pairAddress??feed.markets.find(m=>m.mint===mint)?.pairAddress}]};
  const order=ownerExit(this.state,mint,1,'owner-exit',feed.solUsd);await this.execute(order,feed);
 });}
 async tick(feed){
  if(this.busy)return;this.busy=true;
  try{await this.serial(async()=>{
   const s=this.state;if(!s)return;
   if(s.pending){
    const pending=s.pending,result=await this.direct.reconcile({intent:pending.intent,transaction:pending.transaction});
    if(result.status==='pending')return;
    applyOwnerReceipt(s,pending,result);
    if(result.status==='confirmed'){if(pending.attemptKey)delete s.orderAttempts[pending.attemptKey];s.executionFailures=0;s.buyCircuitOpen=false;s.consecutiveFailures=0;if(s.lastExecutionLatency&&pending.timing?.broadcastStartedAt)s.lastExecutionLatency.confirmationMs=Date.now()-pending.timing.broadcastStartedAt;}else{
     s.consecutiveFailures=(s.consecutiveFailures??0)+1;this.error='Lệnh '+result.status+'; đã đối soát, không gửi lại giao dịch cũ.';
     if(pending.intent.side==='BUY')s.cooldowns[pending.intent.mint]=Date.now()+((s.orderAttempts?.[pending.attemptKey]??0)>=DEFAULTS.maxRetries+1?DEFAULTS.coarseCooldownMs:2000);
     if(s.consecutiveFailures>=3){s.buyCircuitOpen=true;s.buyBlockedReason='Liên tiếp giao dịch lỗi/hết hạn: dừng BUY, vẫn xét thoát lệnh.';}
    }
    await this.save();return;
   }
   if(!s.running||!this.vault.keypair)return;
   const working={...feed,markets:(feed.markets??[]).map(m=>({...m}))};if(!(working.solUsd>0)){working.solUsd=s.positions[0]?.entrySolUsd;working.solUsdEstimated=true;working.error=working.error??'Thiếu giá SOL mới; chỉ quản lý SELL.';}let networkError=null,balance=NaN;
   try{balance=await this.execution.balance(this.owner);}catch(e){networkError=e.message;}
   try{
    const holdings=await this.execution.holdings(this.owner),balances={};
    for(const a of holdings){const d=a.account.data;if(d.length>=165){const mint=bs58.encode(d.subarray(0,32));balances[mint]=(balances[mint]??0n)+d.readBigUInt64LE(64);}}
    for(const p of s.positions)if((balances[p.mint]??0n)<BigInt(p.rawQuantity))throw Error('Token thực tế thấp hơn nhật ký. Kiểm tra giao dịch ngoài ứng dụng.');
   }catch(e){if(/Token thực tế/.test(e.message))throw e;networkError=e.message;}
   for(const p of s.positions){
    let m=working.markets.find(m=>m.mint===p.mint);
    if(!m){m={mint:p.mint,symbol:p.symbol,priceUsd:p.lastPriceUsd,pairAddress:p.pairAddress,updatedAt:0};working.markets.push(m);}
    m.pairAddress=p.pairAddress??m.pairAddress;
    if(this.execution.sellQuote)try{
     const q=await this.execution.sellQuote({ownerAddress:this.owner,mint:p.mint,amount:p.rawQuantity,poolAddress:m.pairAddress});m.exitQuote=q;if(Number.isFinite(q.netSol)&&q.netSol>=0&&working.solUsd>0){m.priceUsd=q.netSol*working.solUsd/p.quantity;m.updatedAt=q.checkedAt;}
     if(q.failed===true)m.evidence={...m.evidence,sellSimulationOk:false};
     if(q.jupiterUnavailable)networkError='Jupiter quote chưa khả dụng; dùng báo giá PumpSwap cho vị thế đang mở.';
    }catch(e){networkError=e.message;}
   }
   s.networkFailures=networkError?(s.networkFailures??0)+1:0;
   s.buyBlockedReason=s.buyCircuitOpen||s.networkFailures>=DEFAULTS.networkFailureLimit?'API/RPC lỗi liên tiếp: dừng BUY, vẫn quản lý SELL.':null;
   if(networkError)this.error=networkError;
   if(!s.running||!this.vault.keypair)return;
   const order=nextOwnerOrder(s,working,balance);s.curve.push({at:Date.now(),equitySol:equity(s,working.markets,working.solUsd)});s.curve=s.curve.slice(-1440);await this.save();
   if(!order)return;
   try{await this.execute(order,working);if(!networkError)this.error=null;}
   catch(e){if(s.pending)throw e;this.error=e.message;if(/RPC|fetch|timeout|429|503/i.test(e.message)){s.executionFailures=(s.executionFailures??0)+1;if(s.executionFailures>=DEFAULTS.networkFailureLimit)s.buyCircuitOpen=true;}if(order.side==='BUY')s.cooldowns[order.mint]=Date.now()+((s.orderAttempts?.['BUY:'+order.mint+':fixed']??0)>=DEFAULTS.maxRetries+1?DEFAULTS.coarseCooldownMs:2000);event(s,'Chưa thực hiện '+order.side+' '+order.symbol+': '+e.message);await this.save();}

  });}
  catch(e){this.error=e.message;if(this.state){if(!/RPC|fetch failed|429|timeout/i.test(e.message))this.state.running=false;await this.save().catch(()=>{});}}
  finally{this.busy=false;}
 }
}
