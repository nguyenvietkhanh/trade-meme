import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Keypair,VersionedTransaction,TransactionMessage,SystemProgram} from '@solana/web3.js';
import bs58 from 'bs58';
import {AutomaticFleet} from '../src/automatic-fleet.js';
import {setTimeout as delay} from 'node:timers/promises';
import {AutomaticTreasury} from '../src/automatic-treasury.js';
import {MultiLiveModelRuntime} from '../src/multi-live-runtime.js';
import {initialBotState} from '../src/paper-bot-state.js';
import {ACTIVE_BOT_CONFIGS} from '../src/paper-bot-config.js';
import {validateModelDecisions,modelMessages,walletFingerprint} from '../src/paper-model-context.js';
import {PaperModelClient} from '../src/paper-model-client.js';
const risk={approved:true,reason:'Observed liquidity supports this size',risks:['volatility'],unknowns:['holders']};
const buy=(mint,size=.1)=>({action:'BUY',mint,order_sol:size,sell_percent:null,stop_loss_pct:12,risk_assessment:risk,confidence:.7,reason:'Independent AI decision'});
const context=()=>({aiOnly:true,batchOrders:true,botId:'kade',mode:'live',snapshotId:'test',asOf:Date.now(),wallet:{running:true},positions:[],candidates:['a','b','c'].map(mint=>({mint,pool:mint+'-pool',priceSol:.01})),openOrders:[],limits:{maxOrderSol:.8,minOrderSol:.0025,maxPositions:100,maxBatchOrders:5}});

