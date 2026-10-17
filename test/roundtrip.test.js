import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
test('public Railway process autonomously buys then sells on a later quote and exposes activity',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'meme-roundtrip-'));
 const child=spawn(process.execPath,['--import','./test/fixtures/roundtrip-feed.js','src/server.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',DATA_DIR:dir,RAILWAY_SERVICE_ID:'isolated-test'},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',chunk=>{output+=chunk;});
 try{
  let base;
  for(let i=0;i<100;i++){const m=output.match(/0\.0\.0\.0:(\d+)/);if(m){base='http://127.0.0.1:'+m[1];break;}await delay(20);}
  assert.ok(base);
  let s;
  for(let i=0;i<100;i++){s=await(await fetch(base+'/api/state')).json();if(s.closedCount)break;await delay(20);}
  assert.ok(s.running);assert.equal(s.mode,'paper');assert.ok(s.closedCount>0);
  assert.ok(s.trades.some(t=>t.side==='BUY'&&t.reason==='auto-score:100'));
  assert.ok(s.trades.some(t=>t.side==='SELL'&&t.reason==='take-profit'));
  assert.ok(s.diagnostics.lastEvaluationAt);assert.ok(s.decisionStats.evaluated>0);assert.ok(s.cashSol>.3);
 }finally{const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done;await rm(dir,{recursive:true,force:true});}
});
