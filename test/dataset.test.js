import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,readdir,writeFile,stat,utimes,statfs} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatasetCollector,datasetConfig} from '../src/dataset.js';
import {ForwardLabeler,HORIZONS} from '../src/dataset-labeler.js';
import {redactor,errorCategory} from '../src/dataset-redaction.js';
import {PaperModelClient} from '../src/paper-model-client.js';
import {modelMessages} from '../src/paper-model-context.js';
const hold={action:'HOLD',mint:null,order_sol:null,sell_percent:null,stop_loss_pct:null,confidence:.5,reason:'Hold'};
const context=()=>({mode:'live',aiOnly:true,botId:'kade',snapshotId:'snap',asOf:Date.now(),wallet:{running:true,cashSol:1},limits:{maxOrderSol:.8,maxPositions:100},positions:[],candidates:[{mint:'mint',priceSol:1,ageMs:100,closedM1:[],flow:{complete:false},mintSafety:{status:'unknown'}}]});
async function rows(dir){const out={};for(const day of await readdir(path.join(dir,'dataset')))if(/^\d{4}-\d{2}-\d{2}$/.test(day))for(const f of await readdir(path.join(dir,'dataset',day))){if(!f.endsWith('.gz'))continue;const stream=f.split('-')[0];out[stream]??=[];out[stream].push(...gunzipSync(await readFile(path.join(dir,'dataset',day,f))).toString().trim().split('\n').filter(Boolean).map(JSON.parse));}return out;}
test('labeler uses delayed entry, each horizon, and first crossing barriers without future leakage',()=>{
 const result=[],l=new ForwardLabeler(r=>result.push(r));l.add({sampleId:'s',mint:'mint',decisionAt:0});
 for(let at=2000;at<=1802000;at+=1000)l.prices([{mint:'mint',priceAt:at,spotPriceSol:at<12000?100:at<62000?116:at<182000?80:200}],at);
 assert.equal(result.length,6);const first=result.find(r=>r.horizonSeconds===60);assert.equal(first.entryAt,2000);assert.equal(first.entryPrice,100);assert.equal(first.price,80);assert.equal(first.tripleBarrier[0].label,'TP');assert.equal(first.tripleBarrier[1].label,'SL');assert.ok(Math.abs(first.mfePct-16)<1e-9);assert.ok(first.mfePct<100,'later doubling must not change 1m MFE');assert.equal(l.count,0);
});
test('missing/stale/future prices stay null with incomplete coverage; duplicates cannot make coverage complete',()=>{
 const result=[],l=new ForwardLabeler(r=>result.push(r));l.add({sampleId:'s',mint:'mint',decisionAt:0});l.prices([{mint:'mint',priceAt:2000,spotPriceSol:100}],2000);l.prices([{mint:'mint',priceAt:2000,spotPriceSol:100}],65000);
 const r=result.find(r=>r.horizonSeconds===60);assert.equal(r.price,null);assert.equal(r.returnPct,null);assert.equal(r.mfePct,null);assert.equal(r.coverage.complete,false);assert.ok(r.tripleBarrier.every(b=>b.label===null));l.close();assert.equal(result.length,HORIZONS.length);
});
test('gap across a possible barrier yields unknown label even with fresh endpoint',()=>{
 const result=[],l=new ForwardLabeler(r=>result.push(r));l.add({sampleId:'s',mint:'mint',decisionAt:0});l.prices([{mint:'mint',priceAt:2000,spotPriceSol:100}],2000);l.prices([{mint:'mint',priceAt:62000,spotPriceSol:120}],62000);const r=result[0];assert.equal(r.price,120);assert.equal(r.coverage.status,'gapped');assert.equal(r.tripleBarrier[0].label,null);assert.equal(r.mfePct,null);
});
test('redaction preserves mint, hashes identities consistently, strips secrets and signed data',()=>{
 const mint='7'.repeat(44),owner='8'.repeat(44),signature='9'.repeat(88),clean=redactor('salt',[owner]);const r=clean({mint,owner,signature,privateKey:'never',transaction:'signed bytes',rawOutput:JSON.stringify({reason:owner,signature})},[mint]);assert.equal(r.mint,mint);assert.notEqual(r.owner,owner);assert.equal(clean(r,[mint]).signature,r.signature);assert.ok(!JSON.stringify(r).includes(owner));assert.ok(!JSON.stringify(r).includes(signature));assert.equal(r.privateKey,'[REDACTED]');assert.equal(r.transaction,'[REDACTED]');
});
test('error classes distinguish model/RPC/Jupiter/stale/revert and stop/auth errors',()=>{
 for(const [e,p,expected]of [[{code:'RPC_UNAVAILABLE'},'','RPC'],[{message:'HTTP 429'},'Jupiter','JUPITER_429'],[{code:'MODEL_HTTP_429'},'','MODEL_429'],[{message:'quote stale'},'','QUOTE_STALE'],[{code:'RECEIPT_FAILED'},'','REVERT'],[{code:'LIVE_AI_STOP_REQUIRED'},'','STOP_REQUIRED'],[{code:'LIVE_WALLET_NOT_CONNECTED'},'','WALLET_NOT_CONNECTED']])assert.equal(errorCategory(e,p),expected);
});
test('model instrumentation records exactly one start/end and leaves request prompt and decision unchanged even if sink throws',async()=>{
 const c=context(),events=[],sink={config:{enabled:true},callId:()=> 'call',record:(kind,data)=>{events.push({kind,data});throw Error('disk offline');}},expected=modelMessages(c),client=new PaperModelClient({dataset:sink,env:{MODEL_API_KEY:'fixture-api',MODEL_TRADING_ENABLED:'true'},fetcher:async(_url,opts)=>{const p=JSON.parse(opts.body);assert.deepEqual(p.messages,expected);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(hold)},finish_reason:'stop'}]}));}});
 const r=await client.decide('kade',c);assert.equal(r.decision.action,'HOLD');assert.deepEqual(events.map(e=>e.kind),['model_start','model_end']);assert.equal(events[0].data.promptSha256,createHash('sha256').update(expected[0].content).digest('hex'));assert.equal(events[1].data.rawOutput,JSON.stringify(hold));assert.equal(events[1].data.validate.ok,true);
});
test('worker writes redacted gzip streams, export samples are readable, and no ledger is changed',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'dataset-'));t.after(()=>rm(dir,{recursive:true,force:true}));await writeFile(path.join(dir,'live-ledger.json'),'financial');const owner='8'.repeat(44),collector=new DatasetCollector(dir,{env:{DATASET_ENABLED:'true',DATASET_MIN_FREE_MIB:'1'},addresses:[owner]}),c=context();c.wallet.owner=owner;
 collector.record('model_start',{callId:'call',requestedAt:1000,model:'fixture',temperature:.2,promptSha256:'hash',snapshotId:'snap',context:c});collector.record('model_end',{callId:'call',respondedAt:2000,latencyMs:1000,rawOutput:JSON.stringify(hold),validate:{ok:true},decisions:[hold]});collector.record('decision_validation',{callId:'call',decisionIndex:0,decision:hold,applied:true,reason:'Hold'});await collector.close();
 const all=await rows(dir);assert.equal(all.model_calls.length,1);assert.equal(all.candidate_snapshots.length,1);assert.equal(all.forward_labels.length,6);assert.equal(all.model_calls[0].context.candidates[0].mint,'mint');assert.equal(all.candidate_snapshots[0].bought,false);assert.ok(!JSON.stringify(all).includes(owner));assert.equal(await readFile(path.join(dir,'live-ledger.json'),'utf8'),'financial');
 const dest=path.join(dir,'export'),r=spawnSync('node',['scripts/export-dataset.mjs',dir,dest,'250'],{cwd:new URL('../',import.meta.url),encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(await readFile(path.join(dest,'manifest.json'))).streams.model_calls.rows,1);
});
test('dataset is disabled by default; queue bounds drop telemetry without blocking callers',()=>{
 assert.equal(datasetConfig({}).enabled,false);const d=new DatasetCollector('/tmp/unused-dataset',{env:{}});assert.equal(d.record('error',{}),false);d.worker={postMessage:()=>{}};d.config.maxMessages=2;d.config.enabled=true;assert.equal(d.record('model_start',{}),true);assert.equal(d.record('model_end',{}),true);assert.equal(d.record('error',{}),false);assert.equal(d.dropped,1);
});

