import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,writeFile,stat} from 'node:fs/promises';
import {Keypair} from '@solana/web3.js';
import {createOwnerLedger,applyOwnerReceipt} from '../src/owner-ledger.js';
import {entryFeatures,trainingRecord} from '../src/training-records.js';
import {TrainingArchive,reportEnd,reportSummary,validReportRef} from '../src/training-archive.js';
import {TelegramReporter} from '../src/telegram.js';
const DAY=86400000,end=Date.parse('2026-10-19T16:00:00Z');
async function setup(fn){const dir=await mkdtemp('/tmp/meme-training-'),kp=Keypair.generate();try{await fn(dir,kp);}finally{await rm(dir,{recursive:true,force:true});}}
function agent(dir,kp){const owner=kp.publicKey.toBase58(),s=createOwnerLedger(owner,2);let chain=Promise.resolve();const a={state:s,vault:{keypair:kp},serial:fn=>{const t=chain.then(fn);chain=t.catch(()=>{});return t;},save:async()=>{a.saved=structuredClone(a.state);}};a.telegram=new TelegramReporter(dir,owner);a.training=new TrainingArchive(dir,owner);return a;}
function fill(owner,id,at,pnl,{closed=true,side='SELL'}={}){return {schemaVersion:1,owner,id,signature:id,mint:'mint',symbol:'TEST',side,at,sol:.15,pnlSol:pnl,positionPnlSol:closed?pnl:null,closed,entryFeatures:null,dataQuality:'historical-incomplete'};}
const token='123456789:fixture_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789';
const response=()=>new Response(JSON.stringify({ok:true,result:{message_id:99}}));

test('23h Vietnam report boundaries are independent of UTC date and use [from,to)',()=>{
 assert.equal(reportEnd(end-1),end-DAY);assert.equal(reportEnd(end),end);assert.equal(reportEnd(end+DAY-1),end);
 assert.equal(validReportRef({end,part:1}),true);for(const ref of [{end:end+1,part:1},{end,part:'../vault'},{end,part:0},{end:NaN,part:1}])assert.equal(validReportRef(ref),false);
 const s=reportSummary([fill('o','win',end-1,.02),fill('o','loss',end-2,-.01),fill('o','partial',end-3,.05,{closed:false}),fill('o','unknown',end-4,null)],end);
 assert.equal(s.winners,1);assert.equal(s.losers,1);assert.equal(s.unknownPnl,1);assert.equal(s.winRate,.5);assert.ok(Math.abs(s.netClosedPnlSol-.01)<1e-12);assert.ok(Math.abs(s.realizedSalePnlSol-.06)<1e-12);
});

test('training snapshots whitelist market features and retain entry-time facts without signed data',()=>{
 const m={mint:'mint',pairAddress:'pool',priceUsd:1,updatedAt:Date.now(),valuationUsd:5000,apiKey:'secret',privateKey:'secret',evidence:{mintRevoked:true,secret:'secret'}};
 const f=entryFeatures(m,100,{probeSol:.2,roundTripLossPct:1});assert.equal(f.market.valuationUsd,5000);assert.equal(f.safety.probeSol,.2);assert.ok(!JSON.stringify(f).includes('secret'));m.valuationUsd=9000;assert.equal(f.market.valuationUsd,5000);assert.equal(f.market.volume1hUsd,null);
});

test('confirmed buys and partial/full sales archive actual net PnL; partial profit does not make a losing position a winner',()=>{
 const s=createOwnerLedger('owner',1),features={capturedAt:123,strategyVersion:'fixture',score:80};
 const buy={intent:{side:'BUY',mint:'mint',symbol:'TEST',amount:'200000000',solUsd:100,priceUsd:1,entryFeatures:features,reason:'test'}};
 const bought={status:'confirmed',signature:'buy',solDelta:-.2001,tokenDelta:'20000000',decimals:6,feeSol:.00002,slot:10};
 applyOwnerReceipt(s,buy,bought);assert.equal(s.trainingOutbox.length,1);assert.equal(s.trainingOutbox[0].entryFeatures.score,80);
 applyOwnerReceipt(s,{intent:{side:'SELL',mint:'mint',amount:'10000000',solUsd:100,reason:'partial'}},{...bought,signature:'partial',solDelta:.15,tokenDelta:'-10000000'});
 applyOwnerReceipt(s,{intent:{side:'SELL',mint:'mint',amount:'10000000',solUsd:100,reason:'close'}},{...bought,signature:'close',solDelta:.03,tokenDelta:'-10000000'});
 const [b,p,c]=s.trainingOutbox;assert.equal(b.position.executions.length,1);assert.equal(p.position.executions.length,2);assert.equal(c.position.executions.length,3);assert.ok(p.pnlSol>0);assert.ok(c.positionPnlSol<0);assert.ok(Math.abs(c.positionPnlSol+.0201)<1e-12);assert.equal(c.position.entrySignature,'buy');assert.equal(c.entryFeatures.capturedAt,123);assert.equal(s.positions.length,0);
 assert.equal(reportSummary(s.trainingOutbox,end).winners,0);applyOwnerReceipt(s,buy,bought);assert.equal(s.trainingOutbox.length,3);
});

test('immutable full fills archive survives restart and bounded UI history, with restrictive file permissions',async()=>setup(async(dir,kp)=>{
 const a=agent(dir,kp),owner=a.state.owner,old=fill(owner,'old-win',end-10,.01);a.state.trainingOutbox=[old];await a.training.tick(a,end-100);
 const file=a.training.recordFile(old);assert.equal((await stat(file)).mode&0o777,0o600);assert.equal(a.state.trainingOutbox.length,0);a.state.trades=[];
 const restarted=new TrainingArchive(dir,owner);await restarted.archive({...old,entryFeatures:{doNotOverwrite:true}});assert.equal(JSON.parse(await readFile(file,'utf8')).entryFeatures,null);assert.equal((await restarted.records(end)).length,1);
 await assert.rejects(restarted.document({end,part:'../../owner-signer'}),/không hợp lệ/);
}));

