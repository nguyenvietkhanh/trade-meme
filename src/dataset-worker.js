import {validationNotes} from './dataset-validation.js';
import {parentPort,workerData} from 'node:worker_threads';
import {mkdir,readFile,writeFile,readdir,lstat,unlink,rmdir,statfs,open} from 'node:fs/promises';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {randomBytes} from 'node:crypto';
import {redactor,errorCategory} from './dataset-redaction.js';
import {ForwardLabeler} from './dataset-labeler.js';
const root=path.join(workerData.dir,'dataset'),cfg=workerData.config,session=randomBytes(8).toString('hex');
await mkdir(root,{recursive:true,mode:0o700});const rootStat=await lstat(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw Error('DATASET_UNSAFE_PATH');
// Stable salt is an export pseudonym seed, never a wallet/API secret.
let salt;try{const st=await lstat(path.join(root,'.redaction-salt'));if(!st.isFile()||st.isSymbolicLink())throw Error('DATASET_UNSAFE_SALT');salt=await readFile(path.join(root,'.redaction-salt'),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;salt=randomBytes(32).toString('hex');await writeFile(path.join(root,'.redaction-salt'),salt,{mode:0o600,flag:'wx'});}
const clean=redactor(salt,workerData.addresses),known=new Set(),buffers=new Map(),calls=new Map(),intentLinks=new Map(),positions=new Map();let buffered=0,busy=null,closed=false;const parts=new Map();
let lastGapCount=0;
const stats={startedAt:Date.now(),rawBytes:0,compressedBytes:0,writtenRows:0,droppedRows:0,prunedBytes:0,diskBytes:0,error:null,closedPositions:0,winningPositions:0};
const streams=new Set(['model_calls','candidate_snapshots','forward_labels','fills_enriched','executor_results','errors']);
function emit(stream,row){
 try{if(row.mint)known.add(row.mint);const data=clean({schemaVersion:1,...row},[...known]),line=JSON.stringify(data)+'\n',bytes=Buffer.byteLength(line);if(bytes>cfg.bufferBytes||buffered+bytes>cfg.bufferBytes){stats.droppedRows++;return;}const rows=buffers.get(stream)??[];rows.push(line);buffers.set(stream,rows);buffered+=bytes;stats.rawBytes+=bytes;}catch{stats.droppedRows++;}
}
const labeler=new ForwardLabeler(row=>emit('forward_labels',row),{maxActive:cfg.maxActive});
const fresh=(p,now)=>p&&p.spotPriceSol>0&&Number.isFinite(p.priceAt)&&p.priceAt<=now&&now-p.priceAt<=1500;
function finalizeCall(call,reason='ready'){
 if(!call.end)return;const decisions=call.end.decisions??[],events=call.events??[],results=decisions.map((d,index)=>({decisionIndex:index,action:d.action,mint:d.mint,events:events.filter(e=>e.decisionIndex===index)}));
 emit('model_calls',{...call.start,...call.end,executorResults:results,executorCoverage:reason,rawOutputRedacted:true});
 for(const [index,c]of (call.start.context?.candidates??[]).entries()){
  const selected=decisions.some(d=>d.action==='BUY'&&d.mint===c.mint),confirmed=events.some(e=>e.mint===c.mint&&e.stage==='confirmed'&&e.side==='BUY'),rejected=events.some(e=>e.mint===c.mint&&['rejected','validation_rejected'].includes(e.stage));
  emit('candidate_snapshots',{sampleId:call.start.callId+':'+index,callId:call.start.callId,snapshotId:call.start.snapshotId,requestedAt:call.start.requestedAt,decisionAt:call.end.respondedAt,mint:c.mint,features:c,selectedForBuy:selected,bought:confirmed?true:!selected||rejected?false:null,boughtCoverage:confirmed?'confirmed':selected&&!rejected?'pending_or_unknown':'not_bought',quoteVsMid:call.quotes?.[c.mint]??{entryCostPct:null,exitCostPct:null,status:'not_quoted'}});
 }
 calls.delete(call.start.callId);
}
function handle(type,data){
 if(type==='model_start'){
  for(const c of [...(data.context?.candidates??[]),...(data.context?.positions??[])]){if(c.mint)known.add(c.mint);if(c.pool)known.add(c.pool);}
  // Store already-redacted copies only; no credentials or wallet identity enter disk buffers.
  if(calls.size>=128){stats.droppedRows++;return;}calls.set(data.callId,{start:clean(data,[...known]),events:[]});
 }
 if(type==='model_end'){
  const call=calls.get(data.callId);if(!call)return;call.end=clean(data,[...known]);if(!data.validate?.ok)call.end.validate={...call.end.validate,notes:validationNotes(call.end.rawOutput,call.start.context)};
  for(const [i,c]of (call.start.context?.candidates??[]).entries())labeler.add({sampleId:data.callId+':'+i,callId:data.callId,snapshotId:call.start.snapshotId,mint:c.mint,decisionAt:data.respondedAt,quoteVsMid:{entryCostPct:null,exitCostPct:null,status:'not_quoted'}});
  if(!data.validate?.ok){emit('errors',{at:data.respondedAt,category:errorCategory({code:data.validate?.code}),code:data.validate?.code,callId:data.callId});finalizeCall(call,'model_error');}
 }
 if(type==='decision_validation'){
  if(data.intentId)intentLinks.set(data.intentId,{callId:data.callId,decisionIndex:data.decisionIndex,mint:data.decision?.mint,at:Date.now()});
  const call=calls.get(data.callId);call?.events.push({...data,mint:data.decision?.mint,stage:data.applied?'validated':'validation_rejected'});
 }
 if(type==='executor'){
  const link=intentLinks.get(data.intentId),event=clean({...link,...data,callId:data.callId??link?.callId,decisionIndex:data.decisionIndex??link?.decisionIndex},[...known]);emit('executor_results',event);const call=calls.get(event.callId);call?.events.push(event);
  if(call&&data.quote&&Number.isInteger(data.decimals)){const contextMarket=call.start.context.candidates?.find(c=>c.mint===data.mint)??call.start.context.positions?.find(p=>p.mint===data.mint)?.market;const mid=contextMarket?.priceSol,inAmount=Number(data.quote.inAmount),outAmount=Number(data.quote.outAmount),price=data.side==='BUY'?inAmount/1e9/(outAmount/10**data.decimals):outAmount/1e9/(inAmount/10**data.decimals);if(mid>0&&price>0){call.quotes??={};call.quotes[data.mint]={entryCostPct:data.side==='BUY'?(price/mid-1)*100:null,exitCostPct:data.side==='SELL'?(1-price/mid)*100:null,status:'execution_quote_vs_context_mid',midPriceAt:contextMarket.priceAt};labeler.quote(call.start.callId,data.mint,call.quotes[data.mint]);}}
  if(data.error)emit('errors',{...event,category:errorCategory(data.error,data.provider),code:data.error.code??'EXECUTOR_ERROR'});
 }
 if(type==='fill'){
  const {order,receipt}=data;if(receipt.status==='failed'){emit('errors',{at:data.confirmedAt,category:'REVERT',code:'RECEIPT_FAILED',intentId:order.id});emit('fills_enriched',{event:'failed_transaction',intentId:order.id,mint:order.mint,networkFeeSol:receipt.feeSol,confirmedAt:data.confirmedAt});return;}known.add(order.mint);const link=intentLinks.get(order.id)??{callId:order.datasetCallId??null,decisionIndex:order.datasetDecisionIndex??null},pId=order.side==='BUY'?order.id:order.positionId;
  let p=positions.get(pId);if(!p){p={positionId:pId,mint:order.mint,openedAt:order.side==='BUY'?data.confirmedAt:null,entryPrice:null,high:null,low:null,lastPathAt:0,coverageGaps:0,partialSells:0,startedBeforeCollection:order.side!=='BUY'};positions.set(pId,p);}
  const quantity=Number(receipt.tokenDelta)/10**receipt.decimals,netSol=receipt.solDelta,amount=Number(order.amount),quotedOut=Number(order.quote?.outAmount),quotePrice=order.side==='BUY'&&quotedOut>0?amount/1e9/(quotedOut/10**receipt.decimals):order.side==='SELL'&&amount>0?quotedOut/1e9/(amount/10**receipt.decimals):null;
  const rentSol=(receipt.rentDeltaLamports??0)/1e9,swapSol=order.side==='BUY'?-netSol-rentSol-receipt.feeSol:netSol+rentSol+receipt.feeSol,fillPrice=quantity&&swapSol>0?swapSol/Math.abs(quantity):null;
  if(order.side==='BUY'&&fillPrice>0){p.entryPrice=fillPrice;p.high=Math.max(p.high??fillPrice,fillPrice);p.low=Math.min(p.low??fillPrice,fillPrice);}
  const closed=order.side==='SELL'&&data.closed===true;if(order.side==='SELL')p.partialSells++;
  const pnl=data.positionPnlSol??null;
  if(closed){if(Number.isFinite(pnl)){stats.closedPositions++;if(pnl>0)stats.winningPositions++;}}
  emit('fills_enriched',{event:'fill',...link,positionId:pId,orderId:order.id,mint:order.mint,side:order.side,confirmedAt:data.confirmedAt,signature:order.signature,quoteAt:order.quote?.quotedAt??null,quoteContextSlot:order.quote?.contextSlot??null,quotePriceSol:quotePrice,fillPriceSol:fillPrice,fillPriceBasis:'receipt SOL delta adjusted for network fee and refundable rent; not decoded inner swap amounts',slippagePct:fillPrice&&quotePrice?(order.side==='BUY'?fillPrice/quotePrice-1:1-fillPrice/quotePrice)*100:null,networkFeeSol:receipt.feeSol,solDelta:netSol,tokenDelta:receipt.tokenDelta,rentDeltaLamports:receipt.rentDeltaLamports??0,decisionAt:order.decisionAt,sentAt:data.sentAt??null,decisionToSendMs:data.sentAt?data.sentAt-order.decisionAt:null,sendToConfirmationMs:data.sentAt?data.confirmedAt-data.sentAt:null,decisionToConfirmationMs:data.confirmedAt-order.decisionAt,stopLossPct:order.aiStopLossPct??data.stopLossPct??null,exitReason:order.reason==='stop-loss'?'stop':order.side==='SELL'&&String(order.reason).startsWith('AI:')?'AI_SELL':'other',closed,positionPnlSol:pnl,mfePct:p.entryPrice&&p.high?100*(p.high/p.entryPrice-1):null,maePct:p.entryPrice&&p.low?100*(p.low/p.entryPrice-1):null,coverage:{startedBeforeCollection:p.startedBeforeCollection,gaps:p.coverageGaps,extremaScope:'observed-only'},winRateClosedPositions:stats.closedPositions?stats.winningPositions/stats.closedPositions:null});
  if(receipt.status==='failed')emit('errors',{at:data.confirmedAt,category:'REVERT',code:'RECEIPT_FAILED',intentId:order.id});
  const call=calls.get(link?.callId);call?.events.push({...link,stage:'confirmed',mint:order.mint,side:order.side});
  emit('executor_results',{...link,intentId:order.id,mint:order.mint,side:order.side,stage:'confirmed',bought:order.side==='BUY',at:data.confirmedAt,positionId:pId});if(closed)positions.delete(pId);
 }
 if(type==='prices'){
  labeler.prices(data.prices,data.at);const map=new Map(data.prices.map(p=>[p.mint,p]));
  for(const held of data.positions){let p=positions.get(held.positionId);if(!p){p={...held,positionId:held.positionId,entryPrice:null,high:null,low:null,lastPathAt:0,coverageGaps:0,startedBeforeCollection:true};positions.set(held.positionId,p);}p.stopLossPct=held.stopLossPct;const price=map.get(held.mint),valid=fresh(price,data.at);if(valid){p.high=Math.max(p.high??-Infinity,price.spotPriceSol);p.low=Math.min(p.low??Infinity,price.spotPriceSol);}else p.coverageGaps++;
   if(data.at-p.lastPathAt>=5000){emit('fills_enriched',{event:'price_path',positionId:held.positionId,mint:held.mint,at:data.at,priceAt:valid?price.priceAt:null,spotPriceSol:valid?price.spotPriceSol:null,coverage:valid?'fresh':'missing_or_stale',stopLossPct:held.stopLossPct});p.lastPathAt=data.at;}
  }
 }
 if(type==='error')emit('errors',{at:data.at,category:errorCategory(data,data.provider),code:data.code,provider:data.provider||null});
 const now=Date.now();for(const call of calls.values())if(call.end&&now-call.end.respondedAt>=60000)finalizeCall(call,'60s_join_window; later results in executor_results');
 for(const [id,link]of intentLinks)if(now-link.at>86400000)intentLinks.delete(id);
 while(known.size>100000)known.delete(known.values().next().value);
}
async function prune(incoming){
 const check=await lstat(root);if(!check.isDirectory()||check.isSymbolicLink())throw Error('DATASET_UNSAFE_PATH');const files=[];
 for(const day of await readdir(root)){if(!/^\d{4}-\d{2}-\d{2}$/.test(day))continue;const dir=path.join(root,day),ds=await lstat(dir);if(!ds.isDirectory()||ds.isSymbolicLink())continue;for(const name of await readdir(dir)){if(!/^(model_calls|candidate_snapshots|forward_labels|fills_enriched|executor_results|errors)-[a-f0-9]{16}-\d+\.jsonl\.gz$/.test(name))continue;const file=path.join(dir,name),st=await lstat(file);if(st.isFile()&&!st.isSymbolicLink())files.push({file,dir,bytes:st.size,at:Math.min(st.mtimeMs,Date.parse(day+'T23:59:59.999Z'))});}}
 files.sort((a,b)=>a.at-b.at);let total=files.reduce((n,f)=>n+f.bytes,0);const disk=await statfs(root);let free=disk.bavail*disk.bsize;
 for(const f of files)if(Date.now()-f.at>cfg.maxAgeMs||total+incoming>cfg.maxBytes||free<cfg.minFreeBytes+incoming){await unlink(f.file);total-=f.bytes;free+=f.bytes;stats.prunedBytes+=f.bytes;try{await rmdir(f.dir);}catch(e){if(!['ENOTEMPTY','ENOENT'].includes(e.code))throw e;}}
 stats.diskBytes=total;return total+incoming<=cfg.maxBytes&&free>=cfg.minFreeBytes+incoming;
}
async function flush(){
 if(busy)return busy;
 busy=(async()=>{let inProgressRows=0;try{
  const gaps=stats.droppedRows+(stats.droppedTransportMessages??0);if(gaps>lastGapCount&&buffered<cfg.bufferBytes-2048){emit('errors',{at:Date.now(),category:'DATASET_GAP',code:'DATASET_RECORDS_DROPPED',droppedRows:stats.droppedRows,droppedTransportMessages:stats.droppedTransportMessages??0});lastGapCount=gaps;}
  for(const [stream,lines]of buffers){if(!lines.length)continue;const batch=lines.splice(0),text=batch.join(''),bytes=Buffer.byteLength(text);buffered-=bytes;inProgressRows=batch.length;const gz=gzipSync(text);
   if(!await prune(gz.length)){stats.droppedRows+=batch.length;inProgressRows=0;stats.error='DATASET_DISK_RESERVE';continue;}
   const day=new Date().toISOString().slice(0,10),dir=path.join(root,day);await mkdir(dir,{recursive:true,mode:0o700});let rotation=parts.get(stream);if(!rotation||rotation.day!==day)rotation={day,index:0,bytes:0};if(rotation.bytes+gz.length>cfg.partBytes){rotation.index++;rotation.bytes=0;}const name=stream+'-'+session+'-'+String(rotation.index).padStart(6,'0')+'.jsonl.gz',file=path.join(dir,name);rotation.bytes+=gz.length;parts.set(stream,rotation);const before=await lstat(file).catch(e=>e.code==='ENOENT'?null:Promise.reject(e));if(before?.isSymbolicLink())throw Error('DATASET_UNSAFE_PATH');
   const handle=await open(file,'a',0o600);try{await handle.writeFile(gz);}finally{await handle.close();}stats.compressedBytes+=gz.length;stats.writtenRows+=batch.length;stats.diskBytes+=gz.length;inProgressRows=0;stats.error=null;
  }
 }catch{stats.droppedRows+=inProgressRows;stats.error='DATASET_WRITE_FAILED';}finally{const seconds=Math.max(1,(Date.now()-stats.startedAt)/1000);parentPort.postMessage({type:'status',status:{...stats,bufferedBytes:buffered,activeLabels:labeler.count,pendingCalls:calls.size,rawBytesPerSecond:stats.rawBytes/seconds,compressedBytesPerSecond:stats.compressedBytes/seconds,estimatedMiBPerDay:stats.compressedBytes/seconds*86400/1048576}});}})().finally(()=>busy=null);return busy;
}
const timer=setInterval(()=>{for(const c of calls.values())if(c.end&&Date.now()-c.end.respondedAt>=60000)finalizeCall(c,'60s_join_window');labeler.prices([],Date.now());flush();},cfg.flushMs);timer.unref();
parentPort.on('message',async m=>{if(closed)return;
 if(m.type==='close'){closed=true;clearInterval(timer);for(const c of calls.values())if(c.end)finalizeCall(c,'shutdown');await labeler.closeAsync(flush);await flush();await flush();parentPort.close();return;}
 try{stats.droppedTransportMessages=m.droppedTransportMessages??0;handle(m.type,m.data);}catch{stats.droppedRows++;stats.error='DATASET_EVENT_FAILED';}finally{parentPort.postMessage({type:'ack'});}
});
await prune(0);
