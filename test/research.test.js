import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,stat} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {ResearchJournal} from '../src/research-journal.js';
import {verifiedMarket} from './fixtures/verified-market.js';
import {freshState} from '../src/engine.js';
import {recordEvaluation} from '../src/scanner.js';
async function temp(fn){const dir=await mkdtemp('/tmp/meme-research-');try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
test('compressed decision journal survives the 10000 UI reset and restart; missing evidence stays null and secrets are excluded',async()=>temp(async dir=>{
 const journal=new ResearchJournal(dir),m=verifiedMarket({privateKey:'DO_NOT_SAVE',apiKey:'DO_NOT_SAVE',evidence:{freezeRevoked:undefined}}),feed={markets:[m],updatedAt:Date.now(),solUsd:100};journal.scan(feed);
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