test('batch validates shared money, distinct mints, each stop and risk evidence',()=>{
 const c=context();assert.equal(validateModelDecisions({decisions:[buy('a',.4),buy('b',.4)]},c).length,2);
 for(const decisions of [[buy('a',.5),buy('b',.5)],[buy('a'),buy('a')],[buy('a'),{...buy('b'),stop_loss_pct:null}],[buy('a'),{...buy('b'),risk_assessment:null}]])assert.throws(()=>validateModelDecisions({decisions},c),{code:'MODEL_INVALID_DECISION'});
 assert.throws(()=>validateModelDecisions({decisions:[buy('a')]},{...c,openOrders:[{mint:'a'}]}));assert.match(modelMessages(c)[0].content,/BATCH MODE/);assert.match(modelMessages(c)[0].content,/one shared budget/);
});
test('real model request path accepts batch schema and binds risk facts to each mint',async()=>{
 const c=context(),model=new PaperModelClient({env:{MODEL_API_KEY:'fixture-only',MODEL_TRADING_ENABLED:'true'},fetcher:async(_url,opts)=>{const payload=JSON.parse(opts.body);assert.ok(payload.max_tokens>=2048);assert.match(payload.messages[0].content,/BATCH MODE/);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({decisions:[buy('a'),buy('b')]})}}]}));}});
 const result=await model.decide('kade',c);assert.equal(result.decisions.length,2);assert.equal(result.riskEvidenceByMint.a.mint,'a');assert.equal(result.riskEvidenceByMint.b.mint,'b');
});
test('two broadcasts can remain in flight together; funds and exact signatures are durable first; duplicate/oversize submissions cannot double spend',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'multi-treasury-'));t.after(()=>rm(dir,{recursive:true,force:true}));const kp=Keypair.generate(),now=Date.now(),waiting=[];let sends=0,entered;const ready=new Promise(resolve=>entered=resolve);
 let tr;const execution={network:async()=>{},balance:async()=>1,holdings:async()=>[],mintCheck:async()=>{},entryQuote:async()=>({minOut:'1'}),prepare:async()=>({bytes:new VersionedTransaction(new TransactionMessage({payerKey:kp.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:kp.publicKey,toPubkey:kp.publicKey,lamports:1})]}).compileToV0Message()).serialize(),lastValidBlockHeight:999,quote:{}}),send:async bytes=>{sends++;const signature=bs58.encode(VersionedTransaction.deserialize(bytes).signatures[0]),disk=JSON.parse(await readFile(tr.file));assert.ok(Object.values(disk.orders).some(o=>o.signature===signature));const task=new Promise(resolve=>waiting.push(()=>resolve(signature)));if(waiting.length===2)entered();return task;}};
 const opts={owner:kp.publicKey.toBase58(),legacyDir:dir,clock:()=>now,multiOrder:true,signerEnv:{LIVE_SIGNER_SECRET_KEY:bs58.encode(kp.secretKey)}};tr=new AutomaticTreasury(dir,execution,opts);await tr.load();await tr.connect();
 const order=(mint,amount='400000000')=>({id:'live:kade:'+mint,side:'BUY',aiOnly:true,mint,pairAddress:mint+'-pool',amount,decisionAt:now-3000,readyAt:now-1000,aiStopLossPct:12,aiRiskAssessment:risk});
 const [a,b]=await Promise.all(['a','b'].map(mint=>tr.request(order(mint),{mint,pairAddress:mint+'-pool',change5mPct:10,updatedAt:now},'kade')));
 await ready;assert.equal(sends,2,'second send starts without resolving the first');assert.equal(waiting.length,2);assert.notEqual(a.signature,b.signature);assert.equal(Object.values(tr.s.orders).filter(o=>!o.terminal).length,2);
 await tr.request(order('a'),{mint:'a',pairAddress:'a-pool'},'kade');assert.equal(sends,2);
 await assert.rejects(tr.request(order('c','200000000'),{mint:'c',pairAddress:'c-pool',change5mPct:10,updatedAt:now},'kade'),{code:'LIVE_CAPITAL_CHANGED'});assert.equal(sends,2);assert.ok(tr.availableLamports(1000000000)>=0);
 const tasks=[...tr.broadcastJobs.values()];waiting.forEach(resolve=>resolve());await Promise.all(tasks);assert.equal(tr.s.orders['live:kade:a'].status,'pending');
 const restart=new AutomaticTreasury(dir,{...execution,status:async()=>null,height:async()=>1},opts);await restart.load();await restart.connect();assert.equal(restart.s.orders['live:kade:a'].signature,a.signature);assert.equal(restart.s.orders['live:kade:b'].signature,b.signature);assert.equal(sends,2);assert.equal(restart.view('kade').livePendings.length,2);
});
test('multi runtime queues two validated AI intents and starts both execution requests before either returns',async()=>{
 const now=Date.now(),c=ACTIVE_BOT_CONFIGS[0],s={...initialBotState(c,now),mode:'live',initialSol:0,aiOnly:true,running:true,liveSigningReady:true,liveSpendableSol:.8,liveBookAt:now,livePendings:[]},waiting=[];let calls=0;
 const runtime=new MultiLiveModelRuntime(c,s,{ai:{enabled:true},execute:async o=>{calls++;return new Promise(resolve=>waiting.push(()=>resolve({status:'pending',terminal:false,signature:o.id})));}}),ctx=context();ctx.asOf=now;
 runtime.inbox={context:ctx,fingerprint:walletFingerprint(s),reply:{decisions:[buy('a'),buy('b')],expiresAt:now+30000}};
 const snap={snapshotId:'test',timestamp:now,solUsd:100,markets:['a','b'].map(mint=>({mint,pairAddress:mint+'-pool',priceUsd:1,spotPriceSol:.01,priceAt:now,updatedAt:now}))};runtime.consumeModel(snap,now);assert.equal(s.pendingOrders.length,2);const ids=s.pendingOrders.map(o=>o.id);const tasks=s.pendingOrders.map(o=>runtime.fillOrder(o,snap,now+2000));assert.equal(calls,2);waiting.forEach(resolve=>resolve());await Promise.all(tasks);assert.deepEqual(s.pendingOrders.map(o=>o.id),ids);assert.ok(s.pendingOrders.every(o=>o.wasSubmitted));
});
test('pending context subtracts unreserved intents and skips their mints',()=>{
 const now=Date.now(),c=ACTIVE_BOT_CONFIGS[0],s={...initialBotState(c,now),mode:'live',initialSol:0,pendingOrders:[{id:'q',side:'BUY',mint:'a',amount:'100000000'}],livePendings:[]},r=new MultiLiveModelRuntime(c,s,{ai:{enabled:true}}),ctx=r.prepareDecisionContext(context());
 assert.equal(ctx.limits.maxOrderSol,.695);assert.equal(ctx.limits.maxBatchOrders,4);assert.ok(!ctx.candidates.some(m=>m.mint==='a'));
});
test('stops for different held tokens are scheduled together and skip tokens with pending orders',()=>{
 const now=Date.now(),c=ACTIVE_BOT_CONFIGS[0],s={...initialBotState(c,now),mode:'live',initialSol:0,aiOnly:true,positions:['a','b'].map(mint=>({mint,pairAddress:mint+'-pool',paperPositionId:mint,quantity:1,rawQuantity:'1',costSol:1,aiStopLossPct:10}))},r=new MultiLiveModelRuntime(c,s,{ai:{enabled:true}}),snap={solUsd:100,markets:['a','b'].map(mint=>({mint,pairAddress:mint+'-pool',spotPriceSol:.5,priceAt:now}))};r.monitor(snap,now);assert.equal(s.pendingOrders.length,2);r.monitor(snap,now);assert.equal(s.pendingOrders.length,2);
});