test('23h scheduler persists report before enqueue, includes all winners once and carries losses only in aggregate',async()=>setup(async(dir,kp)=>{
 const a=agent(dir,kp),owner=a.state.owner;a.telegram.enabled=true;
 a.state.trainingOutbox=[fill(owner,'at-start',end-DAY,.02),fill(owner,'loss',end-200,-.01),fill(owner,'partial',end-100,.1,{closed:false}),fill(owner,'unknown',end-90,null),fill(owner,'next-day',end,.2)];
 await a.training.tick(a,end-1);assert.equal(a.state.telegramOutbox,undefined);
 await a.training.tick(a,end);assert.equal(a.state.telegramOutbox.length,1);assert.equal(a.state.dailyTrainingReports.lastEnd,end);
 const doc=await a.training.document(a.state.telegramOutbox[0].report),body=JSON.parse(doc.content);assert.equal(body.winners.length,1);assert.equal(body.winners[0].id,'at-start');assert.equal(body.summary.winners,1);assert.equal(body.summary.losers,1);assert.equal(body.summary.unknownPnl,1);assert.equal(body.summary.confirmedFills,4);assert.ok(doc.filename.includes('2026-10-19'));assert.equal(a.saved.telegramOutbox.length,1);
 await a.training.tick(a,end+5000);a.training=new TrainingArchive(dir,owner);await a.training.tick(a,end+6000);assert.equal(a.state.telegramOutbox.length,1);
 await a.training.tick(a,end+DAY);assert.equal(a.state.telegramOutbox.length,2);assert.equal(JSON.parse((await a.training.document(a.state.telegramOutbox[1].report)).content).winners[0].id,'next-day');
}));

test('missed report is queued after restart even when trading is paused/locked, empty periods still send valid JSON',async()=>setup(async(dir,kp)=>{
 const a=agent(dir,kp);await a.training.tick(a,end-1);a.vault.keypair=null;a.telegram.enabled=true;a.state.running=false;a.training=new TrainingArchive(dir,a.state.owner);
 await a.training.tick(a,end+3600000);assert.equal(a.state.telegramOutbox.length,1);assert.equal(JSON.parse((await a.training.document(a.state.telegramOutbox[0].report)).content).winners.length,0);
}));

test('Telegram sends the persisted JSON as multipart document, saves retry state first, and never resends an acknowledged report',async()=>setup(async(dir,kp)=>{
 const a=agent(dir,kp);await a.telegram.configure(token,'123456789',kp);await a.training.tick(a,end-1);await a.training.tick(a,end);
 let calls=0;a.telegram.fetcher=async(url,options)=>{calls++;assert.ok(url.endsWith('/sendDocument'));assert.equal(options.redirect,'error');assert.equal(a.saved.telegramOutbox[0].attempts,1);assert.equal(options.body.get('chat_id'),'123456789');const f=options.body.get('document'),doc=JSON.parse(await f.text());assert.equal(doc.owner,a.state.owner);assert.deepEqual(doc.winners,[]);assert.ok(!JSON.stringify(doc).includes(token));assert.ok(f.name.startsWith('meme-pilot-winners-'));return response();};
 await a.telegram.tick(a);assert.equal(calls,1);assert.equal(a.state.telegramOutbox[0].messageId,99);await a.telegram.tick(a);assert.equal(calls,1);
}));

test('report HTTP errors retry with redacted diagnostics outside trading queue and leave financial state alone',async()=>setup(async(dir,kp)=>{
 const a=agent(dir,kp);await a.telegram.configure(token,'123456789',kp);await a.training.tick(a,end-1);await a.training.tick(a,end);
 let release,started;const ready=new Promise(r=>started=r),wait=new Promise(r=>release=r);a.telegram.fetcher=async()=>{started();await wait;throw Error(token);};
 const before=structuredClone(a.state);delete before.telegramOutbox;const sending=a.telegram.tick(a);await ready;let continued=false;await a.serial(async()=>{continued=true;});assert.equal(continued,true);release();await sending;assert.ok(!a.telegram.error.includes(token));assert.equal(a.state.telegramOutbox[0].status,'queued');
 const after=structuredClone(a.state);delete after.telegramOutbox;assert.deepEqual(after,before);
}));

test('archive write failure preserves pending logs and report cursor for retry without changing positions/cash',async()=>setup(async(dir,kp)=>{
 const a=agent(dir,kp);a.telegram.enabled=true;await a.training.tick(a,end-1);const r=fill(a.state.owner,'retry',end-10,.02);a.state.trainingOutbox=[r];
 await mkdir(a.training.dir,{recursive:true});await writeFile(a.training.dir+'/fills','block directory');const cash=a.state.cashSol;
 await a.training.tick(a,end);assert.ok(a.training.error);assert.equal(a.state.trainingOutbox.length,1);assert.equal(a.state.dailyTrainingReports.lastEnd,end-DAY);assert.equal(a.state.cashSol,cash);assert.equal(a.state.telegramOutbox,undefined);
 await rm(a.training.dir+'/fills');await a.training.tick(a,end+1000);assert.equal(a.training.error,null);assert.equal(a.state.trainingOutbox.length,0);assert.equal(a.state.telegramOutbox.length,1);
}));