test('enriched fills adjust fees/rent, record 5s paths and count wins by closed positions rather than partial sales',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'dataset-fills-'));t.after(()=>rm(dir,{recursive:true,force:true}));const d=new DatasetCollector(dir,{env:{DATASET_ENABLED:'true',DATASET_MIN_FREE_MIB:'1',DATASET_MAX_QUEUED_MESSAGES:'128'}}),now=Date.now();
 d.record('fill',{order:{id:'buy',mint:'mint',side:'BUY',amount:'100000000',decisionAt:now-2000,aiStopLossPct:12,quote:{outAmount:'100'}},receipt:{status:'confirmed',tokenDelta:'100',decimals:2,solDelta:-.10202,feeSol:.00002,rentDeltaLamports:2000000},confirmedAt:now,closed:false,sentAt:now-1000});
 d.record('prices',{at:now+5000,prices:[{mint:'mint',priceAt:now+5000,spotPriceSol:.12}],positions:[{positionId:'buy',mint:'mint',stopLossPct:12}]});
 d.record('fill',{order:{id:'partial',positionId:'buy',mint:'mint',side:'SELL',amount:'40',decisionAt:now+5000,reason:'AI: take profit',quote:{outAmount:'44000000'}},receipt:{status:'confirmed',tokenDelta:'-40',decimals:2,solDelta:.04398,feeSol:.00002},confirmedAt:now+7000,closed:false});
 d.record('fill',{order:{id:'close',positionId:'buy',mint:'mint',side:'SELL',amount:'60',decisionAt:now+8000,reason:'stop-loss',quote:{outAmount:'54000000'}},receipt:{status:'confirmed',tokenDelta:'-60',decimals:2,solDelta:.05398,feeSol:.00002},confirmedAt:now+10000,closed:true,positionPnlSol:-.00206,stopLossPct:12});
 await d.close();const all=await rows(dir),fills=all.fills_enriched.filter(r=>r.event==='fill');assert.equal(fills.length,3);assert.ok(Math.abs(fills[0].fillPriceSol-.1)<1e-12);assert.equal(fills[2].closed,true);assert.equal(fills[2].winRateClosedPositions,0);assert.equal(fills[2].exitReason,'stop');assert.equal(fills[2].stopLossPct,12);assert.ok(all.fills_enriched.some(r=>r.event==='price_path'&&r.spotPriceSol===.12));assert.ok(Math.abs(fills[2].mfePct-20)<1e-8);
});
test('dataset retention deletes only its recognized old archives, never financial files',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'dataset-prune-'));t.after(()=>rm(dir,{recursive:true,force:true}));const day=path.join(dir,'dataset','2010-01-01');await mkdir(day,{recursive:true});const old=path.join(day,'model_calls-aaaaaaaaaaaaaaaa-000001.jsonl.gz');await writeFile(old,'old archive');await utimes(old,new Date('2010-01-01'),new Date('2010-01-01'));await writeFile(path.join(day,'ledger.json'),'do not delete');
 const d=new DatasetCollector(dir,{env:{DATASET_ENABLED:'true',DATASET_MIN_FREE_MIB:'1'}});await d.close();await assert.rejects(stat(old),{code:'ENOENT'});assert.equal(await readFile(path.join(day,'ledger.json'),'utf8'),'do not delete');
});
test('invalid model output is retained with a diagnostic stop reason, never an inferred trade',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'dataset-invalid-'));t.after(()=>rm(dir,{recursive:true,force:true}));const d=new DatasetCollector(dir,{env:{DATASET_ENABLED:'true',DATASET_MIN_FREE_MIB:'1'}}),c=context();d.record('model_start',{callId:'bad',requestedAt:1,context:c,snapshotId:'snap'});d.record('model_end',{callId:'bad',respondedAt:2,rawOutput:JSON.stringify({action:'BUY',mint:'mint',order_sol:.1}),validate:{ok:false,code:'MODEL_INVALID_DECISION'}});await d.close();const all=await rows(dir);assert.equal(all.model_calls.length,1);assert.ok(all.model_calls[0].validate.notes.includes('0:STOP_REQUIRED'));assert.equal(all.candidate_snapshots[0].bought,false);
});
test('confirmed BUY and observed quote enrich the candidate without treating a send acknowledgment as a fill',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'dataset-join-'));t.after(()=>rm(dir,{recursive:true,force:true}));const d=new DatasetCollector(dir,{env:{DATASET_ENABLED:'true',DATASET_MIN_FREE_MIB:'1'}}),c=context(),time=Date.now(),decision={...hold,action:'BUY',mint:'mint',order_sol:.1,stop_loss_pct:12};
 d.record('model_start',{callId:'c',requestedAt:time,context:c});d.record('model_end',{callId:'c',respondedAt:time+1,decisions:[decision],validate:{ok:true}});d.record('decision_validation',{callId:'c',decisionIndex:0,decision,applied:true,intentId:'buy'});
 d.record('executor',{intentId:'buy',mint:'mint',side:'BUY',stage:'send_started',decimals:2,quote:{inAmount:'1020000000',outAmount:'100'}});
 d.record('fill',{order:{id:'buy',mint:'mint',side:'BUY',amount:'1020000000',decisionAt:1,quote:{outAmount:'100'}},receipt:{status:'confirmed',tokenDelta:'100',decimals:2,solDelta:-1.02002,feeSol:.00002},confirmedAt:3,closed:false});await d.close();const all=await rows(dir);assert.equal(all.candidate_snapshots[0].bought,true);assert.ok(Math.abs(all.candidate_snapshots[0].quoteVsMid.entryCostPct-2)<1e-8);assert.ok(all.executor_results.some(r=>r.stage==='confirmed'&&r.callId==='c'));
});
test('failed dataset worker and insufficient disk reserve never prevent model decisions',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'dataset-offline-'));t.after(()=>rm(dir,{recursive:true,force:true}));await writeFile(path.join(dir,'not-dir'),'x');const d=new DatasetCollector(path.join(dir,'not-dir'),{env:{DATASET_ENABLED:'true'}});await new Promise(resolve=>d.worker.once('exit',resolve));assert.equal(d.status().error,'DATASET_WORKER_FAILED');
 const c=context(),client=new PaperModelClient({dataset:d,env:{MODEL_API_KEY:'fixture-only',MODEL_TRADING_ENABLED:'true'},fetcher:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(hold)}}]}))});assert.equal((await client.decide('kade',c)).decision.action,'HOLD');await d.close();
 const fs=await statfs(dir),reserve=String(Math.ceil(fs.bavail*fs.bsize/1048576)+1024),low=new DatasetCollector(dir,{env:{DATASET_ENABLED:'true',DATASET_MIN_FREE_MIB:reserve}});low.record('error',{code:'TEST'});await low.close();assert.equal(low.status().error,'DATASET_DISK_RESERVE');
});
test('reflected API keys are omitted from telemetry and public hashes are preserved while secret-looking bytes are removed',async()=>{
 const key='fixture-reflected-api-key',events=[],sink={config:{enabled:true},callId:()=> 'sensitive',record:(kind,data)=>events.push({kind,data})},client=new PaperModelClient({dataset:sink,env:{MODEL_API_KEY:key,MODEL_TRADING_ENABLED:'true'},fetcher:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({...hold,reason:key})}}]}))});await assert.rejects(client.decide('kade',context()),{code:'MODEL_SENSITIVE_RESPONSE'});assert.ok(!JSON.stringify(events).includes(key));assert.equal(events.find(e=>e.kind==='model_end').data.rawOutput,null);
 const digest='a'.repeat(64),clean=redactor('s'),r=clean({promptSha256:digest,rawOutput:JSON.stringify({reason:digest,bytes:'Q'.repeat(200)})});assert.equal(r.promptSha256,digest);assert.ok(!r.rawOutput.includes(digest));assert.ok(!r.rawOutput.includes('Q'.repeat(200)));
});
