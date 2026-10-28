import {Worker} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';
export function datasetConfig(env=process.env){const n=(k,d,min,max)=>{const v=Number(env[k]??d);return Number.isFinite(v)?Math.max(min,Math.min(max,v)):d;};return {enabled:env.DATASET_ENABLED==='true',maxBytes:n('DATASET_MAX_MIB',500,1,2000)*1048576,maxAgeMs:n('DATASET_RETENTION_DAYS',14,1,365)*86400000,minFreeBytes:n('DATASET_MIN_FREE_MIB',64,1,Number.MAX_SAFE_INTEGER/1048576)*1048576,bufferBytes:n('DATASET_BUFFER_MIB',4,1,32)*1048576,maxActive:n('DATASET_MAX_ACTIVE_LABELS',30000,100,100000),maxMessages:n('DATASET_MAX_QUEUED_MESSAGES',16,2,128),flushMs:n('DATASET_FLUSH_MS',5000,1000,60000),partBytes:4*1048576};}
export class DatasetCollector{
 constructor(dir,{env=process.env,addresses=[]}={}){this.config=datasetConfig(env);this.pending=0;this.dropped=0;this.stats={};if(!this.config.enabled)return;
  try{this.worker=new Worker(new URL('./dataset-worker.js',import.meta.url),{workerData:{dir,config:this.config,addresses},env:{TZ:'UTC'},resourceLimits:{maxOldGenerationSizeMb:256}});}catch{this.failed=true;this.stats.error='DATASET_WORKER_START_FAILED';return;}
  this.worker.on('message',m=>{if(m.type==='ack')this.pending=Math.max(0,this.pending-1);if(m.type==='status')this.stats=m.status;});this.worker.on('error',()=>{this.failed=true;this.stats.error='DATASET_WORKER_FAILED';});this.worker.on('exit',()=>{this.failed=true;});
 }
 record(type,data){if(!this.worker||this.failed||this.closing)return false;if(this.pending>=this.config.maxMessages||(type==='prices'&&this.pending>=Math.max(1,this.config.maxMessages-4))){this.dropped++;return false;}try{this.pending++;this.worker.postMessage({type,data,droppedTransportMessages:this.dropped});return true;}catch{this.pending=Math.max(0,this.pending-1);this.dropped++;return false;}}
 callId(){return randomUUID();}
 error(e,provider=''){this.record('error',{at:Date.now(),code:e?.code??String(e?.message??'').match(/\b(?:LIVE|MODEL|RPC)_[A-Z0-9_]+\b/)?.[0]??'UNCLASSIFIED',message:String(e?.message??'').slice(0,250),provider});}
 status(){return {enabled:this.config.enabled,...this.stats,queuedMessages:this.pending,droppedTransportMessages:this.dropped,limits:this.config};}
 sample(snapshot,treasury){if(!this.config.enabled)return;const positions=treasury?.positions??[];this.record('prices',{at:Date.now(),prices:(snapshot.markets??[]).map(m=>({mint:m.mint,spotPriceSol:m.spotPriceSol??null,priceAt:m.priceAt??null})),positions:positions.map(p=>({positionId:p.paperPositionId,mint:p.mint,quantity:p.quantity,costSol:p.costSol,openedAt:p.openedAt,stopLossPct:p.aiStopLossPct,decimals:p.decimals}))});}
 async close(){if(!this.worker||this.failed||this.worker.threadId===-1)return;this.closing=true;await new Promise(resolve=>{const timer=setTimeout(()=>{this.worker.terminate();resolve();},10000);this.worker.once('exit',()=>{clearTimeout(timer);resolve();});this.worker.postMessage({type:'close'});});}
}
