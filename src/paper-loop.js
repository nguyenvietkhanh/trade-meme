import {setTimeout as sleep} from 'node:timers/promises';
export function startPaperLoop(work,intervalMs,{onError=console.error,signal}={}){
 const controller=new AbortController();signal?.addEventListener('abort',()=>controller.abort(),{once:true});
 const done=(async()=>{while(!controller.signal.aborted){const start=Date.now();try{await work();}catch(error){onError(error);}try{await sleep(Math.max(10,intervalMs-(Date.now()-start)),undefined,{signal:controller.signal});}catch(error){if(error.name!=='AbortError')onError(error);}}})();
 return {stop:()=>controller.abort(),done};
}
