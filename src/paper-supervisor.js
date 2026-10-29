import {LatestIpc} from './latest-ipc.js';
import {fork} from 'node:child_process';
import {ACTIVE_BOT_CONFIGS as BOT_CONFIGS} from './paper-bot-config.js';
import {startPaperLoop} from './paper-loop.js';
export class BotSupervisor{
 constructor(dir,{execute,decide=null,cancelDecision=()=>{},modelSettings={},onState=()=>{},onError=console.error,onDataset=()=>{},clock=Date.now,running=true}={}){this.dir=dir;this.execute=execute;this.decide=decide;this.cancelDecision=cancelDecision;this.modelSettings=modelSettings;this.onState=onState;this.onError=onError;this.onDataset=onDataset;this.clock=clock;this.workers=new Map();this.closing=false;this.desiredRunning=running;}
 start(){for(const c of BOT_CONFIGS)this.spawn(c.id);this.watchdog=startPaperLoop(()=>this.check(),5000,{onError:this.onError});}
 spawn(id){
  if(this.closing)return;const prior=this.workers.get(id),worker=fork(new URL('./paper-bot-worker.js',import.meta.url),[id,this.dir,String(this.desiredRunning),JSON.stringify(this.modelSettings)],{execArgv:[],env:{NODE_ENV:process.env.NODE_ENV??'production',PATH:process.env.PATH,TZ:'UTC',PAPER_TESTING_MODE:process.env.PAPER_TESTING_MODE??'true'},stdio:['ignore','inherit','inherit','ipc']});
  const row={worker,id,lastHeartbeat:this.clock(),restarts:(prior?.restarts??-1)+1,startedAt:this.clock(),stopping:false};row.latestIpc=new LatestIpc(worker,{onError:this.onError});this.workers.set(id,row);
  worker.on('error',this.onError);worker.on('message',message=>{if(this.workers.get(id)!==row)return;
   if(message.type==='state'){row.lastHeartbeat=this.clock();row.state=message.state;this.onState(id,message.state,row);}
   else if(message.type==='memory'){const m=message.memory;if(m&&['at','heapUsedMiB','heapTotalMiB','rssMiB','externalMiB','arrayBuffersMiB','uptimeSeconds'].every(k=>Number.isFinite(m[k])&&m[k]>=0))row.memory=Object.fromEntries(['at','heapUsedMiB','heapTotalMiB','rssMiB','externalMiB','arrayBuffersMiB','uptimeSeconds'].map(k=>[k,m[k]]));}
   else if(message.type==='dataset'){try{this.onDataset(message.kind,message.data);}catch{}}
   else if(message.type==='error')this.onError({bot:id,...message.error});
   else if(message.type==='model')Promise.resolve().then(()=>{if(!this.decide)throw Object.assign(Error('MODEL_NOT_CONFIGURED'),{code:'MODEL_NOT_CONFIGURED'});return this.decide(id,message.context);}).then(result=>{if(worker.connected)worker.send({type:'reply',requestId:message.requestId,result});},error=>{if(worker.connected)worker.send({type:'reply',requestId:message.requestId,error:error.code??'MODEL_UNAVAILABLE',code:error.code??'MODEL_UNAVAILABLE',retryAt:error.retryAt??null,promptVersion:error.promptVersion??null,promptSha256:error.promptSha256??null});});
   else if(message.type==='execute')Promise.resolve().then(()=>this.execute(message.input,message.market,id)).then(result=>{if(worker.connected)worker.send({type:'reply',requestId:message.requestId,result});},error=>{this.onError({bot:id,message:error.message});if(worker.connected)worker.send({type:'reply',requestId:message.requestId,error:String(error.message).slice(0,250),code:error.code});});
  });
  worker.on('exit',(code,signal)=>{row.exited=true;this.cancelDecision(id);if(!this.closing){this.onError({bot:id,code,signal,message:'Worker exited; isolated restart scheduled'});row.restartTimer=setTimeout(()=>this.spawn(id),Math.min(30000,1000*2**Math.min(row.restarts,5)));}});
 }
 check(){for(const row of this.workers.values())if(!row.exited&&!row.stopping&&this.clock()-row.lastHeartbeat>60000){row.stopping=true;this.onError({bot:row.id,message:'Heartbeat missing 60s; restarting only this worker'});row.worker.kill('SIGKILL');}}
 publish(snapshot){for(const row of this.workers.values())if(row.worker.connected&&!row.exited)row.latestIpc.send('snapshot',{snapshot});}
 books(views){for(const [id,row]of this.workers)if(row.worker.connected&&!row.exited&&views[id])row.latestIpc.send('book',{book:views[id]});}
 running(value){this.desiredRunning=value;for(const row of this.workers.values())if(row.worker.connected)row.latestIpc.send('running',{running:value});}
 async stop(){this.closing=true;this.watchdog?.stop();await Promise.all([...this.workers.values()].map(row=>new Promise(resolve=>{clearTimeout(row.restartTimer);if(row.exited)return resolve();const timer=setTimeout(()=>row.worker.kill('SIGKILL'),10000);row.worker.once('exit',()=>{clearTimeout(timer);resolve();});row.worker.send({type:'shutdown'});})));await this.watchdog?.done;}
}
