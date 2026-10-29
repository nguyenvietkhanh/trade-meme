import {readFile} from 'node:fs/promises';
const mib=n=>Math.round(n/1048576);
export function processMemory(){const m=process.memoryUsage();return {at:Date.now(),heapUsedMiB:mib(m.heapUsed),heapTotalMiB:mib(m.heapTotal),rssMiB:mib(m.rss),externalMiB:mib(m.external),arrayBuffersMiB:mib(m.arrayBuffers),uptimeSeconds:Math.round(process.uptime())};}
export async function runtimeMemory(supervisor,{read=readFile}={}){
 const files=['/sys/fs/cgroup/memory.current','/sys/fs/cgroup/memory.max','/sys/fs/cgroup/memory.events'];
 const results=await Promise.allSettled(files.map(p=>read(p,'utf8'))),value=i=>results[i].status==='fulfilled'?results[i].value.trim():null;
 const number=s=>s!==null&&/^\d+$/.test(s)&&Number.isSafeInteger(Number(s))?Number(s):null,current=number(value(0)),limit=number(value(1));
 const workers=[...(supervisor?.workers.values()??[])].filter(r=>!r.exited).map(r=>({id:r.id,ageMs:r.memory?Date.now()-r.memory.at:null,...(r.memory??{rssMiB:null})}));
 const events=Object.fromEntries((value(2)??'').split('\n').map(line=>line.split(/\s+/)).filter(([key,n])=>['oom','oom_kill','max','high'].includes(key)&&/^\d+$/.test(n)).map(([key,n])=>[key,Number(n)]));
 return {...processMemory(),workers,containerCurrentMiB:current===null?null:mib(current),containerLimitMiB:limit===null?null:mib(limit),containerMemoryEvents:events,cgroupCoverage:value(0)===null?'unavailable':'v2'};
}
