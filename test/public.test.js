import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {freshState} from '../src/engine.js';

const scenarios=[
 {name:'explicit Railway wrapper',entry:'railway.js',env:{}},
 {name:'default npm/Docker entry on Railway',entry:'server.js',env:{RAILWAY_SERVICE_ID:'test-service'}},
 {name:'Railway default entry preserves an existing risk halt',entry:'server.js',env:{RAILWAY_ENVIRONMENT_ID:'test-environment'},halted:true}
];
for(const scenario of scenarios)test(scenario.name,async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'meme-public-'));
 if(scenario.halted){const saved=freshState();saved.halted='existing-risk-halt';await writeFile(path.join(dir,'paper-state.json'),JSON.stringify(saved));}
 const child=spawn(process.execPath,['--import','./test/fixtures/scalp-feed.js','src/'+scenario.entry],{cwd:new URL('../',import.meta.url),env:{...process.env,PAPER_WORKSPACE:'true',PAPER_AUTOSTART:'true',PORT:'0',DATA_DIR:dir,...scenario.env},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',c=>{output+=c;});
 try{
  let base;
  for(let i=0;i<100;i++){const match=output.match(/0\.0\.0\.0:(\d+)/);if(match){base='http://127.0.0.1:'+match[1];break;}await delay(20);}
  assert.ok(base,'listening on public interface');
  let state;
  for(let i=0;i<100;i++){state=await (await fetch(base+'/api/state')).json();if(state.feed.updatedAt&&state.decisionStats.evaluated>0)break;await delay(20);}
  assert.ok(state.feed.updatedAt,'feed was actually loaded');
  assert.equal(state.agents.agents.length,10);assert.ok(state.agents.agents.every(a=>a.signal&&a.signal.evaluated===state.feed.markets.length&&a.signal.cycle>=1&&Number.isFinite(a.signalAt)),'all ten strategies publish real evaluation telemetry through the HTTP snapshot');
  assert.equal(state.experiment.certificationsRequired,false);assert.equal(state.experiment.entryMode,'ten-strategy-rules');assert.equal(state.experiment.uniqueEntryMints,true);assert.equal(state.entryPolicy.uniqueEntryMints,true);assert.equal(state.entryPolicy.strategyGatesRequired,true);assert.equal(state.entryPolicy.reentryCooldownMs,1800000);assert.equal(state.portfolio.operationalCapacity,10);assert.equal(state.readOnly,true);assert.equal(state.mode,'paper');
  assert.equal(state.running,true);
  if(scenario.halted){assert.equal(state.cashSol,20);assert.equal(state.positions.length,0);}
  else{assert.equal(state.positions.length,0,'incomplete external data must never create an entry');assert.ok(state.decisionStats.evaluated>0);assert.ok(state.decisions.some(d=>['strategy-data','market','execution'].includes(d.blockingStage)));}
  for(const action of ['reset','pause','buy','sell','add-token']){
   const r=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'meme-desk'},body:JSON.stringify({action,confirm:'RESET PAPER'})});assert.equal(r.status,403);
  }
  const health=await (await fetch(base+'/api/health')).json();assert.equal(health.running,true);assert.equal(health.readOnly,true);assert.equal(health.realTradingEnabled,false);assert.equal(health.unattendedSigningAvailable,false);assert.equal(state.settings.initialSol,20);assert.equal(state.cashSol,20);assert.equal(state.realTradingEnabled,false);
  for(const p of ['/api/direct/prepare','/api/direct/submit','/api/signer/unlock','/api/signer/enable','/api/live/enable']){const r=await fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,410);}
  const page=await(await fetch(base)).text();assert.match(page,/MÔ PHỎNG 20 SOL/);assert.ok(!page.includes('/wallet.js'));assert.ok(!page.includes('spider-companion'));assert.equal((await fetch(base+'/spider.js')).status,404);const activity=await(await fetch(base+'/api/activity')).json();assert.ok(Number.isFinite(activity.observedAt));assert.ok(Array.isArray(activity.verification));assert.ok(!JSON.stringify(activity).includes('keypair'));assert.equal((await fetch(base+'/activity.js')).status,200);assert.equal((await fetch(base+'/wallet.js')).status,404);
  assert.equal((await fetch(base)).status,200);
 }finally{const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;await rm(dir,{recursive:true,force:true});}
});
