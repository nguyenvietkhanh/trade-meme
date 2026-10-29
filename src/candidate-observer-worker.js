import {parentPort,workerData} from 'node:worker_threads';
import {CandidateStore} from './candidate-observer-store.js';
import {publicPair} from './candidate-observer-data.js';
const config=workerData;
let store,busyUntil=0,active=false,closing=false,nextRequestAt=0,failures=0,lastStatus=0,lastError=null,apiCalls=0,requestController=null,deferredForTrading=0,droppedMessages=0;
function error(code){lastError=code;parentPort.postMessage({error:code});}
function status(){return {...store.status(),lastError,apiCalls,nextRequestAt,deferredForTrading,droppedMessages};}
try{store=new CandidateStore(config);parentPort.postMessage({status:status()});}
catch{error('STORAGE_OPEN_FAILED');process.exitCode=1;parentPort.close();}
async function boundedJson(response){
 let size=0;const parts=[];
 for await(const part of response.body){size+=part.length;if(size>2*1048576)throw Error('BODY_LIMIT');parts.push(part);}
 return JSON.parse(Buffer.concat(parts).toString());
}
async function sample(now){
 const rows=store.due(now);if(!rows.length)return;
 const withPools=rows.filter(r=>r.pool),batch=withPools.length?withPools:rows;
 const endpoint=withPools.length?'https://api.dexscreener.com/latest/dex/pairs/solana/':'https://api.dexscreener.com/latest/dex/tokens/';
 nextRequestAt=now+config.intervalMs;store.transaction(()=>store.polled(batch,now));
 requestController=new AbortController();const timeout=setTimeout(()=>requestController?.abort(),4000);
 try{
  // Single low-priority public batch; no Jupiter, RPC, signer or trading capability.
  apiCalls++;const r=await fetch(endpoint+batch.map(r=>r.pool??r.mint).join(','),{signal:requestController.signal,redirect:'error'});
  if(!r.ok){
   const raw=r.headers.get('retry-after'),retry=raw===null?null:Number.isFinite(Number(raw))?Number(raw)*1000:Date.parse(raw)-Date.now();
   await r.body?.cancel();const backoff=Math.min(300000,30000*2**Math.min(failures++,4));nextRequestAt=Date.now()+Math.max(config.intervalMs,backoff,Number.isFinite(retry)?retry:0);error('DEX_HTTP_'+r.status);return;
  }
  const data=await boundedJson(r);if(!Array.isArray(data.pairs))throw Error('SHAPE');
  const at=Date.now(),allowed=new Set(batch.map(r=>r.mint));
  store.transaction(()=>{for(const p of data.pairs){const row=publicPair(p,at);if(row&&allowed.has(row.mint))store.seen(row,at);}});
  failures=0;lastError=null;
 }finally{clearTimeout(timeout);requestController=null;}
}
async function tick(){
 if(!store||active||closing)return;active=true;
 try{
  const now=Date.now();if(now-store.lastMaintain>60000||!store.hasSpace())store.maintain(now);
  if(!store.hasSpace()){error('OBSERVATION_DISK_RESERVE');return;}
  store.transaction(()=>store.expire(now));
  if(now>=nextRequestAt&&now>=busyUntil)await sample(now);
 }catch{nextRequestAt=Math.max(nextRequestAt,Date.now()+30000);error('OBSERVATION_READ_OR_STORAGE_FAILED');}
 finally{active=false;try{if(Date.now()-lastStatus>5000){lastStatus=Date.now();parentPort.postMessage({status:status()});}}catch{error('STATUS_UNAVAILABLE');}if(closing)finish();}
}
function finish(){try{store?.close();}catch{error('STORAGE_CLOSE_FAILED');}clearInterval(timer);parentPort.close();}
parentPort.on('message',msg=>{
 if(msg.type==='close'){closing=true;requestController?.abort();if(!active)finish();return;}
 if(!store||closing){parentPort.postMessage({ack:true});return;}
 try{if(!store.hasSpace()){droppedMessages+=(msg.rows??[]).length;error('OBSERVATION_DISK_RESERVE');parentPort.postMessage({ack:true});return;}store.transaction(()=>{
  for(const {kind,row}of msg.rows??[]){
   if(kind==='seen')store.seen(row);
   else if(kind==='decision')store.decision(row);
   else if(kind==='execution')store.execution(row);
   else if(kind==='load'){busyUntil=row.busy?Date.now()+3000:0;if(row.busy&&requestController){deferredForTrading++;requestController.abort();}}
  }
 });}catch{droppedMessages+=(msg.rows??[]).length;error('OBSERVATION_WRITE_FAILED');try{store.maintain();}catch{}}
 parentPort.postMessage({ack:true});
});
const timer=setInterval(()=>void tick(),1000);if(!store)clearInterval(timer);
