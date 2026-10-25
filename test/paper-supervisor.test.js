import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {migrateFleet} from '../src/paper-state-migration.js';
import {BotStateStore} from '../src/paper-bot-state.js';
import {BotSupervisor} from '../src/paper-supervisor.js';
async function until(fn){for(let i=0;i<150;i++){if(fn())return;await delay(50);}throw Error('Worker assertion timeout');}
test('ten real child processes heartbeat independently; watchdog restarts only stalled bot, resumes wallet and saves shutdown',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'paper-worker-test-'));let supervisor;
 try{
  await migrateFleet(dir);const store=new BotStateStore(dir,'nova'),state=await store.load();state.cashSol=1.7;await store.save(state);
  const errors=[];supervisor=new BotSupervisor(dir,{execute:async()=>{throw Error('No quote should be requested');},onError:error=>errors.push(error)});supervisor.start();
  await until(()=>[...supervisor.workers.values()].every(r=>r.state));assert.equal(supervisor.workers.size,10);const pids=Object.fromEntries([...supervisor.workers].map(([id,r])=>[id,r.worker.pid]));
  assert.equal(supervisor.workers.get('nova').state.cashSol,1.7);assert.equal(supervisor.workers.get('nova').state.restarts,0);
  const row=supervisor.workers.get('nova');row.worker.kill('SIGSTOP');row.lastHeartbeat=Date.now()-61000;supervisor.check();
  await until(()=>supervisor.workers.get('nova').worker.pid!==pids.nova&&supervisor.workers.get('nova').state?.restarts===1);
  for(const [id,pid]of Object.entries(pids))if(id!=='nova')assert.equal(supervisor.workers.get(id).worker.pid,pid);
  assert.equal(supervisor.workers.get('nova').state.cashSol,1.7);assert.ok(errors.some(e=>/Heartbeat missing/.test(e.message)));
  await supervisor.stop();supervisor=null;assert.equal((await store.load()).cashSol,1.7);
 }finally{await supervisor?.stop();await rm(dir,{recursive:true,force:true});}
});
