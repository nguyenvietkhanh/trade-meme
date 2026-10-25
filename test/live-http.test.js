import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
test('LIVE HTTP starts locked, serves only three bots, reads actual mocked wallet, rejects unauthenticated/cross-origin signing, keeps Telegram',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'live-http-')),child=spawn(process.execPath,['--import','./test/fixtures/live-http-feed.js','src/server.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:dir,TRADING_MODE:'live',MODEL_API_KEY:'',MODEL_TRADING_ENABLED:'true'},stdio:['ignore','pipe','pipe']});let output='',stderr='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>stderr+=b);
 try{let base;for(let i=0;i<150;i++){const port=output.match(/127\.0\.0\.1:(\d+)/)?.[1];if(port){base='http://127.0.0.1:'+port;break;}if(child.exitCode!==null)break;await delay(20);}assert.ok(base,'server startup: '+stderr);
 const health=await(await fetch(base+'/api/health')).json();assert.equal(health.mode,'live');assert.deepEqual(health.activeBots,['kade','nyx','sage']);assert.equal(health.realTradingEnabled,false);assert.equal(health.readOnly,true);assert.equal(health.initialVirtualSol,null);let state;for(let i=0;i<100;i++){state=await(await fetch(base+'/api/state')).json();if(state.cashSol!==null)break;await delay(20);}assert.equal(state.cashSol,4.25);assert.equal(state.pnlSol,0);assert.equal(state.currentOrderSol,null);assert.equal(state.agents.sharedCapital,true);assert.equal(state.agents.agents.length,3);assert.equal(state.settings.initialSol,4.25);assert.equal(state.realTradingEnabled,false);assert.ok(!JSON.stringify(state).includes('ciphertext'));assert.ok(!JSON.stringify(state).includes('secretKey'));
 const headers={'Content-Type':'application/json','X-Requested-With':'meme-desk',Origin:base};
 assert.equal((await fetch(base+'/api/live/unlock',{method:'POST',headers,body:'{"password":"test-password"}'})).status,401);
 assert.equal((await fetch(base+'/api/live/unlock',{method:'POST',headers:{...headers,'x-fixture-owner':'true',Origin:'https://attacker.invalid'},body:'{}'})).status,403);
 const unlock=await fetch(base+'/api/live/unlock',{method:'POST',headers:{...headers,'x-fixture-owner':'true'},body:'{"password":"do-not-echo-this-password"}'});assert.equal(unlock.status,400);assert.ok(!(await unlock.text()).includes('do-not-echo'));
 assert.equal((await fetch(base+'/api/direct/prepare',{method:'POST',headers,body:'{}'})).status,410);assert.equal((await fetch(base+'/api/signer/import',{method:'POST',headers,body:'{}'})).status,410);
 const html=await(await fetch(base)).text();assert.match(html,/LIVE · SOL THẬT/);assert.match(html,/live-unlock/);assert.match(html,/live-lock/);assert.match(html,/telegram-dialog/);assert.match(html,/wallet-dialog/);assert.ok(!html.includes('khớp giả định'));
 const script=html.match(/src="(\/ui\/[a-f0-9]{20}\/paper\.js)"/)[1],asset=await fetch(base+script);assert.equal(asset.status,200);assert.match(asset.headers.get('Cache-Control'),/immutable/);
 }finally{if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;}await rm(dir,{recursive:true,force:true});}
});
