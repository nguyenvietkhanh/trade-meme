import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {mkdir,open,readdir,readFile,statfs} from 'node:fs/promises';
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
 constructor(dir){this.dir=path.join(dir,'research','journal');this.session=randomBytes(8).toString('hex');this.rows=[];this.bytes=0;this.recorded=0;this.written=0;this.dropped=0;this.error=null;this.busy=null;this.io=Promise.resolve();this.enqueue({type:'session_start',at:Date.now(),session:this.session,buildRevision:process.env.RAILWAY_GIT_COMMIT_SHA??'local',bufferDurable:false});}
 enqueue(row){const line=JSON.stringify({...row,eventId:`${this.session}:${this.recorded+this.dropped}`})+'\n',bytes=Buffer.byteLength(line);if(this.bytes+bytes>MAX_BUFFER){this.dropped++;this.error='Kho nghiên cứu chưa theo kịp; có bản ghi thiếu. Không ảnh hưởng sổ giao dịch thật.';return false;}this.rows.push(line);this.bytes+=bytes;this.recorded++;return true;}
 scan(feed){const now=Date.now();return this.enqueue({type:'scan',at:now,sourceAt:num(feed.updatedAt),solUsd:num(feed.solUsd),curveSource:feed.sources?.pumpFun?.status??'unknown',rows:feed.markets.map(m=>{const r=rankMarket(m,undefined,now);return {mint:id(m.mint),pool:id(m.pairAddress),action:r.eligible?'WATCH':'SKIP',stage:r.blockingStage,redFlags:r.red_flags,features:entryFeatures(m,feed.solUsd)};})});}
 execution(stage,order={},extra={}){
  const q=order.quoteBenchmark??{},timing=extra.timing??{},r=extra.result??{};
  return this.enqueue({type:'execution',stage,at:Date.now(),id:id(order.id??extra.attemptId),side:['BUY','SELL','PROFIT'].includes(order.side)?order.side:null,mint:id(order.mint),venue:id(order.venue),amount:id(order.amount),orderSol:num(order.orderSol),signature:id(extra.signature??r.signature),status:id(r.status),errorCode:extra.error?errorCode(extra.error):null,
   quote:{checkedAt:num(q.checkedAt),contextSlot:num(q.contextSlot),outAmount:id(q.outAmount),minOut:id(q.minOut),netSol:num(q.netSol)},
   timing:Object.fromEntries(['decisionAt','feedAgeMs','prepareMs','signMs','broadcastStartedAt','broadcastRpcMs','confirmationMs'].map(k=>[k,num(timing[k])])),
   trigger:order.exitTrigger?{at:num(order.exitTrigger.at),quoteCheckedAt:num(order.exitTrigger.quoteCheckedAt),expectedNetSol:num(order.exitTrigger.expectedNetSol)}:null,
   receipt:{slot:num(r.slot),solDelta:num(r.solDelta),feeSol:num(r.feeSol),tokenDelta:r.tokenDelta!=null?id(String(r.tokenDelta)):null}});
 }
 status(){return {recordedThisProcess:this.recorded,writtenThisProcess:this.written,bufferedRows:this.rows.length,droppedThisProcess:this.dropped,error:this.error,durableOnVolumeOnly:true};}
 flush(){if(this.busy)return this.busy;if(!this.rows.length)return Promise.resolve();
  const rows=this.rows.slice(),bytes=rows.reduce((n,r)=>n+Buffer.byteLength(r),0),at=new Date(),day=at.toISOString().slice(0,10),name=at.toISOString().slice(11,13)+'-'+this.session+'.jsonl.gz';
  const work=async()=>{try{await mkdir(path.join(this.dir,day),{recursive:true,mode:0o700});const disk=await statfs(this.dir);if(disk.bavail*disk.bsize<32*1024*1024)throw Error('disk-full');const compressed=await compress(rows.join(''));const file=await open(path.join(this.dir,day,name),'a',0o600);try{await file.writeFile(compressed);await file.sync();}finally{await file.close();}this.rows.splice(0,rows.length);this.bytes-=bytes;this.written+=rows.length;if(!this.dropped)this.error=null;}
   catch{this.error='Chưa ghi được kho nghiên cứu; dữ liệu đệm có thể mất khi restart. SELL vẫn hoạt động.';}};
  this.busy=this.io.then(work).finally(()=>{this.busy=null;});this.io=this.busy.catch(()=>{});return this.busy;
 }
 async files(){let days;try{days=await readdir(this.dir);}catch(e){if(e.code==='ENOENT')return [];throw e;}const files=[];for(const day of days.filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)).sort())for(const name of (await readdir(path.join(this.dir,day))).filter(n=>/^\d{2}-[a-f0-9]{16}\.jsonl\.gz$/.test(n)))files.push(day+'/'+name);return files;}
 async document(name){if(typeof name!=='string'||!/^\d{4}-\d{2}-\d{2}\/\d{2}-[a-f0-9]{16}\.jsonl\.gz$/.test(name))throw Error('Tên tệp nghiên cứu không hợp lệ.');await this.flush();const task=this.io.then(()=>readFile(path.join(this.dir,name)));this.io=task.then(()=>{},()=>{});return task;}
}
