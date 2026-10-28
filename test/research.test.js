import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,stat,mkdir,symlink,readdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {ResearchJournal} from '../src/research-journal.js';
import {verifiedMarket} from './fixtures/verified-market.js';
import {freshState} from '../src/engine.js';
import {recordEvaluation} from '../src/scanner.js';
async function temp(fn){const dir=await mkdtemp('/tmp/meme-research-');try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
test('compressed decision journal survives the 10000 UI reset and restart; missing evidence stays null and secrets are excluded',async()=>temp(async dir=>{
 const journal=new ResearchJournal(dir,{scanIntervalMs:0}),m=verifiedMarket({privateKey:'DO_NOT_SAVE',apiKey:'DO_NOT_SAVE',evidence:{freezeRevoked:undefined}}),feed={markets:[m],updatedAt:Date.now(),solUsd:100};journal.scan(feed);
 journal.execution('error',{side:'BUY',mint:m.mint,id:'attempt',transaction:'DO_NOT_SAVE',privateKey:'DO_NOT_SAVE'},{error:Error('HTTP 429 https://secret/?api-key=DO_NOT_SAVE')});
 await journal.flush();const state=freshState();state.decisionStats.evaluated=9999;recordEvaluation(state,{at:Date.now(),action:'SKIP',mint:m.mint});assert.equal(state.decisions.length,0);
 journal.scan(feed);await journal.flush();const restarted=new ResearchJournal(dir),files=await restarted.files();assert.equal(files.length,1);
 const doc=await restarted.document(files[0]),lines=gunzipSync(doc).toString();assert.ok(!lines.includes('DO_NOT_SAVE'));const rows=lines.trim().split('\n').map(JSON.parse);assert.equal(rows.filter(r=>r.type==='scan').length,2);assert.equal(rows[1].rows[0].features.safety.freezeRevoked,null);assert.equal(rows[2].errorCode,'HTTP_429');assert.equal(new Set(rows.map(r=>r.eventId)).size,rows.length);
 assert.equal((await stat(journal.dir+'/'+files[0])).mode&0o777,0o600);await assert.rejects(journal.document('../../owner-signer.json'),/không hợp lệ/);
}));
test('research disk failure preserves buffered rows, reports the gap risk and does not mutate a trading ledger',async()=>temp(async dir=>{
 await writeFile(dir+'/research','not a directory');const journal=new ResearchJournal(dir);journal.scan({markets:[],solUsd:100,updatedAt:Date.now()});const before=journal.rows.length;await journal.flush();assert.equal(journal.rows.length,before);assert.ok(journal.error);assert.equal(journal.status().writtenThisProcess,0);
 const oversized='x'.repeat(3*1024*1024);assert.equal(journal.enqueue({type:'oversize',value:oversized}),false);assert.equal(journal.status().droppedThisProcess,1);
}));

test('research retention removes oldest and oversized archives, preserving live financial data and symlink targets',async()=>temp(async dir=>{
 const now=Date.parse('2026-10-28T12:30:00Z'),journal=new ResearchJournal(dir,{maxBytes:100,maxAgeMs:3*86400000,minFreeBytes:0,clock:()=>now});
 const root=journal.dir,old=root+'/2026-10-20',recent=root+'/2026-10-28';await mkdir(old,{recursive:true});await mkdir(recent,{recursive:true});
 const oldFile=old+'/10-aaaaaaaaaaaaaaaa.jsonl.gz',older=recent+'/10-bbbbbbbbbbbbbbbb.jsonl.gz',newer=recent+'/12-cccccccccccccccc.jsonl.gz';
 await writeFile(oldFile,Buffer.alloc(80));await writeFile(older,Buffer.alloc(80));await writeFile(newer,Buffer.alloc(80));
 await writeFile(dir+'/ledger.json','financial-ledger');await writeFile(recent+'/unrecognized.json','keep');
 await symlink(dir+'/ledger.json',recent+'/11-dddddddddddddddd.jsonl.gz');await symlink(dir,root+'/2026-10-19');
 await journal.maintain();assert.equal(journal.archiveBytes,80);assert.equal(journal.prunedFiles,2);assert.equal(await readFile(dir+'/ledger.json','utf8'),'financial-ledger');assert.equal(await readFile(recent+'/unrecognized.json','utf8'),'keep');assert.equal((await stat(newer)).size,80);await assert.rejects(stat(oldFile),{code:'ENOENT'});await assert.rejects(stat(older),{code:'ENOENT'});
}));
test('research pruning frees reserve pressure without deleting financial records when no disposable files remain',async()=>temp(async dir=>{
 const journal=new ResearchJournal(dir,{minFreeBytes:Number.MAX_SAFE_INTEGER});await writeFile(dir+'/ledger.json','keep');
 await journal.flush();assert.ok(journal.error);assert.equal(journal.written,0);assert.ok(journal.rows.length);assert.equal(await readFile(dir+'/ledger.json','utf8'),'keep');
}));
test('snapshot and scan sampling does not throttle execution research or trading state',async()=>temp(async dir=>{
 let now=Date.now();const journal=new ResearchJournal(dir,{clock:()=>now,minFreeBytes:0});
 assert.equal(journal.enqueue({type:'paper_replay_snapshot',snapshot:{id:1}}),true);assert.equal(journal.enqueue({type:'paper_replay_snapshot',snapshot:{id:2}}),false);
 assert.equal(journal.scan({markets:[],updatedAt:now,solUsd:100}),true);assert.equal(journal.scan({markets:[],updatedAt:now,solUsd:100}),false);
 assert.equal(journal.execution('confirmed',{id:'receipt',side:'SELL'}),true);now+=30000;assert.equal(journal.enqueue({type:'paper_replay_snapshot',snapshot:{id:3}}),true);
 await journal.flush();assert.equal(journal.status().retention.sampledOutThisProcess,2);assert.equal(journal.error,null);
}));
test('research maintenance refuses symlinked research roots',async()=>temp(async dir=>{
 await mkdir(dir+'/outside/journal',{recursive:true});await writeFile(dir+'/outside/journal/protected','keep');await symlink(dir+'/outside',dir+'/research');
 const journal=new ResearchJournal(dir);await journal.maintain();assert.ok(journal.error);assert.equal(await readFile(dir+'/outside/journal/protected','utf8'),'keep');
}));

test('hourly research rotation recreates a pruned active directory and remains within its byte limit',async()=>temp(async dir=>{
 const journal=new ResearchJournal(dir,{maxBytes:600,minFreeBytes:0});await journal.flush();assert.equal(journal.error,null);
 for(let i=0;i<8;i++){journal.enqueue({type:'execution',index:i,padding:'record '+i+' '.repeat(100)});await journal.flush();assert.equal(journal.error,null);assert.ok(journal.archiveBytes<=600);}
 assert.ok(journal.prunedFiles>0);const files=await journal.files();assert.equal(files.length,1);assert.ok(gunzipSync(await readFile(journal.dir+'/'+files[0])).length>0);
}));
