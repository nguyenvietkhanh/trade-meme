// Only unsigned intent preparation is reordered. Signed transactions/receipts are never retried here.
export class RulesIntentQueue {
 constructor({max=32}={}){this.max=max;this.active=false;this.pending=[];this.jobs=new Map();}
 run(id,binding,side,work){const prior=this.jobs.get(id);if(prior){if(prior.binding!==binding)return Promise.reject(Object.assign(Error('LIVE_INTENT_REUSE_MISMATCH'),{code:'LIVE_INTENT_REUSE_MISMATCH'}));return prior.promise;}
  if(this.pending.length>=this.max)return Promise.reject(Object.assign(Error('RULES_INTENT_QUEUE_FULL'),{code:'RULES_INTENT_QUEUE_FULL'}));
  let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});this.jobs.set(id,{binding,promise});this.pending.push({id,side,work,resolve,reject});this.drain();return promise;
 }
 drain(){if(this.active||!this.pending.length)return;this.pending.sort((a,b)=>Number(b.side==='SELL')-Number(a.side==='SELL'));const job=this.pending.shift();this.active=true;Promise.resolve().then(job.work).then(job.resolve,job.reject).finally(()=>{this.jobs.delete(job.id);this.active=false;this.drain();});}
}
