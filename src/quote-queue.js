import {rpcPriority} from './rpc-priority.js';
/** One read at a time; queued exits precede entries and background verification.
 * No transaction, signature, or broadcast is ever queued/retried here.
 */
export function quoteScheduler({intervalMs=1100,queueTimeoutMs=8000,clock=Date.now}={}){
 let active=false,nextAt=0,timer=null;const queue=[];
 const waiting=()=>Object.assign(Error('Jupiter quote đang chờ hạn mức; thử lại vòng sau.'),{code:'QUOTE_QUEUE_BUSY'});
 const drain=()=>{
  if(active||!queue.length)return;
  const delay=Math.max(0,nextAt-clock());if(delay){if(!timer)timer=setTimeout(()=>{timer=null;drain();},delay);return;}
  queue.sort((a,b)=>a.priority-b.priority);const job=queue.shift();clearTimeout(job.timer);active=true;nextAt=clock()+intervalMs;
  Promise.resolve().then(job.work).then(job.resolve,job.reject).finally(()=>{active=false;drain();});
 };
 return work=>new Promise((resolve,reject)=>{
  const lane=rpcPriority(),priority=lane==='exit'?0:lane==='background'||lane==='research'?2:1;
  if(queue.length>=8){reject(waiting());return;}
  const job={work,resolve,reject,priority};job.timer=setTimeout(()=>{const i=queue.indexOf(job);if(i>=0){queue.splice(i,1);reject(waiting());if(!queue.length&&timer){clearTimeout(timer);timer=null;}}},queueTimeoutMs);
  queue.push(job);drain();
 });
}
