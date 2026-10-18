import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rpcScheduler,withRpcPriority} from '../src/rpc-priority.js';
test('SELL has a reserved RPC lane and overtakes queued BUY/background reads without exceeding four active requests',async()=>{
 const schedule=rpcScheduler(),started=[],release=[];let active=0,peak=0;
 const work=name=>()=>new Promise(resolve=>{started.push(name);active++;peak=Math.max(peak,active);release.push(()=>{active--;resolve(name);});});
 const low=Array.from({length:5},(_,i)=>withRpcPriority('background',()=>schedule('getAccountInfo',work('low'+i))));await new Promise(setImmediate);assert.equal(started.length,3);
 const sell=withRpcPriority('exit',()=>schedule('getAccountInfo',work('SELL')));await new Promise(setImmediate);assert.deepEqual(started,['low0','low1','low2','SELL']);
 release.shift()();await new Promise(setImmediate);assert.equal(started.length,4);while(release.length){release.shift()();await new Promise(setImmediate);}await Promise.all([...low,sell]);assert.ok(peak<=4);
});
test('bulk holder scans cannot monopolize RPC lanes and receipt reads retain priority',async()=>{
 const schedule=rpcScheduler(),started=[],release=[];
 const work=name=>()=>new Promise(resolve=>{started.push(name);release.push(resolve);});
 const a=withRpcPriority('background',()=>schedule('getProgramAccounts',work('scan1'))),b=withRpcPriority('background',()=>schedule('getProgramAccounts',work('scan2'))),c=withRpcPriority('receipt',()=>schedule('getSignatureStatuses',work('receipt')));await new Promise(setImmediate);assert.deepEqual(started,['scan1','receipt']);
 while(release.length){release.shift()();await new Promise(setImmediate);}await Promise.all([a,b,c]);assert.equal(started[2],'scan2');
});
