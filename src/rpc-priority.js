import {AsyncLocalStorage} from 'node:async_hooks';
const context=new AsyncLocalStorage();
export const rpcPriority=()=>context.getStore();
export const withRpcPriority=(priority,work)=>context.run(priority,work);
export function rpcScheduler({maxConcurrent=Number(process.env.RPC_MAX_CONCURRENT??4),maxQueue=32}={}){
 if(!Number.isInteger(maxConcurrent)||maxConcurrent<2||maxConcurrent>8)throw Error('INVALID_RPC_MAX_CONCURRENT');
 let active=0,scans=0;const queue=[];
 const busy=()=>Object.assign(Error('RPC chờ lượt quá lâu; thử lại vòng sau.'),{waiting:true});
 const drain=()=>{while(active<maxConcurrent){const i=queue.findIndex(j=>(j.priority<2||active<maxConcurrent-1)&&(!j.scan||scans===0));if(i<0)return;const j=queue.splice(i,1)[0];clearTimeout(j.timer);active++;if(j.scan)scans++;Promise.resolve().then(j.work).then(j.resolve,j.reject).finally(()=>{active--;if(j.scan)scans--;drain();});}};
 return (method,work)=>new Promise((resolve,reject)=>{
  const lane=context.getStore(),priority=method==='sendTransaction'?0:lane==='exit'?0:lane==='receipt'?1:lane==='research'?4:lane==='background'||method==='getProgramAccounts'?3:2;
  if(queue.length>=maxQueue){const i=queue.findLastIndex(j=>j.priority>priority);if(i<0){reject(busy());return;}const old=queue.splice(i,1)[0];clearTimeout(old.timer);old.reject(busy());}
  const job={priority,scan:method==='getProgramAccounts',work,resolve,reject};job.timer=setTimeout(()=>{const i=queue.indexOf(job);if(i>=0){queue.splice(i,1);reject(busy());drain();}},8000);
  queue.push(job);queue.sort((a,b)=>a.priority-b.priority);drain();
 });
}
