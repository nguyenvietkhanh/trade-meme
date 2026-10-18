import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
import {DEFAULT_OWNER} from '../src/security.js';
test('production pins the sole owner and rejects wrong wallets, forged sessions and cross-origin live control',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'owner-http-')),wrong=Keypair.generate().publicKey.toBase58();
 const child=spawn(process.execPath,['--import','./test/fixtures/feed.js','src/server.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',DATA_DIR:dir,OWNER_SOLANA_ADDRESS:wrong,RAILWAY_SERVICE_ID:'test'},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',c=>{output+=c;});
 try{
  let base;for(let i=0;i<100;i++){const m=output.match(/0\.0\.0\.0:(\d+)/);if(m){base='http://127.0.0.1:'+m[1];break;}await delay(20);}assert.ok(base);
  const owner=await(await fetch(base+'/api/auth/status')).json();assert.equal(owner.owner,DEFAULT_OWNER);assert.equal(owner.authenticated,false);assert.equal(owner.walletMode,'owner');assert.equal(owner.persistentStorage,undefined);
  const post=(route,body,origin='https://trade-meme-production.up.railway.app')=>fetch(base+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Requested-With':'meme-desk',Cookie:'mp_session=forged'},body:JSON.stringify(body)});
  assert.equal((await post('/api/auth/challenge',{address:wrong})).status,400);
  const challenge=await(await post('/api/auth/challenge',{address:DEFAULT_OWNER})).json();assert.ok(challenge.message.includes(DEFAULT_OWNER));
  const badLogin=await post('/api/auth/login',{nonce:challenge.nonce,signature:bs58.encode(Buffer.alloc(64))});assert.equal(badLogin.status,400);assert.equal(badLogin.headers.get('set-cookie'),null);
  for(const route of ['/api/live/status','/api/live/backup','/api/direct/status','/api/signer/status','/api/research','/api/research/paper','/api/research/export','/api/research/file?name=../../owner-signer.json'])assert.equal((await fetch(base+route)).status,401);
  for(const route of ['/api/live/enable','/api/live/create','/api/live/withdraw','/api/direct/config','/api/direct/prepare','/api/direct/submit','/api/direct/reconcile','/api/signer/import','/api/signer/unlock','/api/signer/enable','/api/signer/restore','/api/signer/recovery-preview','/api/signer/recovery-apply','/api/signer/export','/api/signer/telegram-config','/api/signer/telegram-test','/api/signer/telegram-disable'])assert.equal((await post(route,{})).status,401);
  assert.equal((await post('/api/live/enable',{},'https://evil.invalid')).status,403);
  const state=await(await fetch(base+'/api/state')).json();assert.equal(state.mode,'live');assert.equal(state.walletMode,'owner');assert.ok(!state.diagnostics.message.includes('két'));assert.equal(state.publicKey,undefined);assert.equal(state.secret,undefined);
  assert.equal(state.cashSol,null);assert.equal(state.equitySol,null);assert.equal(state.pnlSol,null);assert.deepEqual(state.positions,[]);assert.deepEqual(state.trades,[]);assert.deepEqual(state.curve,[]);assert.equal(state.running,false);assert.equal(state.ownerAuthenticated,false);
  assert.equal((await fetch(base+'/api/export')).status,401);
  assert.equal((await post('/api/signer/review-exit',{})).status,401);
  assert.equal(state.research.paper.readyForLive,false);assert.equal(state.research.paper.minimumClosedPerArm,100);
 }finally{const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done;await rm(dir,{recursive:true,force:true});}
});
