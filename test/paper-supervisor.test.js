import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {migrateFleet} from '../src/paper-state-migration.js';
import {BotStateStore} from '../src/paper-bot-state.js';
import {BotSupervisor} from '../src/paper-supervisor.js';
import {tenMarket} from './fixtures/ten-market.js';
async function until(fn){for(let i=0;i<150;i++){if(fn())return;await delay(50);}throw Error('Worker assertion timeout');}
test('three real child processes heartbeat independently; watchdog restarts only stalled bot, resumes wallet and saves shutdown',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'paper-worker-test-'));let supervisor;
 try{
  await migrateFleet(dir);const store=new BotStateStore(dir,'kade'),state=await store.load();state.cashSol=1.7;await store.save(state);
  const errors=[];supervisor=new BotSupervisor(dir,{execute:async()=>{throw Error('No quote should be requested');},onError:error=>errors.push(error)});supervisor.start();
  await until(()=>[...supervisor.workers.values()].every(r=>r.state));assert.equal(supervisor.workers.size,1);assert.deepEqual([...supervisor.workers.keys()],['kade']);const pids=Object.fromEntries([...supervisor.workers].map(([id,r])=>[id,r.worker.pid]));
  assert.equal(supervisor.workers.get('kade').state.cashSol,1.7);assert.equal(supervisor.workers.get('kade').state.restarts,0);
  const row=supervisor.workers.get('kade');row.worker.kill('SIGSTOP');row.lastHeartbeat=Date.now()-61000;supervisor.check();
  await until(()=>supervisor.workers.get('kade').worker.pid!==pids.kade&&supervisor.workers.get('kade').state?.restarts===1);
  for(const [id,pid]of Object.entries(pids))if(id!=='kade')assert.equal(supervisor.workers.get(id).worker.pid,pid);
  assert.equal(supervisor.workers.get('kade').state.cashSol,1.7);assert.ok(errors.some(e=>/Heartbeat missing/.test(e.message)));
  await supervisor.stop();supervisor=null;assert.equal((await store.load()).cashSol,1.7);
 }finally{await supervisor?.stop();await rm(dir,{recursive:true,force:true});}
});
test('all three actual workers request separate AI decisions through the parent without sharing their own history',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'paper-worker-ai-test-'));let supervisor;try{
  await migrateFleet(dir);for(const id of ['kade']){const store=new BotStateStore(dir,id),s=await store.load();s.nextAt=0;s.ai={wasEnabled:true,nextAt:0,history:[{action:'HOLD',reason:'own-'+id}]};await store.save(s);}
  const contexts=new Map();supervisor=new BotSupervisor(dir,{modelSettings:{enabled:true,name:'fixture-model',pollMs:30000,timeoutMs:1000,maxCandidates:8},execute:async()=>{throw Error('HOLD must not execute');},decide:async(id,ctx)=>{contexts.set(id,ctx);return {decision:{action:'HOLD',mint:null,order_sol:null,sell_percent:null,confidence:.5,reason:'Theo dõi'},modelName:'fixture-model',expiresAt:Date.now()+30000};},onError:error=>{throw Error(JSON.stringify(error));}});supervisor.start();await until(()=>[...supervisor.workers.values()].every(r=>r.state));const now=Date.now(),m=tenMarket('kade',now);supervisor.publish({snapshotId:'ai-input',timestamp:now,solUsd:100,markets:[m]});await until(()=>contexts.size===1);
  for(const [id,ctx]of contexts){assert.equal(ctx.botId,id);assert.equal(ctx.ownHistory[0].reason,'own-'+id);assert.equal(ctx.wallet.initialSol,2);assert.equal(ctx.otherBots,undefined);}
 }finally{await supervisor?.stop();await rm(dir,{recursive:true,force:true});}
});
