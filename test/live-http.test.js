import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
test('LIVE rules HTTP makes zero model calls, requires the owner signer, reads mocked wallet and rejects unauthorized controls',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'live-http-')),child=spawn(process.execPath,['--import','./test/fixtures/live-http-feed.js','src/server.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:dir,TRADING_MODE:'live',LIVE_SIGNER_SECRET_KEY:'',MODEL_API_KEY:'fixture-no-network',MODEL_TRADING_ENABLED:'true'},stdio:['ignore','pipe','pipe']});let output='',stderr='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>stderr+=b);
 try{let base;for(let i=0;i<150;i++){const port=output.match(/127\.0\.0\.1:(\d+)/)?.[1];if(port){base='http://127.0.0.1:'+port;break;}if(child.exitCode!==null)break;await delay(20);}assert.ok(base,'server startup: '+stderr);
 const health=await(await fetch(base+'/api/health',{headers:{'x-fixture-owner':'true'}})).json();assert.equal(health.mode,'live');assert.deepEqual(health.activeBots,['kade']);assert.equal(health.realTradingEnabled,false);assert.equal(health.readOnly,true);assert.equal(health.requiresWalletSignature,false);assert.equal(health.signingMode,'server-owner-signer');assert.equal(health.signer.runtimeVariablePresent,false);assert.ok(Number.isFinite(health.signer.checkedAt));assert.equal(health.initialVirtualSol,null);let state;for(let i=0;i<100;i++){state=await(await fetch(base+'/api/state',{headers:{'x-fixture-owner':'true'}})).json();if(state.cashSol!==null)break;await delay(20);}assert.equal(state.cashSol,4.25);assert.equal(state.pnlSol,0);assert.equal(state.currentOrderSol,null);assert.equal(state.agents.sharedCapital,true);assert.equal(state.agents.agents.length,1);assert.equal(state.settings.initialSol,4.25);assert.equal(state.realTradingEnabled,false);assert.ok(!JSON.stringify(state).includes('ciphertext'));assert.ok(!JSON.stringify(state).includes('secretKey'));
 const headers={'Content-Type':'application/json','X-Requested-With':'meme-desk',Origin:base};
 for(let i=0;i<100;i++){state=await(await fetch(base+'/api/state',{headers:{'x-fixture-owner':'true'}})).json();if(state.feed.updatedAt)break;await delay(20);}
 assert.equal(state.feed.markets.length,1,'$1m gainer remains a candidate without a cap limit');assert.equal(state.rankings.length,1,'RADAR still receives the discovered gainer');assert.equal(state.rankings[0].change5mPct,27);assert.equal(state.rankings[0].marketCapUsd,1000000);assert.equal(state.rankings[0].eligible,false);assert.equal(state.radar.rising,1);assert.equal(state.radar.buyTargets,1);assert.equal(state.radar.scanned,1);
 assert.equal((await fetch(base+'/api/live/connect',{method:'POST',headers,body:'{}'})).status,401);
 const ownerHeaders={...headers,'x-fixture-owner':'true'};
 assert.equal((await fetch(base+'/api/export?format=dormant-csv')).status,401);
 const csv=await fetch(base+'/api/export?format=dormant-csv',{headers:ownerHeaders});assert.equal(csv.status,200);assert.match(csv.headers.get('content-type'),/text\/csv/);assert.ok((await csv.text()).startsWith('id,kind,thresholdId,detectedAt'));
 const exported=await(await fetch(base+'/api/export',{headers:ownerHeaders})).json();assert.equal(exported.hourlyFunnel.schemaVersion,2);assert.equal(exported.dormant.mode,'RECORD_ONLY');assert.equal(exported.runner.enabled,false);assert.ok(!JSON.stringify(exported).includes('fixture-no-network'));

 assert.equal((await fetch(base+'/api/live/connect',{method:'POST',headers:{...ownerHeaders,Origin:'https://attacker.invalid'},body:'{}'})).status,403);
 let login=await fetch(base+'/api/auth/login',{method:'POST',headers,body:JSON.stringify({nonce:'fixture-owner-proof',signature:'fixture-signature'})});assert.equal(login.status,200);for(let i=0;i<100;i++){state=await(await fetch(base+'/api/state',{headers:{'x-fixture-owner':'true'}})).json();if(state.model.verified)break;await delay(10);}assert.equal(state.model.verified,true);assert.equal(state.model.verification.status,'local-rules');assert.equal(state.model.externalModelCalls,0);assert.equal(state.model.enabled,false);assert.equal(state.realTradingEnabled,false);
 const pause=async(paused,url='/api/paper/pause')=>fetch(base+url,{method:'POST',headers:ownerHeaders,body:JSON.stringify({paused})});
 let r=await pause(false),v=await r.json();assert.equal(r.status,409);assert.equal(v.code,'LIVE_WALLET_NOT_CONNECTED');assert.equal(v.nextAction,'connect-wallet');assert.ok(!v.error.includes('mật khẩu hoặc'));
 r=await fetch(base+'/api/paper/pause',{method:'POST',headers:ownerHeaders,body:'{}'});v=await r.json();assert.equal(r.status,400);assert.equal(v.code,'INVALID_PAUSE_REQUEST');
 r=await pause(true);assert.equal(r.status,200);assert.equal((await r.json()).paused,true);
 r=await fetch(base+'/api/live/connect',{method:'POST',headers:ownerHeaders,body:'{}'});assert.equal(r.status,503);v=await r.json();assert.equal(v.code,'LIVE_SIGNER_NOT_CONFIGURED');assert.match(v.error,/LIVE_SIGNER_SECRET_KEY/);assert.equal(v.diagnostics.signer.runtimeVariablePresent,false);assert.equal(v.diagnostics.buildRevision,'local');assert.ok(!JSON.stringify(v.diagnostics).includes('fixture-no-network'));
 r=await pause(true,'/api/live/pause');assert.equal(r.status,200);assert.equal((await r.json()).running,false);r=await pause(false,'/api/live/pause');assert.equal(r.status,503);assert.equal((await r.json()).code,'LIVE_SIGNER_NOT_CONFIGURED');
 r=await fetch(base+'/api/live/wallet-orders');assert.equal(r.status,410);r=await fetch(base+'/api/live/wallet-submit',{method:'POST',headers:ownerHeaders,body:'{}'});assert.equal(r.status,410);
 assert.equal((await fetch(base+'/api/live/unlock',{method:'POST',headers:ownerHeaders,body:'{}'})).status,410);
 assert.equal((await fetch(base+'/api/direct/prepare',{method:'POST',headers,body:'{}'})).status,410);assert.equal((await fetch(base+'/api/signer/import',{method:'POST',headers,body:'{}'})).status,410);
 const html=await(await fetch(base)).text();assert.match(html,/LIVE · SERVER SIGNER/);assert.match(html,/Pipeline/);assert.match(html,/Analyst/);assert.match(html,/Banker/);assert.doesNotMatch(html,/ack-card|Xác nhận SIZE_DEVIATION/);assert.match(html,/THĂM DÒ/);assert.equal(state.rules.requiresSizeAcknowledgment,false);assert.equal(state.rules.maxOrderFraction,.1);assert.ok(!html.includes('khớp giả định'));
 assert.equal((await fetch(base+'/api/rules/ack',{method:'POST',headers,body:'{}'})).status,403);
 let ack=await fetch(base+'/api/rules/ack',{method:'POST',headers:ownerHeaders,body:JSON.stringify({fingerprint:'invalid'})});assert.equal(ack.status,200);assert.deepEqual(await ack.json(),{automatic:true,acknowledgmentRequired:false});
 assert.ok(!html.includes('id="live-password"'));assert.ok(!html.includes('id="password"'));
 for(let i=0;i<12;i++){r=await pause(true);}assert.equal(r.status,429);assert.ok(Number(r.headers.get('Retry-After'))>0);assert.equal((await r.json()).code,'RATE_LIMITED');
 const script=html.match(/src="(\/ui\/[a-f0-9]{20}\/rules\.js)"/)[1],asset=await fetch(base+script);assert.equal(asset.status,200);assert.match(asset.headers.get('Cache-Control'),/immutable/);
 assert.doesNotMatch(stderr,/FORBIDDEN_MODEL_REQUEST/);
 }finally{if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;}await rm(dir,{recursive:true,force:true});}
});
