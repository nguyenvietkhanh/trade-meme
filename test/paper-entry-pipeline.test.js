import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {VerificationFeed} from '../src/verification.js';
import {PaperDesk} from '../src/paper-desk.js';
import {rankPaperMarket,observePaperEligibility} from '../src/paper-policy.js';
import {verifiedMarket} from './fixtures/verified-market.js';

test('a background proof reaches the paper engine before the next market scan, without restamping prices or making provider calls on cache reads',async t=>{
 let at=Date.now();const start=at,mint='11111111111111111111111111111112';t.mock.method(Date,'now',()=>at);
 const dir=await mkdtemp(path.join(tmpdir(),'paper-proof-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const counters={reports:0,facts:0,roundtrip:0,execution:0};let release,started;const ready=new Promise(r=>started=r),wait=new Promise(r=>release=r);
 const market=()=>verifiedMarket({mint,change5mPct:27,scalpConfirmed:undefined,priceUsd:.01+(at-start)/1e8,buys5m:40+Math.floor((at-start)/1000),evidence:undefined},at);
 const verification=new VerificationFeed(async url=>{if(!String(url).includes('rugcheck'))return new Response('{}');counters.reports++;return new Response(JSON.stringify({mint,token:{mintAuthority:null,freezeAuthority:null},markets:[{pubkey:'test-pool',lp:{lpLockedPct:95}}],risks:[]}));},{inspectMarketFacts:async()=>{counters.facts++;return {decimals:6,mintRevoked:true,freezeRevoked:true,tokenProgram:'spl-token',quoteReserveSol:100,top10ExcludesPool:true,top10Pct:20,largestHolderPct:3,devPct:2};},inspectMarketQuote:async()=>{counters.roundtrip++;started();await wait;return {roundTripQuoteOk:true,probeSol:.5,roundTripLossPct:3,buyImpactPct:1,sellImpactPct:1,quoteCheckedAt:at};}},{rankMarket:rankPaperMarket,ignoreH4:true,cacheMs:10000});
 let sellSol=.5;
 const desk=new PaperDesk(dir,{quote:async input=>{counters.execution++;const outAmount=input.side==='BUY'?'9000000000':String(Math.round(sellSol*1e9));return {...input,inAmount:input.amount,outAmount,minOut:outAmount,checkedAt:at,contextSlot:100,impactPct:1};}},{clock:()=>at});await desk.load();
 let rows=await verification.enrichCached([market()],[],at);rows=observePaperEligibility(desk.state,rows,at);await ready;
 at+=4990;rows=observePaperEligibility(desk.state,[market()],at);assert.equal(rows[0].scalpConfirmed,false);
 at+=4990;rows=observePaperEligibility(desk.state,[market()],at);assert.equal(rows[0].scalpConfirmed,true);const feed={markets:rows,updatedAt:at,solUsd:150,error:null},original=structuredClone(feed);
 at+=1000;release();await Promise.all([...verification.jobs.values()]);
 await desk.step(feed);assert.equal(desk.state.pending,null,'the old frozen market snapshot has no completed proof');
 const countsBefore={...counters},proof=verification.applyCached(feed.markets);
 assert.deepEqual(counters,countsBefore);assert.deepEqual(feed,original);assert.equal(proof[0].updatedAt,feed.markets[0].updatedAt);assert.equal(proof[0].evidence.quoteCheckedAt,at);assert.equal(proof[0].evidence.checkedAt,start);assert.equal(rankPaperMarket(proof[0],undefined,at).eligible,true);const recovered=verification.applyCached([{...feed.markets[0],verificationError:'HTTP 429 from previous scan'}])[0];assert.equal(recovered.verificationError,null);assert.equal(rankPaperMarket(recovered,undefined,at).eligible,true);
 await desk.step({...feed,markets:proof});assert.equal(desk.state.pending.side,'BUY');assert.equal(desk.state.positions.length,0);
 at+=2100;await desk.step({...feed,markets:verification.applyCached(feed.markets)});assert.equal(desk.state.positions.length,1);assert.equal(desk.state.trades[0].side,'BUY');assert.equal(desk.state.trades[0].mode,'paper');
 sellSol=.40;at+=2000;await desk.step({...feed,markets:verification.applyCached(feed.markets)});assert.equal(desk.state.pending.reason,'stop-loss');at+=2100;await desk.step({...feed,markets:verification.applyCached(feed.markets)});assert.equal(desk.state.positions.length,0);assert.equal(desk.state.trades[0].side,'SELL');assert.ok(desk.state.realizedNetSol<0);assert.equal(counters.reports,1);assert.equal(counters.facts,1);assert.equal(counters.roundtrip,1);
 // Completion metadata is never a license to refresh the observation timestamps.
 at+=31000;assert.equal(rankPaperMarket(verification.applyCached(feed.markets)[0],undefined,at).eligible,false);
});
