import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {scalpConfig} from '../scalp-config.js';
import {stageA,stageB,stageC,stageD,stageE,plannedSize,scalpExit,scalpExitPolicy} from '../scalp-stages.js';
import {ScalpWeek} from '../scalp-engine.js';
import {PaperStore} from '../store.js';
const c=scalpConfig({}),at=Date.parse('2026-11-01T05:00:00Z');
const market=(now=at)=>({mint:'TEST_FIXTURE',pairAddress:'POOL_FIXTURE',dexId:'pumpswap',quoteMint:'So11111111111111111111111111111111111111112',solUsd:100,solUsdAt:now,sources:['fixture'],spotPriceSol:.01,priceUsd:1,priceAt:now,updatedAt:now,marketObservedAt:now,pairCreatedAt:now-600000,liquidityUsd:20000,liquidityQuoteSol:100,change5mPct:10,change1mPct:3,change1hPct:-5,volume5mUsd:2000,buys5m:20,sells5m:10});
const facts=(m,now=at)=>({mint:m.mint,pool:m.pairAddress,checkedAt:now,coverage:{program:true,authorities:true,holders:true,exclusions:true,rug:true},tokenProgram:'spl-token',mintRevoked:true,freezeRevoked:true,extensionsSafe:true,top10Pct:25,devPct:3,holderCount:100,rugDanger:false});
test('stage A uses cached fields only and emits its first failing rule in order',()=>{const m=market();assert.equal(stageA(m,c,at).pass,true);assert.equal(stageA({...m,liquidityUsd:1,pairCreatedAt:at},c,at).reason_code,'A_LIQ');assert.equal(stageA({...m,liquidityUsd:8000,pairCreatedAt:at},c,at).reason_code,'A_AGE');assert.equal(stageA({...m,change5mPct:61},c,at).reason_code,'A_M5_RANGE');assert.equal(stageA({...m,buys5m:1},c,at).reason_code,'A_FLOW');assert.equal(stageA({...m,volume5mUsd:1},c,at).reason_code,'A_VOL');assert.equal(stageA({...m,change1hPct:-31},c,at).reason_code,'A_H1_DUMP');});
test('curve A has its own capitalization, age and positive M1/M5 rules',()=>{const m={...market(),dexId:'pumpfun',marketCapUsd:6000};assert.equal(stageA(m,c,at).pass,true);assert.equal(stageA({...m,change1mPct:-1},c,at).reason_code,'A_M5_RANGE');assert.equal(stageA({...m,marketCapUsd:4999},c,at).reason_code,'A_LIQ');});
test('stage B fails closed on unavailable exclusions or rug evidence, accepts exact thresholds',()=>{const m=market();assert.equal(stageB(null,m,c,at).reason_code,'B_UNVERIFIED');const f=facts(m);assert.equal(stageB({...f,coverage:{...f.coverage,rug:false}},m,{...c,rugRequired:true},at).reason_code,'B_UNVERIFIED');assert.equal(stageB({...f,top10Pct:30,devPct:8},m,c,at).pass,true);assert.equal(stageB({...f,rugDanger:true},m,c,at).reason_code,'B_RUG');assert.equal(stageB({...f,mintRevoked:false},m,c,at).reason_code,'B_AUTHORITY');});
test('stage C enforces exact three samples, span, rising range, steps, and liquidity retention',()=>{const rows=[{at:at-20000,price:1,liquiditySol:100},{at:at-10000,price:1.01,liquiditySol:99},{at,price:1.02,liquiditySol:95}];assert.equal(stageC(rows,c,at).pass,true);assert.equal(stageC(rows.slice(1),c,at).reason_code,'C_SPAN');assert.equal(stageC(rows,c,at+5001).reason_code,'C_STALE');assert.equal(stageC([...rows.slice(0,2),{at,price:1.13,liquiditySol:100}],c,at).reason_code,'C_RISE_HIGH');assert.equal(stageC([...rows.slice(0,2),{at,price:1.02,liquiditySol:89}],c,at).reason_code,'C_LIQ_DROP');});
test('stage D binds reverse amount, drift, quote age, impact and actual intended size',()=>{const o={mint:'M',pool:'P',amount:'1000000000',readyAt:at-2000,referencePriceSol:.01},q={out:'98500000',expectedOut:'100000000',at:at-1000,decimals:6,impactPct:1,roundTrip:{mint:'M',pool:'P',inAmount:o.amount,sellInput:'98500000',sellOut:'960000000',at,impactPct:1}};assert.equal(stageD(q,o,c,at).pass,true);assert.equal(stageD({...q,impactPct:3},o,c,at).reason_code,'D_COST');assert.equal(stageD({...q,expectedOut:'80000000'},o,c,at).detail,'DRIFT');assert.equal(stageD(q,o,c,at+3001).detail,'STALE');});
test('stage E applies fixed/pool sizing, exposure, slots, consumed signals and 30m reentry',()=>{const m=market(),s={cash:50e9,initial:50e9,positions:[],trades:[],scalp:{consumed:{}}};assert.equal(plannedSize({...m,liquidityQuoteSol:10},s,c),.15);assert.equal(stageE(m,s,c,at,1,'signal').pass,true);s.scalp.consumed[m.mint]={signalId:'signal',at};assert.equal(stageE(m,s,c,at,1,'signal').reason_code,'E_CONSUMED');assert.equal(stageE(m,s,c,at+1,1,'other').reason_code,'E_REENTRY');assert.equal(stageE(m,s,c,at+c.reentryMs,1,'other').pass,true);});
test('scalp exit follows -10, TP1, moved stop, trailing, TP2 and timed exits',()=>{const p={entry:1,openedAt:at,peak:1,tpDone:false,memory:{},exitPolicy:scalpExitPolicy(c)};assert.equal(scalpExit(p,.89,at).reason,'stop-loss');p.memory={};assert.equal(scalpExit(p,1.16,at).fraction,.5);p.tpDone=true;p.peak=1.25;assert.equal(scalpExit(p,1.01,at).reason,'stop-loss');p.memory={};assert.equal(scalpExit(p,1.14,at).reason,'scalp-trailing');p.memory={};assert.equal(scalpExit(p,1.31,at).reason,'scalp-tp2');p.memory={};p.tpDone=false;p.peak=1.04;assert.equal(scalpExit(p,1.04,at+c.timeStopMs).reason,'scalp-time-stop');assert.equal(scalpExit(p,1.06,at+c.maxHoldMs).reason,'scalp-max-hold');});
test('all new scalar thresholds can be overridden from env, invalid bounds rejected',()=>{assert.equal(scalpConfig({SCALP_A_SWAP_LIQUIDITY_USD:'9000'}).aSwapLiquidityUsd,9000);assert.throws(()=>scalpConfig({SCALP_C_SPAN_MIN_MS:'1'}));});
async function setup(t){let now=at,calls=0;const dir=await mkdtemp(path.join(tmpdir(),'scalp-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));const adapter={scalpSafety:async()=>{calls++;return null;},refreshCandidate:async m=>m,quote:async()=>{throw Error('NO_ROUTE');}};const store=new PaperStore(dir,{clock:()=>now}),engine=new ScalpWeek(store,adapter,{policy:{...c},initialSol:50,feeSol:c.feeSol,rentSol:c.rentSol,clock:()=>now});await engine.load();return {engine,adapter,dir,advance:n=>now+=n,now:()=>now,calls:()=>calls};}
test('cheap rejection never calls RPC or quote and every A candidate is durably logged',async t=>{const f=await setup(t);await f.engine.step([{...market(f.now()),liquidityUsd:1}]);assert.equal(f.calls(),0);const file=(await readdir(f.dir)).find(n=>n.endsWith('.jsonl.gz'));const text=gunzipSync(await readFile(path.join(f.dir,file))).toString();assert.match(text,/A_LIQ/);assert.equal(f.engine.state.counts.virtualBuys,0);});
test('missing rug/safety stays B_UNVERIFIED and retries only after 60s, not quality-bad',async t=>{const f=await setup(t);await f.engine.step([market(f.now())]);await Promise.all(f.engine.reads.values());f.advance(5000);await f.engine.step([market(f.now())]);assert.equal(f.calls(),1);assert.equal(f.engine.state.scalp.reasons.B_UNVERIFIED,2);f.advance(60000);await f.engine.step([market(f.now())]);await Promise.all(f.engine.reads.values());assert.equal(f.calls(),2);assert.equal(f.engine.state.counts.virtualBuys,0);});
test('hourly funnel counts infrastructure separately, never auto-adjusts from fewer than 50 trades',async t=>{const f=await setup(t);await f.engine.step([market(f.now())]);f.advance(c.dayMs);await f.engine.step([market(f.now())]);assert.equal(f.engine.state.scalp.adjustment.eligible,false);assert.equal(f.engine.state.scalp.relaxLevel,0);assert.ok(f.engine.state.scalp.lastHour);});
test('full fixture passes A through E, consumes the signal and trades using the new exit policy',async t=>{
 const f=await setup(t);f.adapter.scalpSafety=async m=>facts(m,f.now());f.adapter.refreshCandidate=async m=>({...m,priceAt:f.now(),priceSource:'RPC TEST_FIXTURE',spotPriceSol:1+(f.now()-at)/1000000});
 f.adapter.quote=async o=>{const px=1.02,expected=String(Math.floor(Number(o.amount)/1e9/px*1e6)),out=o.side==='BUY'?String(Math.floor(Number(expected)*.985)):String(Math.floor(Number(o.amount)/1e6*px*1e9*.985));return {at:f.now(),out,expectedOut:expected,decimals:6,impactPct:1,roundTrip:o.side==='BUY'?{mint:o.mint,pool:o.pool,inAmount:o.amount,sellInput:out,sellOut:String(Math.floor(Number(o.amount)*.97)),at:f.now(),impactPct:1}:undefined};};
 for(const delta of [0,5000,10000,10000,1000]){f.advance(delta);await f.engine.step([{...market(f.now()),spotPriceSol:1.02}]);await Promise.all(f.engine.reads.values());}
 assert.equal(f.engine.state.pending?.side,'BUY');f.advance(c.fillDelayMs);await f.engine.step([{...market(f.now()),spotPriceSol:1.02}]);await Promise.all([...f.engine.quoteJobs.values()].map(j=>j.task));f.advance(1);await f.engine.step([{...market(f.now()),spotPriceSol:1.02}]);
 assert.equal(f.engine.state.counts.virtualBuys,1,JSON.stringify(f.engine.state.errors));assert.equal(f.engine.state.positions[0].exitPolicy.stopPct,10);assert.equal(f.engine.state.positions[0].exitPolicy.tp1Pct,15);assert.equal(f.engine.state.scalp.consumed.TEST_FIXTURE.orderId,f.engine.state.positions[0].id);
});
test('D_INFRA retries at 1s/2s/4s, never consumes a signal or labels the token bad',async t=>{
 const f=await setup(t),m=market(f.now());let calls=0;f.adapter.quote=async()=>{calls++;throw Object.assign(Error('HTTP 429'),{code:'429'});};const o={id:'infra-fixture',side:'BUY',mint:m.mint,pool:m.pairAddress,amount:'1000000000',decidedAt:f.now(),readyAt:f.now(),sizeBase:1,sizeIndex:0,infraRetries:0,signalId:'infra-signal',scalpContext:f.engine.context(m,'infra-signal')};f.engine.state.pending=o;
 for(let i=0;i<4;i++){f.engine.safety.set(m.mint,{facts:facts(m,f.now())});f.engine.samples.set(m.mint+':'+m.pairAddress,[{at:f.now()-20000,price:1,liquiditySol:100},{at:f.now()-10000,price:1.01,liquiditySol:100},{at:f.now(),price:1.02,liquiditySol:100}]);await f.engine.fill([market(f.now())]);await Promise.all([...f.engine.quoteJobs.values()].map(j=>j.task));await f.engine.fill([market(f.now())]);if(i<3){assert.equal(f.engine.state.pending.nextAttemptAt,f.now()+c.dBackoffMs[i]);f.advance(c.dBackoffMs[i]);}}
 assert.equal(calls,4);assert.equal(f.engine.state.pending,null);assert.equal(f.engine.state.scalp.infra,4);assert.equal(f.engine.state.scalp.consumed.TEST_FIXTURE,undefined);const file=(await readdir(f.dir)).find(n=>n.endsWith('.jsonl.gz'));const rows=gunzipSync(await readFile(path.join(f.dir,file))).toString().trim().split('\n').map(JSON.parse);assert.ok(rows.every(r=>r.reason_code==='D_INFRA'&&r.quality_rejection===false));
});
test('a failed boosts source does not stop profiles, SOL pricing or PumpSwap discovery',async()=>{
 const {ScalpFeed}=await import('../scalp-feed.js');const {PublicKey}=await import('@solana/web3.js');const mint=new PublicKey(Uint8Array.from({length:32},(_,i)=>i+1)).toBase58();const SOL='So11111111111111111111111111111111111111112';
 const fetcher=async url=>{const u=String(url);if(u.includes('token-boosts'))return new Response('unavailable',{status:500});if(u.includes('token-profiles'))return Response.json([{chainId:'solana',tokenAddress:mint}]);if(u.includes('latest/dex/tokens'))return Response.json({pairs:[{chainId:'solana',baseToken:{address:SOL},priceUsd:'100',liquidity:{usd:1000000}}]});if(u.includes('tokens/v1/solana'))return Response.json([{chainId:'solana',dexId:'pumpswap',baseToken:{address:mint,symbol:'FIXTURE'},quoteToken:{address:SOL},pairAddress:'fixture-pool',priceUsd:'1',liquidity:{usd:20000,quote:100},priceChange:{m5:10,h1:0},txns:{m5:{buys:20,sells:10}},volume:{m5:2000},pairCreatedAt:Date.now()-600000}]);return Response.json([]);};
 const feed=new ScalpFeed({execution:{curveMarketData:async()=>[]}},{policy:c,env:{},fetcher});for(let i=0;i<4;i++){await feed.refresh([]);await Promise.all(feed.jobs.values());}const rows=await feed.refresh([]);assert.ok(rows.some(m=>m.mint===mint));assert.equal(feed.statusInfo().sources.boosts.status,'UNAVAILABLE');assert.equal(feed.statusInfo().sources.gmgn.status,'NOT_CONFIGURED');await Promise.all(feed.jobs.values());
});
test('max hold exits all even if a prior unfilled TP1 remains latched',()=>{const p={entry:1,peak:1.2,openedAt:at,tpDone:false,memory:{tp1Triggered:true},exitPolicy:scalpExitPolicy(c)};assert.equal(scalpExit(p,1.2,at+c.maxHoldMs).reason,'scalp-max-hold');assert.equal(scalpExit(p,1.2,at+c.maxHoldMs).fraction,1);});
test('a scalp stop remains triggered through a price bounce until its exit is recorded',()=>{const p={entry:1,peak:1,openedAt:at,tpDone:false,memory:{},exitPolicy:scalpExitPolicy(c)};assert.equal(scalpExit(p,.89,at).reason,'stop-loss');assert.equal(scalpExit(p,1.1,at+1000).reason,'stop-loss');});
test('non-infrastructure quote failures try 100/50/25/min without consuming a BUY signal',async t=>{const f=await setup(t),m=market(f.now()),sizes=[];f.adapter.quote=async o=>{sizes.push(o.amount);throw Error('NO_ROUTE');};f.engine.state.pending={id:'size-fixture',side:'BUY',mint:m.mint,pool:m.pairAddress,amount:'1000000000',sizeBase:1,sizeIndex:0,infraRetries:0,signalId:'size',decidedAt:f.now(),readyAt:f.now(),scalpContext:f.engine.context(m,'size')};for(let i=0;i<4;i++){f.engine.safety.set(m.mint,{facts:facts(m,f.now())});f.engine.samples.set(m.mint+':'+m.pairAddress,[{at:f.now()-20000,price:1,liquiditySol:100},{at:f.now()-10000,price:1.01,liquiditySol:100},{at:f.now(),price:1.02,liquiditySol:100}]);await f.engine.fill([m]);await Promise.all([...f.engine.quoteJobs.values()].map(j=>j.task));await f.engine.fill([m]);}assert.deepEqual(sizes,['1000000000','500000000','250000000','2500000']);assert.equal(f.engine.state.pending,null);assert.equal(f.engine.state.scalp.consumed.TEST_FIXTURE,undefined);});
test('compressed audit export is streamed and rejects traversal names',async t=>{const f=await setup(t);await f.engine.step([{...market(f.now()),liquidityUsd:1}]);const file=(await readdir(f.dir)).find(n=>n.endsWith('.jsonl.gz'));const {stream,size}=await f.engine.store.documentStream(file);const chunks=[];for await(const chunk of stream)chunks.push(chunk);assert.equal(Buffer.concat(chunks).length,size);assert.match(gunzipSync(Buffer.concat(chunks)).toString(),/A_LIQ/);await assert.rejects(f.engine.store.documentStream('../secret.jsonl.gz'));});
test('upgrading a funded v2 session checkpoints its ledger and preserves old-position exit policy',async t=>{const f=await setup(t),s=f.engine.state;delete s.scalp;s.policyVersion='paper-momentum-5m-v2';s.cash-=1000025000+2039280;s.positions=[{id:'old-v2',mint:'OLD_FIXTURE',pool:'OLD_POOL',raw:'100000000',initialRaw:'100000000',decimals:6,entry:.01,basis:1000025000,rent:2039280,openedAt:at,memory:{},tpDone:false,exitPolicy:{version:'paper-momentum-5m-v2',stopLossPct:30,tpMultiples:[2,3,5,10],tpFractions:[.5,.2,.2,.1]}}];await f.engine.store.save(s);const second=new ScalpWeek(new PaperStore(f.dir),f.adapter,{policy:{...c},initialSol:50,feeSol:c.feeSol,rentSol:c.rentSol,clock:f.now});await second.load();assert.equal(second.state.cash,s.cash);assert.equal(second.state.positions[0].exitPolicy.version,'paper-momentum-5m-v2');assert.equal(second.exitPlan(second.state.positions[0],.0085),null);assert.ok((await readdir(f.dir)).includes('paper-week-state-before-paper-meme-scalp-entry-v1.json'));assert.equal(second.status().accounting.verified,true);});
test('scalp +15/+30 and moved stop are relative to the locked BUY, never 5m or discovery prices',async()=>{
 const {lockPositionEntry}=await import('../position-entry.js');const p={id:'anchor-fixture',mint:'M',openedAt:at,entry:.01,initialRaw:'100000000',decimals:6,peak:.01,tpDone:false,memory:{},marketChange5mPct:300,discoveryPriceSol:.001,exitPolicy:scalpExitPolicy(c)};lockPositionEntry(p,{principalLamports:1000000000});p.entry=99;
 assert.equal(scalpExit(p,.0114,at),null);assert.equal(scalpExit(p,.0116,at).reason,'scalp-tp1');p.tpDone=true;p.peak=.0116;p.memory={};assert.equal(scalpExit(p,.0101,at).reason,'stop-loss');
});

test('paper defaults remove slot cap and external rug gate while preserving on-chain and capital checks',()=>{
 assert.equal(c.maxPositions,0);assert.equal(c.rugRequired,false);
 const m=market(),f={...facts(m),rugDanger:null,coverage:{...facts(m).coverage,rug:false}};
 assert.equal(stageB(f,m,c,at).pass,true);
 assert.equal(stageB({...f,coverage:{...f.coverage,holders:false}},m,c,at).reason_code,'B_UNVERIFIED');
 assert.equal(stageB({...f,mintRevoked:false},m,c,at).reason_code,'B_AUTHORITY');
 assert.equal(stageB({...f,top10Pct:99},m,c,at).reason_code,'B_TOP10');
 const s={cash:39e9,initial:50e9,positions:Array.from({length:11},(_,i)=>({mint:'OTHER'+i,basis:1e9})),trades:[],scalp:{consumed:{},fundSol:50}};
 assert.equal(stageE(m,s,c,at,1,'new').pass,true);
 assert.equal(stageE(m,s,{...c,maxPositions:10},at,1,'new').reason_code,'E_POSITIONS');
 assert.equal(stageE(m,{...s,cash:0},c,at,1,'new').reason_code,'E_CASH');
 assert.equal(stageE(m,{...s,scalp:{...s.scalp,fundSol:20}},c,at,1,'new').reason_code,'E_EXPOSURE');
});

test('adapter without rug provider still reads RPC and rejects a live mint authority',async t=>{
 const {Connection,PublicKey}=await import('@solana/web3.js');
 const {createPaperAdapter}=await import('../readonly.js');let reads=0;
 t.mock.method(Connection.prototype,'getParsedAccountInfo',async()=>{reads++;return {value:{owner:new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),data:{parsed:{info:{decimals:6,mintAuthority:'TEST_AUTHORITY',freezeAuthority:null}}}}};});
 const m={...market(),mint:'So11111111111111111111111111111111111111112'};
 const adapter=createPaperAdapter('/tmp',{env:{},policy:c});
 const result=await adapter.scalpSafety(m);
 assert.equal(reads,1);assert.equal(result.reason_code,'B_AUTHORITY');
 const strict=createPaperAdapter('/tmp',{env:{},policy:{...c,rugRequired:true}});
 assert.deepEqual((await strict.scalpSafety(m)).missing,['RUG_SOURCE_NOT_CONFIGURED']);assert.equal(reads,1);
});

test('pending BUY waits for a fresh reserve read at the 5s boundary instead of cancelling',async t=>{
 const f=await setup(t),m=market(f.now()),k=m.mint+':'+m.pairAddress;
 f.engine.safety.set(m.mint,{facts:facts(m,f.now())});
 f.engine.samples.set(k,[{at:f.now()-25044,price:1,liquiditySol:100},{at:f.now()-15044,price:1.01,liquiditySol:100},{at:f.now()-5044,price:1.02,liquiditySol:100}]);
 const o={id:'refresh-fixture',side:'BUY',mint:m.mint,pool:m.pairAddress,amount:'1000000000',decidedAt:f.now()-3000,readyAt:f.now()-1000,signalId:'refresh-signal',referencePriceSol:1.02,scalpContext:f.engine.context(m,'refresh-signal')};f.engine.state.pending=o;
 f.adapter.refreshCandidate=async()=>({...m,spotPriceSol:1.025,priceAt:f.now(),liquidityQuoteSol:100});
 await f.engine.fill([m]);assert.equal(f.engine.state.pending?.id,o.id);await Promise.all(f.engine.reads.values());
 assert.equal(f.engine.samples.get(k).at(-1).at,f.now());assert.equal(f.engine.state.counts.virtualBuys,0);
 assert.equal(f.engine.state.scalp.consumed[m.mint],undefined);
});
test('raw reserve samples keep sub-gap observations while selected confirmation samples remain >=5s apart',async t=>{
 const f=await setup(t),m=market(f.now()),k=m.mint+':'+m.pairAddress;
 f.engine.samples.set(k,[{at:f.now()-20000,price:1,liquiditySol:100},{at:f.now()-10000,price:1.01,liquiditySol:100},{at:f.now()-3000,price:1.02,liquiditySol:100}]);
 f.adapter.refreshCandidate=async()=>({...m,spotPriceSol:1.025,priceAt:f.now(),liquidityQuoteSol:100});
 f.engine.sampleRead(m);await Promise.all(f.engine.reads.values());
 const rows=f.engine.samples.get(k);assert.equal(rows.at(-1).at,f.now());const check=stageC(rows,c,f.now());assert.equal(check.pass,true);assert.ok(check.metrics.samples.slice(1).every((r,i)=>r.at-check.metrics.samples[i].at>=c.cGapMs));
});

test('expired quote after an RPC refresh is retried without relaxing freshness or consuming the signal',async t=>{
 const f=await setup(t),m=market(f.now()),k=m.mint+':'+m.pairAddress;
 f.engine.safety.set(m.mint,{facts:facts(m,f.now())});
 f.engine.samples.set(k,[{at:f.now()-20000,price:1,liquiditySol:100},{at:f.now()-10000,price:1.01,liquiditySol:100},{at:f.now(),price:1.02,liquiditySol:100}]);
 const o={id:'expired-fixture',side:'BUY',mint:m.mint,pool:m.pairAddress,amount:'1000000000',decidedAt:f.now()-10000,readyAt:f.now()-8000,signalId:'expired',referencePriceSol:1.02,infraRetries:0,scalpContext:f.engine.context(m,'expired')};f.engine.state.pending=o;
 f.engine.quoteJobs.set(o.id,{done:true,value:{at:f.now()-4000,out:'1000000',impactPct:.1,roundTrip:{mint:m.mint,pool:m.pairAddress,inAmount:o.amount,sellInput:'1000000',sellOut:'970000000',at:f.now()-3500,impactPct:.1}},task:Promise.resolve()});
 await f.engine.fill([m]);assert.equal(f.engine.state.pending.id,o.id);assert.equal(o.infraRetries,1);assert.equal(o.nextAttemptAt,f.now()+c.dBackoffMs[0]);assert.equal(f.engine.state.counts.virtualBuys,0);assert.equal(f.engine.state.scalp.consumed[m.mint],undefined);
});

test('PumpSwap missing coinCreator uses only the verified mint-derived pump curve, not a profile creator',async t=>{
 const {Connection,PublicKey,Keypair}=await import('@solana/web3.js');
 const {PUMP_AMM_SDK,PUMP_AMM_PROGRAM_ID}=await import('@pump-fun/pump-swap-sdk');
 const {PUMP_SDK,PUMP_PROGRAM_ID,bondingCurvePda}=await import('@pump-fun/pump-sdk');
 const {SolanaExecution}=await import('../../src/solana.js');const {createPaperAdapter}=await import('../readonly.js');
 const mint=Keypair.generate().publicKey,pool=Keypair.generate().publicKey,creator=Keypair.generate().publicKey,curve=bondingCurvePda(mint);let derivedRead=false,holderCreator;
 t.mock.method(Connection.prototype,'getParsedAccountInfo',async()=>({value:{owner:new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),data:{parsed:{info:{decimals:6,mintAuthority:null,freezeAuthority:null}}}}}));
 t.mock.method(Connection.prototype,'getAccountInfo',async key=>{if(key.equals(curve)){derivedRead=true;return {owner:PUMP_PROGRAM_ID,data:Buffer.alloc(100),executable:false};}assert.equal(key.toBase58(),pool.toBase58());return {owner:PUMP_AMM_PROGRAM_ID,data:Buffer.alloc(100)};});
 t.mock.method(PUMP_AMM_SDK,'decodePool',()=>({baseMint:mint,quoteMint:new PublicKey('So11111111111111111111111111111111111111112'),coinCreator:PublicKey.default,poolBaseTokenAccount:Keypair.generate().publicKey}));
 t.mock.method(PUMP_SDK,'decodeBondingCurve',()=>({creator,quoteMint:PublicKey.default,depth:0,isMayhemMode:false,isCashbackCoin:false}));
 t.mock.method(SolanaExecution.prototype,'holderFacts',async(_mint,_program,_excluded,_vaults,dev)=>{holderCreator=dev;return {top10Pct:10,devPct:2,holderCount:100};});
 const adapter=createPaperAdapter('/tmp',{env:{},policy:c}),m={...market(),mint:mint.toBase58(),pairAddress:pool.toBase58(),creatorAddress:'UNTRUSTED_PROFILE'};
 const f=await adapter.scalpSafety(m);assert.equal(derivedRead,true);assert.equal(holderCreator,creator.toBase58());assert.equal(f.creatorSource,'mint-derived-pump-curve');assert.equal(stageB(f,m,c,Date.now()).pass,true);
 t.mock.method(Connection.prototype,'getAccountInfo',async key=>key.equals(curve)?{owner:PublicKey.default,data:Buffer.alloc(100),executable:false}:{owner:PUMP_AMM_PROGRAM_ID,data:Buffer.alloc(100)});
 assert.deepEqual((await adapter.scalpSafety(m)).missing,['DEV_IDENTITY_UNVERIFIED']);
});

test('single preview TXT and 23:59 Telegram TXT include grouped audit and all observed executions without resetting the ledger',async t=>{
 const {nextPaperReportEnd,paperReportEnd}=await import('../../src/paper-schedule.js');
 const f=await setup(t),s=f.engine.state,m=market(f.now());
 const raw={...f.engine.context(m,'first'),stage_reached:'A',reason_code:'A_LIQ',metrics:{A:{liquidity:100}}};
 await f.engine.logs.append([raw,{...raw,ts:f.now()+10,signal_id:'second'},{...raw,ts:f.now()+20,type:'execution',reason_code:'D_COST',metrics:{D:{detail:'FRICTION'}}}]);f.advance(100);
 const balance=s.cash,filesBefore=await readdir(f.dir);const name=await f.engine.reportPreview();assert.equal(name,'paper-week-report.txt');
 const {stream}=await f.engine.store.documentStream(name);let text='';for await(const chunk of stream)text+=chunk;
 assert.match(text,/TRAINING EXPORT/);assert.match(text,/SCALP AUDIT/);assert.match(text,/"observationCount":2/);assert.match(text,/"reason_code":"D_COST"/);assert.match(text,/"auditObservations": 3/);assert.equal(s.cash,balance);assert.equal(s.outbox.length,0);
 assert.ok(filesBefore.some(n=>n.endsWith('.jsonl.gz')));assert.ok((await readdir(f.dir)).some(n=>n.endsWith('.jsonl.gz')));
 const end=nextPaperReportEnd(paperReportEnd(f.now()));f.advance(end-f.now());let sent=0;
 await f.engine.reportTick({configured:true,document:async(name,_caption,bytes)=>{sent++;assert.match(name,/\.txt$/);assert.match(bytes.toString(),/"observationCount":2/);assert.match(bytes.toString(),/"reason_code":"D_COST"/);return 15;}});
 assert.equal(sent,1);assert.equal(s.cash,balance);await f.engine.reportTick({configured:true,document:async()=>{throw Error('DUPLICATE');}});assert.equal(s.outbox[0].status,'sent');
});

test('bundle reports corrupted sources and bounded export omissions explicitly',async t=>{
 const {writeFile}=await import('node:fs/promises');const {writeReportBundle}=await import('../report-bundle.js');const f=await setup(t);
 const r={...f.engine.context(market(),'s'),reason_code:'A_LIQ',metrics:{A:{liquidity:1}}};
 await f.engine.logs.append([r]);f.advance(100);const stamp=new Date(f.now()).toISOString().slice(0,13).replace('T','-');
 // Corrupt a different retained hour within the requested range.
 const nextHour=new Date(f.now()+3600000).toISOString().slice(0,13).replace('T','-');await writeFile(path.join(f.dir,'scalp-'+nextHour+'.jsonl.gz'),'not gzip');
 await writeReportBundle(f.dir,'paper-week-report.txt','SIMULATION',{from:f.now()-1000,to:f.now()+7200000,maxBytes:70000});
 const text=await readFile(path.join(f.dir,'paper-week-report.txt'),'utf8'),coverage=JSON.parse(text.split('EXPORT COVERAGE\n')[1]);
 assert.equal(coverage.auditObservations,1);assert.equal(coverage.omittedObservations,1);assert.equal(coverage.sourceErrors[0].code,'LOG_READ_INCOMPLETE');
 assert.ok((await readdir(f.dir)).includes('scalp-'+stamp+'.jsonl.gz'));
 await assert.rejects(writeReportBundle(f.dir,'../secret.txt','',{from:0,to:1}),/INVALID_REPORT_RANGE/);
});

test('one TXT alone remains analyzable with fill-id deduplication across training and audit',async t=>{
 const {mkdir,copyFile}=await import('node:fs/promises');const {execFileSync}=await import('node:child_process');const f=await setup(t);
 const buy={simulation:true,type:'virtual_fill',id:'bundle-buy',positionId:'bundle-position',side:'BUY',at:f.now(),ts:f.now(),principalSol:1,strategyVersion:c.version};
 const sell={...buy,id:'bundle-sell',side:'SELL',closed:true,pnlSol:.05,positionPnlSol:.05};
 await f.engine.store.record(buy);await f.engine.logs.append([buy,sell]);f.advance(100);
 const name=await f.engine.reportPreview(),text=await readFile(path.join(f.dir,name),'utf8');assert.match(text,/bundle-sell/);
 const standalone=path.join(f.dir,'standalone');await mkdir(standalone);await copyFile(path.join(f.dir,name),path.join(standalone,name));
 const result=JSON.parse(execFileSync(process.execPath,['paper-week/analyze.js',standalone],{encoding:'utf8'}));
 assert.equal(result.uniqueVirtualFills,2);assert.equal(result.closed,1);assert.equal(result.wins,1);assert.equal(result.observedSellPnlSol,.05);
});
