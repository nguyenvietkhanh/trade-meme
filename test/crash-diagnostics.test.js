import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadRejectionCache} from '../src/read-rejection-cache.js';
import {runtimeMemory,processMemory} from '../src/runtime-memory.js';
test('rejected-read cache is bounded, expires, and does not memoize transient RPC errors',()=>{
 let now=1000;const c=new ReadRejectionCache({clock:()=>now,maxEntries:8});assert.equal(c.remember('rpc',Error('RPC_UNAVAILABLE')),false);
 for(let i=0;i<1000;i++)c.remember('pair'+i,Error('Pool mint mismatch'));assert.equal(c.rows.size,8);assert.equal(c.get('pair0'),null);assert.equal(c.get('pair999').code,'READ_POOL_IDENTITY_REJECTED');now+=600000;assert.equal(c.get('pair999'),null);
});
test('memory diagnostic includes cgroup limits and separate child memory, without conflating RSS with V8 heap',async()=>{
 const read=async name=>name.endsWith('memory.current')?String(450*1048576):name.endsWith('memory.max')?String(512*1048576):'oom 2\noom_kill 1\nhigh 3\nmax 9\n';
 const result=await runtimeMemory({workers:new Map([['kade',{id:'kade',memory:{at:Date.now(),rssMiB:100,heapUsedMiB:20}}]])},{read});assert.equal(result.containerCurrentMiB,450);assert.equal(result.containerLimitMiB,512);assert.equal(result.containerMemoryEvents.oom_kill,1);assert.equal(result.workers[0].rssMiB,100);assert.ok(result.externalMiB>=0);assert.ok(processMemory().rssMiB>0);
});
test('absent cgroup diagnostics remain null and never fail the server memory loop',async()=>{
 const r=await runtimeMemory(null,{read:async()=>{throw Error('not available');}});assert.equal(r.containerCurrentMiB,null);assert.equal(r.containerLimitMiB,null);assert.deepEqual(r.containerMemoryEvents,{});assert.equal(r.cgroupCoverage,'unavailable');
});
