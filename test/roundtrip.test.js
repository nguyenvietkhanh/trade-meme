import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {freshState,recordBuy} from '../src/engine.js';
import {verifiedMarket} from './fixtures/verified-market.js';
test('an existing position still takes profit when new entries are blocked by incomplete safety evidence',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'meme-roundtrip-'));
 const initial=freshState(),m=verifiedMarket({mint:'11111111111111111111111111111112',pairAddress:'test-pair',priceUsd:.01});recordBuy(initial,m,150,{quantity:450,costSol:.03,priceUsd:.01},Date.now(),'fixture-confirmed-entry');await writeFile(path.join(dir,'paper-state.json'),JSON.stringify(initial));
 const child=spawn(process.execPath,['--import','./test/fixtures/roundtrip-feed.js','src/mainnet-server.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,PAPER_WORKSPACE:'true',PORT:'0',DATA_DIR:dir,RAILWAY_SERVICE_ID:'isolated-test'},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',chunk=>{output+=chunk;});
 try{
  let base;
  for(let i=0;i<100;i++){const m=output.match(/0\.0\.0\.0:(\d+)/);if(m){base='http://127.0.0.1:'+m[1];break;}await delay(20);}
  assert.ok(base);
  let s;
  for(let i=0;i<100;i++){s=await(await fetch(base+'/api/state')).json();if(s.trades.some(t=>t.side==='SELL'))break;await delay(20);}
  assert.ok(s.running);assert.equal(s.mode,'paper');assert.ok(s.trades.some(t=>t.side==='SELL'));
  assert.ok(s.trades.some(t=>t.side==='BUY'&&t.reason==='fixture-confirmed-entry'));
  assert.ok(s.trades.some(t=>t.side==='SELL'&&t.reason==='recover-capital'));
  assert.ok(s.diagnostics.lastEvaluationAt);assert.ok(s.decisionStats.evaluated>0);assert.ok(s.cashSol>.3);
 }finally{const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done;await rm(dir,{recursive:true,force:true});}
});
