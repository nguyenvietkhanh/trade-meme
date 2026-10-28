import {observeDataset,observeDatasetError} from './dataset-observe.js';
import {VersionedTransaction,PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {readFile,mkdir,appendFile} from 'node:fs/promises';
import path from 'node:path';
import {OwnerSignerVault} from './owner-vault.js';
import {DEFAULT_OWNER} from './security.js';
import {writeDurable} from './persistence.js';
import {LIVE_BUDGET_AUTHORITY} from './live-budget-authority.js';
import {BOT_CONFIGS} from './paper-bot-config.js';
import {SOL} from './engine.js';
import {updateAgentMetrics} from './paper-agent-metrics.js';
import {verifyOwnerTransaction} from './direct-wallet.js';
const ids=new Set(BOT_CONFIGS.map(c=>c.id)),round=x=>Math.round(x*1e9)/1e9;
const binding=o=>JSON.stringify([o.agentId,o.side,o.mint,o.pairAddress,o.amount,o.positionId??null]);
const atomic=x=>{const n=Math.round(x*1e9);if(!Number.isSafeInteger(n)||n<0)throw Error('LIVE_INVALID_AMOUNT');return n;};
const error=code=>Object.assign(Error(code),{code});
export function treasuryAvailable(balanceLamports,orders={}){
 if(!Number.isSafeInteger(balanceLamports)||balanceLamports<0)throw error('LIVE_INVALID_BALANCE');
 const reserved=Object.values(orders).filter(o=>!o.terminal).reduce((n,o)=>n+(o.side==='BUY'?Number(o.amount):0)+5000000,0);if(!Number.isSafeInteger(reserved))throw error('LIVE_INVALID_RESERVATIONS');return Math.max(0,balanceLamports-50000000-5000000-reserved);
}
export class LiveTreasury{
 constructor(dir,execution,{owner=DEFAULT_OWNER,legacyDir=path.dirname(dir),storageMode='local-disk',clock=Date.now}={}){this.dir=dir;this.file=path.join(dir,'live-ledger.json');this.execution=execution;this.owner=owner;this.legacyDir=legacyDir;this.storageMode=storageMode;this.clock=clock;this.vault=new OwnerSignerVault(path.join(legacyDir,'owner-signer.json'),owner);this.chain=Promise.resolve();this.fileChain=Promise.resolve();this.jobs=new Map();this.running=false;this.balanceAt=0;this.observedLamports=null;this.lastError=null;}
 serial(fn){const task=this.chain.then(fn);this.chain=task.then(()=>undefined,e=>{this.lastError=e.code??'LIVE_OPERATION_FAILED';});return task;}
 async load(){await mkdir(this.dir,{recursive:true,mode:0o700});await this.vault.load();try{this.s=JSON.parse(await readFile(this.file,'utf8'));if(this.s.version!==1||this.s.owner!==this.owner||!Array.isArray(this.s.positions)||!Array.isArray(this.s.trades)||!this.s.orders||!Array.isArray(this.s.outbox))throw error('LIVE_LEDGER_INVALID');}catch(e){if(e.code!=='ENOENT')throw e;this.s={version:1,mode:'live',owner:this.owner,startedAt:this.clock(),cashSol:null,initialSol:null,netDepositsSol:0,realizedPnlSol:0,metricsByAgent:{},rentByMint:{},positions:[],trades:[],orders:{},outbox:[],cooldowns:{},lastReceiptSlot:0,capitalFlows:[],telegramOutbox:[]};await this.save();}
  try{const legacy=JSON.parse(await readFile(path.join(this.legacyDir,'owner-agent-state.json'),'utf8'));if(legacy.pending)this.lastError='LIVE_LEGACY_PENDING_REQUIRES_RECONCILIATION';}catch(e){if(e.code!=='ENOENT'&&!this.lastError)throw error('LIVE_LEGACY_LEDGER_INVALID');}
  for(const o of Object.values(this.s.orders)){if(!ids.has(o.agentId)||!['BUY','SELL'].includes(o.side)||!/^[1-9]\d{0,19}$/.test(o.amount)||!Number.isFinite(o.decisionAt))throw error('LIVE_LEDGER_INVALID');if(!o.terminal&&o.signature){const proof=verifyOwnerTransaction(o.transaction,this.owner);if(proof.signature!==o.signature||!Number.isSafeInteger(o.lastValidBlockHeight))throw error('LIVE_LEDGER_INVALID');}}
  if(this.s.cashSol!==null&&(!Number.isFinite(this.s.cashSol)||this.s.cashSol<0))throw error('LIVE_LEDGER_INVALID');
 }
 save(){const data=structuredClone(this.s),task=this.fileChain.then(()=>writeDurable(this.file,data));this.fileChain=task.catch(()=>{});return task;}
 async archive(){if(!this.s.outbox.length)return;for(const f of this.s.outbox){const dir=path.join(this.dir,'fills',new Date(f.at).toISOString().slice(0,10));await mkdir(dir,{recursive:true,mode:0o700});await appendFile(path.join(dir,f.agentId+'.jsonl'),JSON.stringify(f)+'\n',{mode:0o600});}this.s.outbox=[];await this.save();}
 async sync(){return this.serial(async()=>{
  await this.execution.network();const balance=await this.execution.balance(this.owner,this.s.lastReceiptSlot||undefined),value=atomic(balance);this.observedLamports=value;this.balanceAt=this.clock();
  if(!this.hasPendingTransfer()&&!Object.values(this.s.orders).some(o=>!o.terminal)){
   if(this.s.initialSol===null){this.s.initialSol=balance;this.s.cashSol=balance;}
   else{const delta=round(balance-this.s.cashSol);if(delta){this.s.netDepositsSol=round(this.s.netDepositsSol+delta);this.s.capitalFlows=[...this.s.capitalFlows,{at:this.clock(),amountSol:delta}].slice(-1000);}this.s.cashSol=balance;}
  }await this.save();return this.status();
 });}
 signingReady(){return !!this.vault.keypair;}
 availableLamports(balance){return treasuryAvailable(balance,this.s.orders);}
 hasPendingTransfer(){return false;}
 status(){const fresh=this.balanceAt>0&&this.clock()-this.balanceAt<=10000,available=fresh&&this.observedLamports!==null?this.availableLamports(this.observedLamports)/1e9:0;return {owner:this.owner,balanceSol:this.observedLamports===null?null:this.observedLamports/1e9,balanceAt:this.balanceAt,availableSol:available,reserveSol:.05,pendingReservations:Object.values(this.s.orders).filter(o=>!o.terminal).map(o=>({id:o.id,agentId:o.agentId,side:o.side,amount:o.amount,signature:o.signature??null,status:o.status,mint:o.mint,pairAddress:o.pairAddress})),signer:this.vault.status(),running:this.running,storageMode:this.storageMode,error:this.lastError};}
 async unlock(password){if(this.storageMode==='ephemeral')throw error('LIVE_PERSISTENT_VOLUME_REQUIRED');if(this.lastError?.startsWith('LIVE_LEGACY'))throw error(this.lastError);try{await this.vault.unlock(password);await this.reconcile();await this.sync();this.running=true;}catch(e){this.lock();throw e;}}
 pause(paused){if(!paused&&!this.vault.keypair)throw error('LIVE_SIGNER_LOCKED');if(!paused&&this.storageMode==='ephemeral')throw error('LIVE_PERSISTENT_VOLUME_REQUIRED');this.running=!paused;}
 lock(){this.running=false;this.vault.lock();}
 view(agentId){const status=this.status(),positions=this.s.positions.filter(p=>p.agentId===agentId),trades=this.s.trades.filter(t=>t.agentId===agentId).slice(0,500),pending=Object.values(this.s.orders).find(o=>!o.terminal&&o.agentId===agentId);const livePending=pending?Object.fromEntries(['id','side','mint','pairAddress','amount','positionId','decisionAt','readyAt','reason','signature','status','symbol'].map(k=>[k,pending[k]])):null;return {id:agentId,mode:'live',initialSol:0,cashSol:status.balanceSol??0,liveSpendableSol:status.availableSol,liveBookAt:this.balanceAt,livePending,metrics:this.s.metricsByAgent?.[agentId]??null,maxDrawdownPct:null,equitySol:null,positions:structuredClone(positions),trades:structuredClone(trades),rentLockedSol:Object.values(this.s.rentByMint).filter(r=>r.agentId===agentId).reduce((n,r)=>n+r.lamports/1e9,0),realizedPnlSol:this.s.metricsByAgent?.[agentId]?.realizedPnlSol??this.s.trades.filter(t=>t.agentId===agentId&&(t.side==='SELL'||t.side==='FEE')).reduce((n,t)=>n+(t.pnlSol??0),0),cooldowns:this.s.cooldowns[agentId]??{},running:this.running&&this.signingReady()};}
 request(input,m,agentId){if(!ids.has(agentId)||!['BUY','SELL'].includes(input.side)||!String(input.id).startsWith('live:'+agentId+':')||input.mint!==m.mint||input.pairAddress!==m.pairAddress)throw error('LIVE_INVALID_INTENT');const prior=this.jobs.get(input.id);if(prior){if(prior.binding!==binding({...input,agentId}))throw error('LIVE_INTENT_REUSE_MISMATCH');return prior.job;}const job=this.serial(()=>this.execute(input,m,agentId)).finally(()=>this.jobs.delete(input.id));this.jobs.set(input.id,{job,binding:binding({...input,agentId})});return job;}
 assertOrderCapacity(input,agentId){if(Object.values(this.s.orders).some(o=>!o.terminal&&o.agentId===agentId))throw error('LIVE_OWN_ORDER_PENDING');}
 async execute(input,m,agentId){
  const prior=this.s.orders[input.id];if(prior){if(binding(prior)!==binding({...input,agentId}))throw error('LIVE_INTENT_REUSE_MISMATCH');return {status:prior.status,signature:prior.signature??null,terminal:prior.terminal,view:this.view(agentId)};}
  this.assertOrderCapacity(input,agentId);
  if(!this.signingReady())throw error('LIVE_SIGNER_LOCKED');if(this.lastError?.startsWith('LIVE_LEGACY'))throw error(this.lastError);
  if(!/^[1-9]\d{0,19}$/.test(input.amount??''))throw error('LIVE_INVALID_AMOUNT');const amount=BigInt(input.amount),now=this.clock();if(!Number.isFinite(input.readyAt)||!Number.isFinite(input.decisionAt)||input.decisionAt>now||input.readyAt<input.decisionAt+2000||now<input.readyAt||now-input.decisionAt>30000&&input.side==='BUY')throw error('LIVE_INTENT_EXPIRED');
  const balance=atomic(await this.execution.balance(this.owner,this.s.lastReceiptSlot||undefined));this.observedLamports=balance;this.balanceAt=now;const holdings=await this.execution.holdings(this.owner,input.mint);let held=0n;for(const h of holdings){const d=h.account.data;if(d.length>=165&&new PublicKey(d.subarray(0,32)).toBase58()===input.mint)held+=d.readBigUInt64LE(64);}
  const tracked=this.s.positions.filter(p=>p.mint===input.mint).reduce((n,p)=>n+BigInt(p.rawQuantity),0n);if(held<tracked)throw error('LIVE_TOKEN_BALANCE_CONFLICT');
  let position;if(input.side==='BUY'){
   if(!this.running||this.s.positions.some(p=>p.agentId===agentId&&p.mint===input.mint)||(!input.aiOnly&&(this.s.cooldowns[agentId]?.[input.mint]??0)>now))throw error('LIVE_BUY_NOT_ADMITTED');if(amount>BigInt(this.availableLamports(balance))||amount<2500000n)throw error('LIVE_CAPITAL_CHANGED');if(held>tracked)throw error('LIVE_EXTERNAL_TOKEN_HOLDINGS');
   if(!input.aiOnly){const q=await this.execution.roundTripQuote(input.mint,input.amount,m);if(!q.roundTripQuoteOk||q.probeSol!==Number(amount)/1e9||!Number.isFinite(q.roundTripLossPct)||q.roundTripLossPct<0||q.roundTripLossPct>6||![q.buyImpactPct,q.sellImpactPct].every(x=>Number.isFinite(x)&&x>=0&&x<=2)||!Number.isFinite(q.quoteCheckedAt)||q.quoteCheckedAt>this.clock()||this.clock()-q.quoteCheckedAt>5000)throw error('LIVE_ROUNDTRIP_COST_LIMIT');}await this.execution.mintCheck(input.mint);
  }else{position=this.s.positions.find(p=>p.agentId===agentId&&p.paperPositionId===input.positionId&&p.mint===input.mint);if(!position||amount>BigInt(position.rawQuantity))throw error('LIVE_SELL_LOT_MISMATCH');}
  const observedQuote=this.marketSnapshot?.().markets.find(r=>r.mint===input.mint&&r.pairAddress===input.pairAddress)?.quoteMint??m.quoteMint,executionVenue=input.side==='BUY'&&observedQuote&&observedQuote!==SOL?'jupiter-pumpswap':position?.executionVenue??'pumpswap';
  const order={...input,executionVenue,agentId,status:'preparing',terminal:false,at:now};this.s.orders[input.id]=order;await this.save();
  try{
   const reference=input.side==='BUY'?await this.execution.entryQuote(input.mint,input.amount):null;
   const prepared=await this.execution.prepare({ownerAddress:this.owner,input:input.side==='BUY'?SOL:input.mint,output:input.side==='BUY'?input.mint:SOL,amount:input.amount,poolAddress:input.pairAddress,venue:executionVenue,reason:input.reason,referenceMinOut:reference?.minOut,referencePriceSol:input.referencePriceSol,closeEmptyInput:input.side==='SELL'&&held===amount&&!!this.s.rentByMint[input.mint],minContextSlot:this.s.lastReceiptSlot||undefined,budgetAuthority:LIVE_BUDGET_AUTHORITY});
   if(input.side==='BUY'&&this.clock()-input.decisionAt>30000)throw error('LIVE_INTENT_EXPIRED');
   return await this.authorizePrepared(order,prepared);
  }catch(e){observeDatasetError(this.dataset,e,'prepare_or_quote');if(order.signature)throw error('LIVE_SIGNED_RECONCILIATION_REQUIRED');order.status='rejected';order.terminal=true;await this.save();throw error(e.code?.startsWith?.('LIVE_')?e.code:'LIVE_PREPARE_FAILED');}
 }
 async authorizePrepared(order,prepared){
  if(order.executionVenue==='jupiter-pumpswap'&&(!Number.isFinite(prepared.quote?.quotedAt)||prepared.quote.quotedAt>this.clock()||this.clock()-prepared.quote.quotedAt>5000))throw error('LIVE_ROUTE_QUOTE_STALE');
  if(!this.vault.keypair||order.side==='BUY'&&!this.running)throw error('LIVE_SIGNER_LOCKED');const tx=VersionedTransaction.deserialize(prepared.bytes);if(tx.message.header.numRequiredSignatures!==1||tx.message.staticAccountKeys[0].toBase58()!==this.owner)throw error('LIVE_SIGNER_MISMATCH');tx.sign([this.vault.keypair]);
  Object.assign(order,{status:'signed',transaction:Buffer.from(tx.serialize()).toString('base64'),signature:bs58.encode(tx.signatures[0]),lastValidBlockHeight:prepared.lastValidBlockHeight,quote:prepared.quote});await this.save();return this.broadcast(order,tx.serialize());
 }
 async broadcast(order,bytes){
  try{const signature=await this.execution.send(bytes);if(signature!==order.signature)throw error('LIVE_SIGNATURE_MISMATCH');order.status='pending';}catch{order.status='unknown';}await this.save();return {status:order.status,terminal:false,signature:order.signature,view:this.view(order.agentId)};
 }
 async unsignedReconcile(order){order.status='rejected';order.terminal=true;}
 async reconcile(){return this.serial(async()=>{
  for(const id of Object.keys(this.s.orders)){const order=this.s.orders[id];if(order.terminal)continue;
   if(!order.signature){await this.unsignedReconcile(order);continue;}const status=await this.execution.status(order.signature);
   if(status?.err){const tx=await this.execution.rpc.getParsedTransaction(order.signature,{maxSupportedTransactionVersion:0,commitment:'confirmed'});if(!tx)continue;this.finish(order,{status:'failed',signature:order.signature,slot:tx.slot,feeSol:tx.meta.fee/1e9});}
   else if(['confirmed','finalized'].includes(status?.confirmationStatus)){const r=await this.execution.receipt(order.signature,this.owner,order.mint,{includeRent:true});if(r)this.finish(order,{...r,tokenDelta:String(r.tokenDelta),signature:order.signature,status:'confirmed'});}
   else if(!status&&await this.execution.height()>order.lastValidBlockHeight){order.terminal=true;order.status='expired';}
  }await this.save();await this.archive();
 });}
 finish(order,r){const original=this.s;if(original.orders[order.id]?.terminal)return;this.s=structuredClone(original);try{const previous=this.s.positions.find(p=>p.paperPositionId===order.positionId),stopLossPct=previous?.aiStopLossPct;this.applyReceipt(this.s.orders[order.id],r);observeDataset(this.dataset,'fill',()=>({order:Object.fromEntries(['id','positionId','datasetCallId','datasetDecisionIndex','mint','side','amount','decisionAt','aiStopLossPct','reason','signature','quote'].map(k=>[k,order[k]])),receipt:{status:r.status,tokenDelta:r.tokenDelta,decimals:r.decimals,solDelta:r.solDelta,feeSol:r.feeSol,rentDeltaLamports:r.rentDeltaLamports},confirmedAt:this.clock(),sentAt:this.datasetSentAt?.get(order.id)??null,closed:this.s.trades[0]?.closed===true,positionPnlSol:this.s.trades[0]?.positionPnlSol??null,stopLossPct}));this.datasetSentAt?.delete(order.id);}catch(e){this.s=original;throw e;}}
 applyReceipt(order,r){
  if(order.terminal)return;if(r.signature!==order.signature||!Number.isSafeInteger(r.slot)||!Number.isFinite(r.feeSol)||r.feeSol<0)throw error('LIVE_RECEIPT_INVALID');const c=BOT_CONFIGS.find(c=>c.id===order.agentId),at=this.clock();let f;
  if(r.status==='failed'){this.s.cashSol=round(this.s.cashSol-r.feeSol);f={side:'FEE',pnlSol:-r.feeSol,sol:r.feeSol,closed:false};}
  else{
   const delta=BigInt(r.tokenDelta),rent=r.rentDeltaLamports??0;if(!Number.isInteger(r.decimals)||r.decimals<0||r.decimals>18||!Number.isFinite(r.solDelta)||!Number.isSafeInteger(rent))throw error('LIVE_RECEIPT_INVALID');
   if(order.side==='BUY'){
    if(delta<=0n||delta<BigInt(order.quote.otherAmountThreshold)||r.solDelta>=0||-r.solDelta>Number(order.amount)/1e9+.005||rent<0)throw error('LIVE_BUY_RECEIPT_MISMATCH');const cost=round(-r.solDelta-rent/1e9);if(cost<=0)throw error('LIVE_BUY_RECEIPT_MISMATCH');
    this.s.positions.push({executionVenue:order.executionVenue??'pumpswap',agentId:order.agentId,mint:order.mint,pairAddress:order.pairAddress,symbol:order.symbol,paperPositionId:order.id,aiStopLossPct:order.aiStopLossPct??null,aiRiskAssessment:order.aiRiskAssessment??null,aiRiskEvidence:order.aiRiskEvidence??null,rawQuantity:String(delta),quantity:Number(delta)/10**r.decimals,decimals:r.decimals,costSol:cost,initialCostSol:cost,openedAt:at,realizedPnlSol:0,exitPolicy:c.exitPolicy,controlMode:'model',modelName:order.modelName,phase:'open'});if(rent)this.s.rentByMint[order.mint]={agentId:order.agentId,lamports:(this.s.rentByMint[order.mint]?.lamports??0)+rent};f={side:'BUY',sol:-r.solDelta,initialCostSol:cost,positionId:order.id,closed:false};
   }else{
    const p=this.s.positions.find(p=>p.agentId===order.agentId&&p.paperPositionId===order.positionId);if(!p||delta!==-BigInt(order.amount)||-delta>BigInt(p.rawQuantity)||r.solDelta<=0||rent>0)throw error('LIVE_SELL_RECEIPT_MISMATCH');const before=BigInt(p.rawQuantity),closed=before===-delta,basis=closed?p.costSol:Number(BigInt(atomic(p.costSol))*(-delta)/before)/1e9,proceeds=round(r.solDelta+rent/1e9),pnl=round(proceeds-basis);if(proceeds<=0)throw error('LIVE_SELL_RECEIPT_MISMATCH');p.costSol=round(p.costSol-basis);p.rawQuantity=String(before+delta);p.quantity=Number(before+delta)/10**p.decimals;p.realizedPnlSol=round(p.realizedPnlSol+pnl);p.scalpFirstTaken=true;
    f={side:'SELL',sol:r.solDelta,pnlSol:pnl,closed,positionId:p.paperPositionId,initialCostSol:p.initialCostSol,positionPnlSol:closed&&!p.externalAdjusted?p.realizedPnlSol:null,gapLoss:order.reason==='stop-loss'&&proceeds/basis-1 < -(order.stopLossPct??p.aiStopLossPct??p.exitPolicy.stopLossPct)/100};if(closed)this.s.positions=this.s.positions.filter(x=>x!==p);if(rent<0){const heldRent=this.s.rentByMint[order.mint];if(!heldRent||-rent>heldRent.lamports)throw error('LIVE_RENT_RECONCILIATION_REQUIRED');heldRent.lamports+=rent;if(!heldRent.lamports)delete this.s.rentByMint[order.mint];}
   }
   this.s.cashSol=round(this.s.cashSol+r.solDelta);
  }
  if(!Number.isFinite(this.s.cashSol)||this.s.cashSol<0)throw error('LIVE_CASH_RECONCILIATION_REQUIRED');
  f={...f,type:'fill',id:order.id,at,agentId:order.agentId,bot:order.agentId,mint:order.mint,pairAddress:order.pairAddress,symbol:order.symbol,reason:order.reason,signature:r.signature,mode:'live',decisionEngine:order.decisionEngine??'model',aiStopLossPct:order.aiStopLossPct??null,aiRiskAssessment:order.aiRiskAssessment??null,aiRiskEvidence:order.aiRiskEvidence??null,quoteSource:'on-chain-confirmed',networkFeeSol:r.feeSol,slot:r.slot};const g=(this.s.metricsByAgent??={})[order.agentId]??={closed:0,wins:0,closedPnlSol:0,grossProfitSol:0,grossLossSol:0,realizedPnlSol:0};g.realizedPnlSol=round(g.realizedPnlSol+(f.pnlSol??0));if(f.side==='SELL'&&f.closed&&Number.isFinite(f.positionPnlSol)){g.closed++;g.closedPnlSol=round(g.closedPnlSol+f.positionPnlSol);if(f.positionPnlSol>0){g.wins++;g.grossProfitSol=round(g.grossProfitSol+f.positionPnlSol);}else g.grossLossSol=round(g.grossLossSol-f.positionPnlSol);}updateAgentMetrics(g,f);g.lastFill=f;this.s.trades=[f,...this.s.trades].slice(0,5000);this.s.outbox.push(f);if(['BUY','SELL'].includes(f.side)){this.s.telegramOutbox??=[];if(!this.s.telegramOutbox.some(m=>m.id==='trade:'+f.signature))this.s.telegramOutbox.push({id:'trade:'+f.signature,createdAt:at,status:'queued',attempts:0,nextAttemptAt:0,text:['Meme Pilot · '+(order.decisionEngine==='external-wallet'?'VÍ CHỦ · ':'AI · ')+f.side+' ĐÃ XÁC NHẬN',String(f.symbol??f.mint).replace(/[\u0000-\u001f]/g,' ').slice(0,80),f.mint,'SOL: '+f.sol.toFixed(6),'Phí mạng: '+f.networkFeeSol.toFixed(6)+' SOL',...(f.side==='BUY'&&f.aiRiskAssessment?['SL do AI chọn: −'+f.aiStopLossPct+'%','Đánh giá rủi ro AI: '+f.aiRiskAssessment.reason,'Chưa xác minh: '+(f.aiRiskAssessment.unknowns.join(', ').slice(0,300)||'xem dữ liệu quyết định')]:[]),...(f.side==='SELL'?['PnL sau phí: '+f.pnlSol.toFixed(6)+' SOL']:[]),'Lý do: '+String(f.reason??''),'https://solscan.io/tx/'+f.signature].join('\n')});}this.s.realizedPnlSol=round(this.s.realizedPnlSol+(f.pnlSol??0));(this.s.cooldowns[order.agentId]??={})[order.mint]=at+c.entryRules.reentryMs;order.status=r.status;order.terminal=true;delete order.transaction;this.s.lastReceiptSlot=Math.max(this.s.lastReceiptSlot,r.slot);
 }
}
