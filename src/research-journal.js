import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {mkdir,open,readdir,readFile,statfs,lstat,unlink,rmdir} from 'node:fs/promises';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
import {entryFeatures} from './training-records.js';
import {rankMarket} from './strategy.js';
const compress=promisify(gzip),MAX_BUFFER=2*1024*1024;
const id=v=>typeof v==='string'?v.slice(0,160):null;
const num=v=>Number.isFinite(v)?v:null;
const errorCode=e=>{const s=String(e?.message??'');return /429/.test(s)?'HTTP_429':/403/.test(s)?'HTTP_403':/RPC/.test(s)?'RPC_ERROR':/timeout|hết thời gian/i.test(s)||e?.name==='TimeoutError'?'TIMEOUT':'POLICY_OR_PROVIDER_ERROR';};
/** Append-only compressed research data, outside the signed transaction journal.
 * Bounded buffering may lose records on disk failure; gaps are explicit and never
 * hold a live SELL or pretend to be a complete training dataset.
 */
export class ResearchJournal{
 constructor(dir,{maxBytes=32*1024*1024,maxAgeMs=3*86400000,minFreeBytes=64*1024*1024,snapshotIntervalMs=30000,scanIntervalMs=30000,clock=Date.now}={}){this.retention={maxBytes,maxAgeMs,minFreeBytes};this.clock=clock;this.snapshotIntervalMs=snapshotIntervalMs;this.scanIntervalMs=scanIntervalMs;this.lastSnapshotAt=null;this.lastScanAt=null;this.sampled=0;this.prunedFiles=0;this.prunedBytes=0;this.archiveBytes=null;this.dir=path.join(dir,'research','journal');this.session=randomBytes(8).toString('hex');this.rows=[];this.bytes=0;this.recorded=0;this.written=0;this.dropped=0;this.error=null;this.busy=null;this.io=Promise.resolve();this.enqueue({type:'session_start',at:Date.now(),session:this.session,buildRevision:process.env.RAILWAY_GIT_COMMIT_SHA??'local',bufferDurable:false});}
 enqueue(row){if(row.type==='paper_replay_snapshot'){const now=this.clock();if(this.lastSnapshotAt!==null&&now-this.lastSnapshotAt<this.snapshotIntervalMs){this.sampled++;return false;}this.lastSnapshotAt=now;}const line=JSON.stringify({...row,eventId:`${this.session}:${this.recorded+this.dropped}`})+'\n',bytes=Buffer.byteLength(line);if(this.bytes+bytes>MAX_BUFFER){this.dropped++;this.error='Kho nghiên cứu chưa theo kịp; có bản ghi thiếu. Không ảnh hưởng sổ giao dịch thật.';return false;}this.rows.push(line);this.bytes+=bytes;this.recorded++;return true;}
 scan(feed,{rankMarket:analyst=rankMarket}={}){const now=this.clock();if(this.lastScanAt!==null&&now-this.lastScanAt<this.scanIntervalMs){this.sampled++;return false;}this.lastScanAt=now;return this.enqueue({type:'scan',at:now,sourceAt:num(feed.updatedAt),solUsd:num(feed.solUsd),entryVenue:'pumpswap',rows:feed.markets.map(m=>{const r=analyst(m,undefined,now);return {mint:id(m.mint),pool:id(m.pairAddress),action:r.eligible?'WATCH':'SKIP',stage:r.blockingStage,minScore:r.minScore,blockingCategory:r.blockingCategory,primaryFlags:r.primaryFlags,redFlags:r.red_flags,features:entryFeatures(m,feed.solUsd)};})});}
 execution(stage,order={},extra={}){
  const q=order.quoteBenchmark??{},timing=extra.timing??{},r=extra.result??{};
  return this.enqueue({type:'execution',stage,at:Date.now(),id:id(order.id??extra.attemptId),side:['BUY','SELL','PROFIT'].includes(order.side)?order.side:null,mint:id(order.mint),venue:id(order.venue),amount:id(order.amount),orderSol:num(order.orderSol),signature:id(extra.signature??r.signature),status:id(r.status),errorCode:extra.error?errorCode(extra.error):null,
   quote:{checkedAt:num(q.checkedAt),contextSlot:num(q.contextSlot),outAmount:id(q.outAmount),minOut:id(q.minOut),netSol:num(q.netSol)},
   timing:Object.fromEntries(['decisionAt','feedAgeMs','prepareMs','signMs','broadcastStartedAt','broadcastRpcMs','confirmationMs'].map(k=>[k,num(timing[k])])),
   trigger:order.exitTrigger?{at:num(order.exitTrigger.at),quoteCheckedAt:num(order.exitTrigger.quoteCheckedAt),expectedNetSol:num(order.exitTrigger.expectedNetSol)}:null,
   receipt:{slot:num(r.slot),solDelta:num(r.solDelta),feeSol:num(r.feeSol),tokenDelta:r.tokenDelta!=null?id(String(r.tokenDelta)):null}});
 }
 status(){return {retention:{...this.retention,archiveBytes:this.archiveBytes,prunedFiles:this.prunedFiles,prunedBytes:this.prunedBytes,snapshotIntervalMs:this.snapshotIntervalMs,scanIntervalMs:this.scanIntervalMs,sampledOutThisProcess:this.sampled,scope:"research-only; not a complete replay"},recordedThisProcess:this.recorded,writtenThisProcess:this.written,bufferedRows:this.rows.length,droppedThisProcess:this.dropped,error:this.error,durableOnVolumeOnly:true};}
 flush(){if(this.busy)return this.busy;if(!this.rows.length)return Promise.resolve();
  const rows=this.rows.slice(),bytes=rows.reduce((n,r)=>n+Buffer.byteLength(r),0),at=new Date(),day=at.toISOString().slice(0,10),name=at.toISOString().slice(11,13)+'-'+this.session+'.jsonl.gz';
  const work=async()=>{try{await mkdir(path.join(this.dir,day),{recursive:true,mode:0o700});const compressed=await compress(rows.join(''));await this.prune(compressed.length);const disk=await statfs(this.dir);if(disk.bavail*disk.bsize<this.retention.minFreeBytes+compressed.length||this.archiveBytes+compressed.length>this.retention.maxBytes)throw Error('research-capacity');await mkdir(path.join(this.dir,day),{recursive:true,mode:0o700});const file=await open(path.join(this.dir,day,name),'a',0o600);try{await file.writeFile(compressed);await file.sync();}finally{await file.close();}this.rows.splice(0,rows.length);this.bytes-=bytes;this.written+=rows.length;this.archiveBytes+=compressed.length;if(!this.dropped)this.error=null;}
   catch{this.error='Chưa ghi được kho nghiên cứu; dữ liệu đệm có thể mất khi restart. SELL vẫn hoạt động.';}};
  this.busy=this.io.then(work).finally(()=>{this.busy=null;});this.io=this.busy.catch(()=>{});return this.busy;
 }
 // Only recognized regular research archives may be deleted. Never recurse through
 // symlinks, and never touch ledger, fills, state, Telegram or signing files.
 async prune(incomingBytes=0){
  const parent=await lstat(path.dirname(this.dir)),root=await lstat(this.dir);if(!parent.isDirectory()||parent.isSymbolicLink()||!root.isDirectory()||root.isSymbolicLink())throw Error('unsafe-research-root');
  const beforeFiles=this.prunedFiles,beforeBytes=this.prunedBytes,files=[];
  for(const day of await readdir(this.dir)){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(day))continue;
   const dir=path.join(this.dir,day),ds=await lstat(dir);if(!ds.isDirectory()||ds.isSymbolicLink())continue;
   for(const name of await readdir(dir)){
    if(!/^\d{2}-[a-f0-9]{16}\.jsonl\.gz$/.test(name))continue;
    const file=path.join(dir,name),st=await lstat(file);if(!st.isFile()||st.isSymbolicLink())continue;
    files.push({file,dir,bytes:st.size,at:Date.parse(day+'T'+name.slice(0,2)+':00:00Z')});
   }
  }
  files.sort((a,b)=>a.at-b.at||a.file.localeCompare(b.file));
  let bytes=files.reduce((n,f)=>n+f.bytes,0);const disk=await statfs(this.dir);let free=disk.bavail*disk.bsize;
  for(const f of files){
   if(f.at>=this.clock()-this.retention.maxAgeMs&&bytes+incomingBytes<=this.retention.maxBytes&&free>=this.retention.minFreeBytes+incomingBytes)continue;
   await unlink(f.file);bytes-=f.bytes;free+=f.bytes;this.prunedFiles++;this.prunedBytes+=f.bytes;
   try{await rmdir(f.dir);}catch(e){if(!['ENOTEMPTY','ENOENT'].includes(e.code))throw e;}
  }
  this.archiveBytes=bytes;
  if(this.prunedFiles>beforeFiles)console.info(`RESEARCH CLEANUP | files=${this.prunedFiles-beforeFiles} | freedMiB=${((this.prunedBytes-beforeBytes)/1048576).toFixed(2)} | retainedMiB=${(bytes/1048576).toFixed(2)} | financial-ledger=untouched`);
 }
 async maintain(){const task=this.io.then(async()=>{try{await mkdir(this.dir,{recursive:true,mode:0o700});await this.prune();}catch{this.error='Chưa dọn được kho nghiên cứu; không xóa sổ giao dịch.';}});this.io=task.catch(()=>{});return task;}
 async files(){let days;try{days=await readdir(this.dir);}catch(e){if(e.code==='ENOENT')return [];throw e;}const files=[];for(const day of days.filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)).sort())for(const name of (await readdir(path.join(this.dir,day))).filter(n=>/^\d{2}-[a-f0-9]{16}\.jsonl\.gz$/.test(n)))files.push(day+'/'+name);return files;}
 async document(name){if(typeof name!=='string'||!/^\d{4}-\d{2}-\d{2}\/\d{2}-[a-f0-9]{16}\.jsonl\.gz$/.test(name))throw Error('Tên tệp nghiên cứu không hợp lệ.');await this.flush();const task=this.io.then(()=>readFile(path.join(this.dir,name)));this.io=task.then(()=>{},()=>{});return task;}
}
