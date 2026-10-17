import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const root=new URL('../',import.meta.url);
test('HTTP workflow, CSRF rejection, state persistence, resumed restart and archived reset',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'meme-test-'));
 let child,base;
 async function launch(){
  child=spawn(process.execPath,['--import','./test/fixtures/feed.js','src/server.js'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
  let output='';
  child.stdout.on('data',chunk=>{output+=chunk;});
  for(let i=0;i<100;i++){
   const match=output.match(/127\.0\.0\.1:(\d+)/);if(match){base='http://127.0.0.1:'+match[1];break;}
   if(child.exitCode!==null)throw Error('Server exited before readiness');await delay(20);
  }
  assert.ok(base,'Server bound a port');
  for(let i=0;i<100;i++){const s=await get();if(s.feed.updatedAt)return;await delay(20);}throw Error('Feed not ready');
 }
 async function stop(){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await exited;}
 async function get(){return (await fetch(base+'/api/state')).json();}
 async function command(action,extra={}){const r=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'meme-desk'},body:JSON.stringify({action,...extra})});return {status:r.status,data:await r.json()};}
 try{
  await launch();let s=await get();assert.equal(s.mode,'paper');assert.equal(s.cashSol,.3);assert.equal(s.feed.markets.length,1);
  assert.equal((await fetch(base)).status,200);assert.ok((await (await fetch(base+'/app.js')).text()).includes('render'));
  assert.equal((await (await fetch(base+'/api/health')).json()).marketFresh,true);
  const cross=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'meme-desk',Origin:'https://evil.invalid'},body:'{"action":"start"}'});assert.equal(cross.status,403);
  const noHeader=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"start"}'});assert.equal(noHeader.status,403);
  assert.equal((await command('start')).data.running,true);
  const mint=s.feed.markets[0].mint;
  const results=await Promise.all([command('buy',{mint}),command('buy',{mint})]);assert.equal(results.filter(x=>x.status===200).length,1);assert.equal(results.filter(x=>x.status===400).length,1);
  s=await get();assert.equal(s.positions.length,1);assert.ok(s.cashSol<.3);
  await stop();base=null;await launch();s=await get();assert.equal(s.running,true);assert.equal(s.positions.length,1);
  const sold=await command('sell',{mint});assert.equal(sold.status,200);assert.equal(sold.data.positions.length,0);assert.ok(sold.data.trades[0].pnlSol<0);
  const exported=await (await fetch(base+'/api/export')).json();assert.equal(exported.mode,'paper');assert.equal(exported.trades.length,2);
  assert.equal((await command('reset')).status,400);
  const reset=await command('reset',{confirm:'RESET PAPER'});assert.equal(reset.data.cashSol,.3);assert.equal(reset.data.trades.length,0);assert.ok((await readdir(dir)).some(x=>x.startsWith('archive-')));
 }finally{if(child?.exitCode===null)await stop();await rm(dir,{recursive:true,force:true});}
});
