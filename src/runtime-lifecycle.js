// Diagnostics only. Never reads account state, keys, error messages or transaction data.
import {appendFileSync,closeSync,constants,existsSync,fstatSync,lstatSync,mkdirSync,openSync,readFileSync,renameSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {getHeapStatistics} from 'node:v8';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const MAX_BYTES=128*1024;
let activeRecord=()=>{};
const label=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,64}$/.test(value)?value:null;
function openDiagnostic(file,write=false){
 if(existsSync(file)&&!lstatSync(file).isFile())throw Error('DIAGNOSTIC_NOT_REGULAR_FILE');
 return openSync(file,(write?constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT:constants.O_RDONLY)|(constants.O_NOFOLLOW??0),0o600);
}
function cgroup(){
 const result={};
 for(const [key,file]of [['currentBytes','memory.current'],['limitBytes','memory.max']]){
  try{const text=readFileSync('/sys/fs/cgroup/'+file,'utf8').trim();result[key]=/^\d+$/.test(text)?Number(text):null;}catch{result[key]=null;}
 }
 try{result.events=Object.fromEntries(readFileSync('/sys/fs/cgroup/memory.events','utf8').trim().split('\n').map(s=>s.split(/\s+/)).filter(([k,v])=>['oom','oom_kill','high','max'].includes(k)&&/^\d+$/.test(v)).map(([k,v])=>[k,Number(v)]));}catch{result.events=null;}
 return result;
}
export function runtimeLifecycle(kind,detail){activeRecord(kind,detail);}
export function installRuntimeLifecycle({env=process.env,proc=process,dir,log=console.info,warn=console.error}={}){
 const root=fileURLToPath(new URL('../',import.meta.url));
 dir??=env.RAILWAY_VOLUME_MOUNT_PATH?path.join(env.RAILWAY_VOLUME_MOUNT_PATH,'meme-pilot'):env.DATA_DIR??path.join(root,'.data');
 const file=path.join(dir,'runtime-lifecycle.jsonl'),previousFile=path.join(dir,'runtime-lifecycle.previous.jsonl'),bootId=randomUUID();
 let previous=null,reportedWriteFailure=false;
 try{mkdirSync(dir,{recursive:true,mode:0o700});if(existsSync(file)){const fd=openDiagnostic(file);try{if(fstatSync(fd).size<=MAX_BYTES+4096){const lines=readFileSync(fd,'utf8').trim().split('\n');const last=JSON.parse(lines.at(-1));previous={kind:label(last.kind),at:Number.isFinite(last.at)?last.at:null,bootId:label(last.bootId),exitCode:Number.isInteger(last.exitCode)?last.exitCode:null,deploymentId:label(last.deploymentId)};}}finally{closeSync(fd);}}}catch{}
 function record(kind,detail={}){
  const memory=proc.memoryUsage();
  const row={kind,at:Date.now(),bootId,pid:proc.pid,uptimeSeconds:Math.round(proc.uptime()),buildRevision:label(env.RAILWAY_GIT_COMMIT_SHA),deploymentId:label(env.RAILWAY_DEPLOYMENT_ID),replicaId:label(env.RAILWAY_REPLICA_ID),memory:{rss:memory.rss,heapUsed:memory.heapUsed,external:memory.external,heapLimit:getHeapStatistics().heap_size_limit},cgroup:cgroup()};
  if(kind==='boot'){row.previous=previous;row.port=String(env.PORT??3000).replace(/[^0-9]/g,'').slice(0,5);}
  if(kind==='exit')row.exitCode=Number.isInteger(detail.code)?detail.code:null;
  if(kind==='shutdown_requested')row.signal=label(detail.signal);
  if(kind==='fatal'){
   row.errorName=label(detail.error?.name);row.errorCode=label(detail.error?.code);row.origin=label(detail.origin);
   // Keep source locations, not the exception message/stack header (which may contain secrets).
   row.sourceFrames=[...String(detail.error?.stack??'').matchAll(/[/\\]src[/\\]([A-Za-z0-9_.-]+\.js):(\d+):(\d+)/g)].slice(0,8).map(m=>({file:m[1],line:Number(m[2]),column:Number(m[3])}));
  }
  const line=JSON.stringify(row);
  try{log('RUNTIME LIFECYCLE '+line);}catch{}
  try{
   if(existsSync(file)){const fd=openDiagnostic(file);let size;try{size=fstatSync(fd).size;}finally{closeSync(fd);}if(size+Buffer.byteLength(line)+1>MAX_BYTES)renameSync(file,previousFile);}
   const fd=openDiagnostic(file,true);try{appendFileSync(fd,line+'\n','utf8');}finally{closeSync(fd);}
  }catch{if(!reportedWriteFailure){reportedWriteFailure=true;try{warn('RUNTIME LIFECYCLE storage unavailable; console diagnostics remain enabled');}catch{}}}
 }
 const fatal=(error,origin)=>record('fatal',{error,origin}),exit=code=>record('exit',{code});
 // Monitor observes fatal exceptions without catching them or suppressing Node's exit.
 proc.on('uncaughtExceptionMonitor',fatal);proc.on('exit',exit);
 activeRecord=record;record('boot');
 return {record,file,dispose(){proc.off('uncaughtExceptionMonitor',fatal);proc.off('exit',exit);if(activeRecord===record)activeRecord=()=>{};}};
}
