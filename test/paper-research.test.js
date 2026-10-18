import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {PaperResearch} from '../src/paper-research.js';
import {verifiedMarket} from './fixtures/verified-market.js';
import {SolanaExecution} from '../src/solana.js';
import {curveFixture} from './fixtures/curve-rpc.js';
const market=now=>verifiedMarket({venue:'pumpfun',dexId:'pumpfun',valuationSource:'curve-marketCap',pairCreatedAt:now-300000,change1mPct:2,volume1mUsd:5000,uniqueBuyers5m:30,historyComplete:true,activityCheckedAt:now,creatorSoldRecently:false,suspectedBundle:false,evidence:{probeSol:.05,curveVerified:true,curveComplete:false,roundTripProvider:'pumpfun'}},now);
async function setup(fn){const dir=await mkdtemp('/tmp/meme-paper-research-');try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
test('retired curve paper study cannot generate new quotes or fills, and keeps its persisted history',async()=>setup(async dir=>{
 let calls=0;const paper=new PaperResearch(dir,async()=>{calls++;throw Error('must never quote');});
 paper.state.arms[0].metrics={closed:1,wins:1,losses:0,grossProfit:.1,grossLoss:0,netPnl:.1};await paper.save();
 const before=JSON.stringify(paper.state);await paper.tick({updatedAt:Date.now(),solUsd:150,markets:[market(Date.now())]});
 assert.equal(calls,0);assert.equal(JSON.stringify(paper.state),before);assert.equal(paper.status().mode,'archived');assert.equal(paper.status().disabled,true);assert.equal(paper.status().readyForLive,false);
 const restarted=new PaperResearch(dir,null);await restarted.load();assert.equal(restarted.state.arms[0].metrics.closed,1);
}));
test('paper drawdown locks entries without changing live limits, and corrupted research state never gets overwritten',async()=>setup(async dir=>{
 const p=new PaperResearch(dir,()=>{throw Error('must not quote');}),a=p.state.arms[0];a.ledger.cashSol=.84;p.markEquity(a,Date.now());assert.ok(a.ledger.halted);assert.equal(a.ledger.settings.maxDrawdownPct,15);assert.equal(a.ledger.settings.reserveSol,.05);
 await p.save();await writeFile(p.file,'broken');const reopened=new PaperResearch(dir,()=>{});await reopened.load();assert.equal(reopened.storageFailed,true);await reopened.tick({});assert.ok(reopened.error);
}));
test('SDK shadow quoting reads real curve state and has no transaction-building or broadcast dependency',async()=>{
 const f=await curveFixture(),e=new SolanaExecution();e.rpc=f.rpc;e.send=()=>{throw Error('never broadcast');};e.prepare=()=>{throw Error('never build');};
 const rs=[{id:'A',mint:f.mint.toBase58(),poolAddress:f.address.toBase58(),side:'BUY',amount:'50000000'},{id:'B',mint:f.mint.toBase58(),poolAddress:f.address.toBase58(),side:'BUY',amount:'20000000'}];const q=await e.paperCurveQuotes(rs);assert.ok(q.every(q=>!q.failed));assert.ok(BigInt(q[0].outAmount)>BigInt(q[1].outAmount));assert.equal(q[0].contextSlot,q[1].contextSlot);await assert.rejects(e.paperCurveQuotes([...rs,{...rs[0],id:'third'}]),/không hợp lệ/);
});
