import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
test('authenticated paper controls cannot expose/enable live signing and require same-origin mutations',async()=>{const dir=await mkdtemp(path.join(tmpdir(),'paper-http-')),child=spawn(process.execPath,['--import','./test/fixtures/paper-owner-feed.js','src/server.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);try{let base;for(let i=0;i<100;i++){const port=output.match(/127\.0\.0\.1:(\d+)/)?.[1];if(port){base='http://127.0.0.1:'+port;break;}await delay(20);}assert.ok(base);const headers={'Content-Type':'application/json','X-Requested-With':'meme-desk',Origin:base};
 const bad=await fetch(base+'/api/paper/pause',{method:'POST',headers:{...headers,Origin:'https://attacker.invalid'},body:'{"paused":true}'});assert.equal(bad.status,403);
 const paused=await fetch(base+'/api/paper/pause',{method:'POST',headers,body:'{"paused":true}'});assert.equal(paused.status,200);const state=await(await fetch(base+'/api/state')).json();assert.equal(state.running,false);assert.equal(state.cashSol,20);assert.equal(state.realTradingEnabled,false);assert.equal(state.agents.sharedCapital,true);assert.equal(state.agents.initialVirtualSol,20);assert.equal(state.agents.agents.length,6);assert.equal(new Set(state.agents.agents.map(a=>a.id)).size,6);assert.ok(state.agents.agents.every(a=>a.stats.closed===0));assert.equal((await fetch(base+'/desk.css')).status,200);
 for(const endpoint of ['/api/direct/prepare','/api/direct/submit','/api/signer/unlock','/api/signer/enable']){const r=await fetch(base+endpoint,{method:'POST',headers,body:'{}'});assert.equal(r.status,410);}
 const exported=await(await fetch(base+'/api/export')).json();assert.equal(exported.mode,'paper');assert.equal(exported.settings.initialSol,20);assert.equal(exported.ownerSecret,undefined);assert.equal(exported.keypair,undefined);assert.equal((await fetch(base+'/api/paper/pause',{method:'POST',headers,body:'{"paused":false}'})).status,200);
 }finally{const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;await rm(dir,{recursive:true,force:true});}});
