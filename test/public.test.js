import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
test('Railway entry binds assigned port, autostarts paper and rejects all public mutations',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'meme-public-'));
 const child=spawn(process.execPath,['--import','./test/fixtures/feed.js','src/railway.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',c=>{output+=c;});
 try{
  let base;
  for(let i=0;i<100;i++){const match=output.match(/0\.0\.0\.0:(\d+)/);if(match){base='http://127.0.0.1:'+match[1];break;}await delay(20);}
  assert.ok(base);
  let state;
  for(let i=0;i<100;i++){state=await (await fetch(base+'/api/state')).json();if(state.feed.updatedAt)break;await delay(20);}
  assert.equal(state.readOnly,true);assert.equal(state.mode,'paper');assert.equal(state.running,true);assert.ok(state.positions.length>0);
  for(const action of ['reset','pause','buy','sell','add-token']){
   const r=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'meme-desk'},body:JSON.stringify({action,confirm:'RESET PAPER'})});assert.equal(r.status,403);
  }
  assert.equal((await fetch(base)).status,200);
 }finally{const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;await rm(dir,{recursive:true,force:true});}
});
