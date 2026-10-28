import {ACTIVE_BOT_CONFIGS as BOT_CONFIGS} from './paper-bot-config.js';
import {BotStateStore} from './paper-bot-state.js';
import {ModelBotRuntime as BotRuntime} from './paper-model-runtime.js';
import {LiveModelBotRuntime} from './live-model-runtime.js';
import {MultiLiveModelRuntime} from './multi-live-runtime.js';
import {startPaperLoop} from './paper-loop.js';
const [id,dir]=process.argv.slice(2),config=BOT_CONFIGS.find(a=>a.id===id);if(!config)throw Error('Unknown bot');
const store=new BotStateStore(dir,id),state=await store.load();await store.flush(state);state.running=process.argv[4]!=='false';if(state.workerStarts)state.restarts++;state.workerStarts=(state.workerStarts??0)+1;await store.save(state);
let snapshot=null,closing=false,seq=0;const requests=new Map(),bootAt=Date.now(),priorUptime=state.uptimeMs??0;
const send=data=>{if(process.connected)process.send(data,error=>{if(error&&!closing)console.error('worker IPC',id,error.message);});};
let lastSaveAt=0,lastSentAt=0,lastFingerprint='';
const modelSettings=process.argv[5]?JSON.parse(process.argv[5]):{};
const Runtime=modelSettings.mode==='live'?(modelSettings.multiOrder?MultiLiveModelRuntime:LiveModelBotRuntime):BotRuntime;
const runtime=new Runtime(config,state,{ai:modelSettings,decide:context=>new Promise((resolve,reject)=>{const requestId=id+':model:'+(++seq),timer=setTimeout(()=>{requests.delete(requestId);reject(Object.assign(Error('MODEL_TIMEOUT'),{code:'MODEL_TIMEOUT'}));},(modelSettings.timeoutMs??15000)+5000);requests.set(requestId,{resolve,reject,timer});send({type:'model',requestId,context});}),save:async s=>{
 const now=Date.now(),fingerprint=JSON.stringify([s.cashSol,s.rentLockedSol,s.positions,s.pending,s.pendingOrders,s.cycle,s.sequence,s.running,s.maxDrawdownPct]);
 if(s.outbox.length||fingerprint!==lastFingerprint||now-lastSaveAt>=5000){await store.save(s);await store.flush(s);lastSaveAt=now;lastFingerprint=fingerprint;}
 if(now-lastSentAt>=1000){send({type:'state',state:s});lastSentAt=now;}
},log:error=>send({type:'error',error}),execute:(input,m)=>new Promise((resolve,reject)=>{const requestId=id+':rpc:'+(++seq),timer=setTimeout(()=>{requests.delete(requestId);reject(Error('Execution data timeout'));},20000);requests.set(requestId,{resolve,reject,timer});send({type:'execute',requestId,input,market:{mint:m.mint,pairAddress:m.pairAddress,dexId:m.dexId}});})});
process.on('message',message=>{
 if(message.type==='snapshot')snapshot=message.snapshot;
 else if(message.type==='book'&&state.mode==='live'&&message.book?.id===id)Object.assign(state,message.book);
 else if(message.type==='running')state.running=message.running;
 else if(message.type==='reply'){const r=requests.get(message.requestId);if(r){clearTimeout(r.timer);requests.delete(message.requestId);message.error?r.reject(Object.assign(Error(message.error),{code:message.code,retryAt:message.retryAt})):r.resolve(message.result);}}
 else if(message.type==='shutdown')shutdown();
});
const loop=startPaperLoop(async()=>{state.uptimeMs=priorUptime+Date.now()-bootAt;if(snapshot&&!closing)await runtime.tick(snapshot,Date.now());else if(!closing){state.heartbeatAt=Date.now();send({type:'state',state});}},250,{onError:error=>{console.error(id,error);send({type:'error',error:{message:error.message}});}});
send({type:'state',state});
async function shutdown(){if(closing)return;closing=true;loop.stop();for(const r of requests.values()){clearTimeout(r.timer);r.reject(Error('Worker shutting down'));}requests.clear();await loop.done;await store.save(state);await store.flush(state);process.exit(0);}
process.on('SIGTERM',shutdown);process.on('disconnect',shutdown);
