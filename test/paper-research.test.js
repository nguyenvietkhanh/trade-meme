import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {PaperResearch} from '../src/paper-research.js';
import {verifiedMarket} from './fixtures/verified-market.js';
import {SolanaExecution} from '../src/solana.js';
import {curveFixture} from './fixtures/curve-rpc.js';
const market=now=>verifiedMarket({venue:'pumpfun',dexId:'pumpfun',valuationSource:'curve-marketCap',pairCreatedAt:now-300000,change1mPct:2,volume1mUsd:5000,uniqueBuyers5m:30,historyComplete:true,activityCheckedAt:now,creatorSoldRecently:false,suspectedBundle:false,evidence:{probeSol:.05,curveVerified:true,curveComplete:false,roundTripProvider:'pumpfun'}},now);
async function setup(fn){const dir=await mkdtemp('/tmp/meme-paper-research-');try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
test('two paper wallets wait for execution delay, use different sizes, charge fees/rent and close from fresh quotes without signing',async t=>setup(async dir=>{
 let now=Date.now(),priceRatio=1,calls=0;t.mock.method(Date,'now',()=>now);const events=[];
 const paper=new PaperResearch(dir,async requests=>{calls++;return requests.map(r=>({id:r.id,mint:r.mint,side:r.side,amount:r.amount,checkedAt:now,contextSlot:100,outAmount:r.side==='BUY'?String(BigInt(r.amount)*100n):String(BigInt(r.amount)/100n*BigInt(Math.round(priceRatio*100))/100n),spotPriceSol:.01/150,roundTripLossPct:2,impactPct:1}));},{enqueue:r=>events.push(r)});
 const feed=()=>({solUsd:150,updatedAt:now,markets:[market(now)]});await paper.tick(feed());assert.equal(calls,0);assert.ok(paper.state.arms.every(a=>a.pending));
 now+=10000;await paper.tick(feed());assert.equal(calls,1);assert.ok(paper.state.arms.every(a=>a.ledger.positions.length===1));assert.ok(Math.abs(paper.state.arms[0].ledger.positions[0].initialCostSol-.053025)<1e-12);assert.ok(Math.abs(paper.state.arms[1].ledger.positions[0].initialCostSol-.023025)<1e-12);
 priceRatio=.5;now+=10000;await paper.tick(feed());assert.ok(paper.state.arms.every(a=>a.pending?.reason==='stop-loss'));
 now+=10000;await paper.tick(feed());assert.ok(paper.state.arms.every(a=>a.metrics.closed===1&&a.metrics.losses===1&&a.metrics.netPnl<0));assert.ok(paper.state.arms.every(a=>a.ledger.positions.length===0));assert.equal(paper.status().readyForLive,false);assert.equal(paper.status().minimumClosedPerArm,100);assert.ok(events.some(e=>e.type==='paper_fill'&&e.side==='SELL'));
 const restarted=new PaperResearch(dir,()=>{throw Error('no network');});await restarted.load();assert.deepEqual(restarted.state.arms.map(a=>a.metrics),paper.state.arms.map(a=>a.metrics));
}));
test('live execution takes precedence; stale/failed paper quotes never manufacture fills or completed trades',async t=>setup(async dir=>{
 let now=Date.now(),calls=0;t.mock.method(Date,'now',()=>now);const p=new PaperResearch(dir,async rs=>{calls++;return rs.map(r=>({...r,outAmount:'1000000',checkedAt:now-5001}));});const feed=()=>({solUsd:150,updatedAt:now,markets:[market(now)]});
 await p.tick(feed(),{liveBusy:true});assert.equal(calls,0);assert.ok(p.state.arms.every(a=>!a.pending));await p.tick(feed());now+=10000;await p.tick(feed());assert.equal(calls,1);assert.ok(p.state.arms.every(a=>a.ledger.positions.length===0&&a.metrics.closed===0&&a.gaps===1));
 now+=31000;await p.tick(feed());assert.ok(p.state.arms.every(a=>a.metrics.closed===0));
}));
test('paper drawdown locks entries without changing live limits, and corrupted research state never gets overwritten',async()=>setup(async dir=>{
 const p=new PaperResearch(dir,()=>{throw Error('must not quote');}),a=p.state.arms[0];a.ledger.cashSol=.84;p.markEquity(a,Date.now());assert.ok(a.ledger.halted);assert.equal(a.ledger.settings.maxDrawdownPct,15);assert.equal(a.ledger.settings.reserveSol,.05);
 await p.save();await writeFile(p.file,'broken');const reopened=new PaperResearch(dir,()=>{});await reopened.load();assert.equal(reopened.storageFailed,true);await reopened.tick({});assert.ok(reopened.error);
}));
test('SDK shadow quoting reads real curve state and has no transaction-building or broadcast dependency',async()=>{
 const f=await curveFixture(),e=new SolanaExecution();e.rpc=f.rpc;e.send=()=>{throw Error('never broadcast');};e.prepare=()=>{throw Error('never build');};
 const rs=[{id:'A',mint:f.mint.toBase58(),poolAddress:f.address.toBase58(),side:'BUY',amount:'50000000'},{id:'B',mint:f.mint.toBase58(),poolAddress:f.address.toBase58(),side:'BUY',amount:'20000000'}];const q=await e.paperCurveQuotes(rs);assert.ok(q.every(q=>!q.failed));assert.ok(BigInt(q[0].outAmount)>BigInt(q[1].outAmount));assert.equal(q[0].contextSlot,q[1].contextSlot);await assert.rejects(e.paperCurveQuotes([...rs,{...rs[0],id:'third'}]),/không hợp lệ/);
});
