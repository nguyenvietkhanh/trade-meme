import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,readFile,rm,writeFile,readdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {installRuntimeLifecycle} from '../src/runtime-lifecycle.js';

const moduleUrl=new URL('../src/runtime-lifecycle.js',import.meta.url).href;
function run(source,env={}){
 return new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--input-type=module','-e',source],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',s=>out+=s);p.stderr.on('data',s=>err+=s);p.on('error',reject);p.on('exit',(code,signal)=>resolve({code,signal,out,err}));});
}
const records=async file=>(await readFile(file,'utf8')).trim().split('\n').map(s=>JSON.parse(s));

test('fatal diagnostics persist failure without suppressing crash or exposing error text',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'lifecycle-fatal-'));
 try{
  const result=await run(`import {installRuntimeLifecycle} from ${JSON.stringify(moduleUrl)};installRuntimeLifecycle();throw Object.assign(new Error('PRIVATE_TEST_KEY_DO_NOT_LOG'),{code:'TEST_FATAL'});`,{DATA_DIR:dir,RAILWAY_VOLUME_MOUNT_PATH:''});
  assert.equal(result.code,1);const rows=await records(path.join(dir,'runtime-lifecycle.jsonl'));
  assert.deepEqual(rows.map(r=>r.kind),['boot','fatal','exit']);assert.equal(rows[1].errorCode,'TEST_FATAL');assert.equal(rows[2].exitCode,1);assert.doesNotMatch(JSON.stringify(rows),/PRIVATE_TEST_KEY_DO_NOT_LOG/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('next boot records previous exit, while a missing exit remains unknown',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'lifecycle-restart-'));const source=`import {installRuntimeLifecycle} from ${JSON.stringify(moduleUrl)};installRuntimeLifecycle();`;
 try{
  const env={DATA_DIR:dir,RAILWAY_VOLUME_MOUNT_PATH:''};assert.equal((await run(source,env)).code,0);assert.equal((await run(source,env)).code,0);
  const rows=await records(path.join(dir,'runtime-lifecycle.jsonl'));assert.equal(rows[2].previous.kind,'exit');assert.equal(rows[2].previous.exitCode,0);assert.notEqual(rows[0].bootId,rows[2].bootId);
  await writeFile(path.join(dir,'runtime-lifecycle.jsonl'),JSON.stringify(rows[0])+'\n');await run(source,env);const next=await records(path.join(dir,'runtime-lifecycle.jsonl'));assert.equal(next[1].previous.kind,'boot');assert.equal(next[1].previous.exitCode,null);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('unhandled rejection keeps Node failure semantics and records the origin',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'lifecycle-rejection-'));
 try{
  const result=await run(`import {installRuntimeLifecycle} from ${JSON.stringify(moduleUrl)};installRuntimeLifecycle();Promise.reject(new Error('SECRET_IN_REJECTION'));await new Promise(r=>setTimeout(r,100));`,{DATA_DIR:dir,RAILWAY_VOLUME_MOUNT_PATH:''});
  assert.equal(result.code,1);const rows=await records(path.join(dir,'runtime-lifecycle.jsonl'));assert.equal(rows.find(r=>r.kind==='fatal').origin,'unhandledRejection');assert.equal(rows.at(-1).exitCode,1);assert.doesNotMatch(JSON.stringify(rows),/SECRET_IN_REJECTION/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('SIGTERM is observed through the existing shutdown path without replacing signal handlers',async t=>{
 if(process.platform==='win32'){t.skip('POSIX signal handler test');return;}
 const dir=await mkdtemp(path.join(tmpdir(),'lifecycle-signal-'));
 const source=`import {installRuntimeLifecycle,runtimeLifecycle} from ${JSON.stringify(moduleUrl)};installRuntimeLifecycle();process.on('SIGTERM',()=>{runtimeLifecycle('shutdown_requested',{signal:'SIGTERM'});process.exit(0);});console.log('FIXTURE_READY');setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['--input-type=module','-e',source],{env:{...process.env,DATA_DIR:dir,RAILWAY_VOLUME_MOUNT_PATH:''},stdio:['ignore','pipe','pipe']});
 const timeout=setTimeout(()=>child.kill('SIGKILL'),5000);let output='';child.stdout.on('data',s=>{output+=s;if(output.includes('FIXTURE_READY'))child.kill('SIGTERM');});
 try{
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});assert.equal(code,0);const rows=await records(path.join(dir,'runtime-lifecycle.jsonl'));assert.deepEqual(rows.map(r=>r.kind),['boot','shutdown_requested','exit']);assert.equal(rows[1].signal,'SIGTERM');
 }finally{clearTimeout(timeout);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await rm(dir,{recursive:true,force:true});}
});

test('rotation stays bounded and never modifies financial ledger',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'lifecycle-rotate-'));const proc=Object.assign(new EventEmitter(),{pid:123,uptime:()=>1,memoryUsage:()=>({rss:1,heapUsed:1,external:0})});let monitor;
 try{
  const ledger=path.join(dir,'live-ledger.json');await writeFile(ledger,'financial-fixture-unchanged');
  monitor=installRuntimeLifecycle({dir,proc,env:{},log:()=>{}});for(let i=0;i<700;i++)monitor.record('shutdown_requested',{signal:'SIGTERM'});
  const files=(await readdir(dir)).filter(s=>s.startsWith('runtime-lifecycle'));assert.equal(files.length,2);
  for(const name of files)assert.ok((await readFile(path.join(dir,name))).length<=128*1024);
  assert.equal(await readFile(ledger,'utf8'),'financial-fixture-unchanged');
 }finally{monitor?.dispose();await rm(dir,{recursive:true,force:true});}
});

test('unwritable diagnostic storage does not break the process',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'lifecycle-unwritable-')),blocked=path.join(dir,'not-a-directory');await writeFile(blocked,'unchanged');
 const proc=Object.assign(new EventEmitter(),{pid:1,uptime:()=>0,memoryUsage:()=>({rss:1,heapUsed:1,external:0})});const logs=[];
 const monitor=installRuntimeLifecycle({dir:path.join(blocked,'child'),proc,env:{},log:s=>logs.push(s),warn:()=>{}});
 try{assert.doesNotThrow(()=>monitor.record('exit',{code:0}));assert.equal(logs.length,2);}finally{monitor.dispose();await rm(dir,{recursive:true,force:true});}
});

test('diagnostics refuse symlinks and cannot append into a financial file',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'lifecycle-symlink-')),ledger=path.join(dir,'live-ledger.json');let monitor;
 try{
  await writeFile(ledger,'unchanged');try{await symlink(ledger,path.join(dir,'runtime-lifecycle.jsonl'));}catch(e){if(e.code==='EPERM'){t.skip('symlink creation not permitted');return;}throw e;}
  monitor=installRuntimeLifecycle({dir,log:()=>{},warn:()=>{}});monitor.record('exit',{code:0});assert.equal(await readFile(ledger,'utf8'),'unchanged');
 }finally{monitor?.dispose();await rm(dir,{recursive:true,force:true});}
});

test('Docker healthcheck probes actual PORT and rejects failing health',async()=>{
 const docker=await readFile(new URL('../Dockerfile',import.meta.url),'utf8'),line=docker.split('\n').find(s=>s.startsWith('HEALTHCHECK ')),script=line.match(/node -e "(.*)"$/)[1];
 let status=200;const server=http.createServer((req,res)=>{assert.equal(req.url,'/api/health');res.writeHead(status);res.end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const env={...process.env,PORT:String(server.address().port)};
  function probe(){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,['-e',script],{env,stdio:'ignore'});p.on('error',reject);p.on('exit',resolve);});}
  assert.equal(await probe(),0);status=503;assert.equal(await probe(),1);
 }finally{await new Promise(r=>server.close(r));}
});