test('actual worker IPC carries batch AI decisions into multiple outstanding treasury orders',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'multi-worker-'));let fleet;t.after(async()=>{await fleet?.stop();await rm(dir,{recursive:true,force:true});});const kp=Keypair.generate();let sends=0,seenBatch=false;
 const data={snapshot:()=>{const now=Date.now();return {snapshotId:'feed',timestamp:now,solUsd:100,markets:['a','b'].map(mint=>({mint,pairAddress:mint+'-pool',dexId:'pumpswap',priceUsd:1,spotPriceSol:.01,priceAt:now,updatedAt:now,marketObservedAt:now,change5mPct:10,volume5mUsd:1000,liquidityUsd:10000}))};},status:()=>({})};
 const execution={network:async()=>{},balance:async()=>1,holdings:async()=>[],mintCheck:async()=>{},entryQuote:async()=>({minOut:'1'}),prepare:async()=>({bytes:new VersionedTransaction(new TransactionMessage({payerKey:kp.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:kp.publicKey,toPubkey:kp.publicKey,lamports:1})]}).compileToV0Message()).serialize(),lastValidBlockHeight:999,quote:{}}),send:async bytes=>{sends++;return bs58.encode(VersionedTransaction.deserialize(bytes).signatures[0]);}};
 const model={verify:async()=>({verified:true}),settings:()=>({configured:true,enabled:true,pollMs:5000,name:'fixture'}),status:()=>({configured:true}),cancel:()=>{},decide:async(_id,ctx)=>{seenBatch=ctx.batchOrders===true;return {decisions:[buy('a',.01),buy('b',.01)],expiresAt:ctx.asOf+30000};}};
 fleet=new AutomaticFleet(dir,data,{owner:kp.publicKey.toBase58(),legacyDir:dir,execution,modelClient:model,signerEnv:{LIVE_SIGNER_SECRET_KEY:bs58.encode(kp.secretKey)}});await fleet.load();fleet.start();await fleet.connectWallet();
 for(let i=0;i<240&&sends<2;i++){fleet.publish();await delay(25);}
 assert.equal(seenBatch,true);assert.equal(sends,2);assert.equal(fleet.treasury.view('kade').livePendings.length,2);assert.equal(fleet.treasury.s.positions.length,0,'sends are not fabricated fills');
});
test('worker restores every signed pending order, including legacy singular state, without allocating new IDs',async()=>{
 const now=Date.now(),c=ACTIVE_BOT_CONFIGS[0],old={id:'legacy',side:'BUY',mint:'a',pairAddress:'a-pool',amount:'100',readyAt:now-1,decisionAt:now-60000,signature:'old-signature'},other={...old,id:'other',mint:'b',pairAddress:'b-pool',signature:'other-signature'},s={...initialBotState(c,now),mode:'live',initialSol:0,running:false,liveSigningReady:false,pending:old,livePending:old,livePendings:[old,other]},calls=[];
 const r=new MultiLiveModelRuntime(c,s,{ai:{enabled:true},execute:async o=>{calls.push(o.id);return {status:'unknown',terminal:false,signature:o.signature};}});await r.tick({snapshotId:'empty',timestamp:now,markets:[],solUsd:100},now);assert.deepEqual(calls.sort(),['legacy','other']);assert.deepEqual(s.pendingOrders.map(o=>o.id).sort(),['legacy','other']);assert.ok(s.pendingOrders.every(o=>o.wasSubmitted));
});
test('five pending orders and same-mint races prevent additional treasury submissions',()=>{
 const tr=Object.create(AutomaticTreasury.prototype);tr.multiOrder=true;tr.maxConcurrentOrders=5;tr.s={orders:{a:{mint:'a',terminal:false}}};assert.throws(()=>tr.assertOrderCapacity({mint:'a'},'kade'),{code:'LIVE_OWN_ORDER_PENDING'});assert.doesNotThrow(()=>tr.assertOrderCapacity({mint:'b'},'kade'));for(let i=0;i<5;i++)tr.s.orders['p'+i]={mint:'p'+i,terminal:false};assert.throws(()=>tr.assertOrderCapacity({mint:'new'},'kade'),{code:'LIVE_OWN_ORDER_PENDING'});
});

test('late broadcast completion cannot overwrite a receipt that already confirmed the same signature',async()=>{
 const tr=Object.create(AutomaticTreasury.prototype);let release;tr.multiOrder=true;tr.broadcastJobs=new Map();tr.execution={send:()=>new Promise(resolve=>release=resolve)};tr.s={orders:{o:{id:'o',signature:'sig',terminal:false,status:'signed'}}};tr.view=()=>({});tr.serial=fn=>Promise.resolve().then(fn);tr.save=async()=>{};
 await tr.broadcast({...tr.s.orders.o,agentId:'kade'},new Uint8Array());const tasks=[...tr.broadcastJobs.values()];tr.s=structuredClone(tr.s);tr.s.orders.o.terminal=true;tr.s.orders.o.status='confirmed';release('sig');await Promise.all(tasks);assert.equal(tr.s.orders.o.status,'confirmed');assert.equal(tr.s.orders.o.terminal,true);
});
