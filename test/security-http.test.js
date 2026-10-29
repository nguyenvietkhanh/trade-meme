import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import bs58 from 'bs58';
test('real HTTP denies anonymous/expired logout and private reads, allows signed owner and minimal health',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'security-http-')),keys=generateKeyPairSync('ed25519'),owner=bs58.encode(keys.publicKey.export({format:'der',type:'spki'}).subarray(-32));
 const child=spawn(process.execPath,['--import','./test/fixtures/security-http-feed.js','src/server.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:dir,TRADING_MODE:'live',LIVE_SIGNER_SECRET_KEY:'',SECURITY_TEST_OWNER:owner,CANDIDATE_OBSERVER_ENABLED:'false'},stdio:['ignore','pipe','pipe']});let output='',stderr='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>stderr+=b);
 try{
  let base;for(let i=0;i<200;i++){const port=output.match(/127\.0\.0\.1:(\d+)/)?.[1];if(port){base='http://127.0.0.1:'+port;break;}if(child.exitCode!==null)break;await delay(20);}assert.ok(base,stderr);
  const headers={Origin:base,'Content-Type':'application/json','X-Requested-With':'meme-desk'},post=(p,data={},cookie=null)=>fetch(base+p,{method:'POST',headers:{...headers,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});
  const publicHealth=await(await fetch(base+'/api/health')).json();assert.deepEqual(Object.keys(publicHealth).sort(),['buildRevision','status']);assert.equal(publicHealth.status,'ok');
  const status=await(await fetch(base+'/api/auth/status')).json();assert.equal(status.authenticated,false);assert.equal(status.signerAvailable,undefined);
  for(const cookie of [null,'mp_session=invalid','mp_session=expired-fixture']){
   for(const endpoint of ['/api/state','/api/activity','/api/export','/api/research','/api/research/candidates/status']){const r=await fetch(base+endpoint,{headers:cookie?{Cookie:cookie}:{}});assert.equal(r.status,401,endpoint);const body=await r.text();assert.doesNotMatch(body,/positions|balanceSol|signerAvailable|privateKey/);}
   const r=await post('/api/auth/logout',{},cookie);assert.equal(r.status,401);assert.equal((await r.json()).code,'OWNER_AUTH_REQUIRED');
  }
  assert.doesNotMatch(output,/LOCAL_SECURITY_DISCONNECT/);
  const challenge=await(await post('/api/auth/challenge',{address:owner})).json(),signature=bs58.encode(sign(null,Buffer.from(challenge.message),keys.privateKey));const login=await post('/api/auth/login',{nonce:challenge.nonce,signature});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  for(const endpoint of ['/api/state','/api/activity','/api/health']){const r=await fetch(base+endpoint,{headers:{Cookie:cookie}});assert.equal(r.status,200);assert.equal((await r.json()).code,undefined);}
  const state=await(await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json();assert.equal(state.ownerAuthenticated,true);assert.equal(state.cashSol,4.25);
  const cross=await fetch(base+'/api/auth/logout',{method:'POST',headers:{...headers,Origin:'https://other.invalid',Cookie:cookie},body:'{}'});assert.equal(cross.status,403);assert.doesNotMatch(output,/LOCAL_SECURITY_DISCONNECT/);
  const logout=await post('/api/auth/logout',{},cookie);assert.equal(logout.status,200);await delay(20);assert.equal((output.match(/LOCAL_SECURITY_DISCONNECT/g)??[]).length,1);assert.equal((await fetch(base+'/api/state',{headers:{Cookie:cookie}})).status,401);assert.equal((await post('/api/auth/logout',{},cookie)).status,401);
 }finally{if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;}await rm(dir,{recursive:true,force:true});}
});
