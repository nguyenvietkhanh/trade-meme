import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rugEvidence,VerificationFeed} from '../src/verification.js';
import {rankMarket} from '../src/strategy.js';
import {verifiedMarket} from './fixtures/verified-market.js';
const now=Date.now(),mint='11111111111111111111111111111112',m=verifiedMarket({mint},now);
const report={mint,token:{mintAuthority:null,freezeAuthority:null},markets:[{pubkey:m.pairAddress,lp:{lpLockedPct:95,lpBurnedPct:95}}],risks:[],topHolders:[{pct:1}],score:0};
test('RugCheck identity and pool binding are required; overlapping LP figures are never summed',()=>{
 assert.throws(()=>rugEvidence({...report,mint:'wrong'},m,now));
 const e=rugEvidence(report,m,now);assert.equal(e.lpSecuredPct,95);assert.equal(e.mintRevoked,true);assert.equal(e.riskWarningsChecked,true);
 for(const field of ['top10Pct','devPct','sellSimulationOk','uniqueBuyers5m','bundleChecked'])assert.equal(e[field],undefined);
 assert.equal(rankMarket({...m,evidence:e},undefined,now).eligible,false,'a perfect report score is not complete evidence');
 assert.equal(rugEvidence({...report,markets:[{pubkey:'wrong',lp:{lpLockedPct:100}}]},m,now).lpSecuredPct,undefined);
 assert.equal(rugEvidence({...report,token:{},risks:[{name:'unknown',level:'new-schema'}]},m,now).mintRevoked,undefined);
});
test('report failures stay unknown, are cached briefly, and cannot prevent marks/exits from updating',async()=>{
 let calls=0,time=now;const feed=new VerificationFeed(async()=>{calls++;return new Response('blocked',{status:403});},null,{clock:()=>time,random:()=>0});
 const result=await feed.enrich([{...m,evidence:undefined}],[],now);assert.equal(result[0].evidence,undefined);assert.ok(result[0].verificationError);assert.equal(result[0].priceUsd,m.priceUsd);
 await feed.enrich([m],[],now+1000);assert.equal(calls,1);
 time=now+30001;await feed.enrich([{...m,updatedAt:time}],[],time);assert.equal(calls,2);
});
test('bounded verification only contacts the fixed public RugCheck endpoint, never Helius/Jupiter',async()=>{
 const urls=[];const feed=new VerificationFeed(async url=>{urls.push(url);return new Response(JSON.stringify(report));});
 const result=await feed.enrich([{...m,evidence:undefined}],[],now);
 assert.equal(urls.length,1);assert.equal(urls[0],'https://api.rugcheck.xyz/v1/tokens/'+mint+'/report');assert.equal(result[0].evidence.lpSecuredPct,95);
});
test('slow safety jobs do not hold up fresh market snapshots and concurrency is capped at two',async()=>{
 let release;const ready=new Promise(r=>release=r);let started=0;const feed=new VerificationFeed(async()=>{started++;await ready;return new Response(JSON.stringify(report));});
 const first=await feed.enrichCached([m,{...m,mint:'11111111111111111111111111111113'},{...m,mint:'11111111111111111111111111111114'}],[],now);assert.equal(first.length,3);assert.equal(started,2);assert.equal(feed.jobs.size,2);
 release();await Promise.all([...feed.jobs.values()]);assert.equal(feed.jobs.size,0);
 const cached=await feed.enrichCached([m],[],now+1);assert.equal(cached[0].evidence.lpSecuredPct,95);
});

test('failed safety providers retry after five seconds, expose status without URLs, and never bypass safety',async()=>{
 let calls=0,time=now;
 const feed=new VerificationFeed(async()=>{calls++;if(calls===1)throw Error('HTTP 403 https://private.invalid/?api-key=never-display');return new Response(JSON.stringify(report));},null,{clock:()=>time,random:()=>0});
 const first=(await feed.enrich([{...m,evidence:undefined,coarseCooldownUntil:now+1800000}],[],now))[0];
 assert.match(first.verificationError,/RugCheck: HTTP 403/);assert.ok(!first.verificationError.includes('never-display'));
 assert.equal(rankMarket(first,undefined,now).roughEligible,true);assert.equal(rankMarket(first,undefined,now).eligible,false);
 assert.ok(rankMarket(first,undefined,now).reasons.includes(first.verificationError));
 await feed.enrich([m],[],now+4999);assert.equal(calls,1);
 time=now+5000;const recovered=(await feed.enrich([{...m,evidence:undefined,updatedAt:time}],[],time))[0];assert.equal(calls,2);assert.equal(recovered.verificationError,undefined);
 assert.equal(rankMarket(recovered,undefined,now+5000).eligible,false,'a recovered partial report still needs on-chain and round-trip verification');
});

test('repeated failures on two high-volume tokens cannot starve other eligible candidates',async()=>{
 let time=now;const called=[],markets=Array.from({length:4},(_,i)=>({...m,mint:'1111111111111111111111111111111'+(i+2),volume5mUsd:10000-i}));
 const feed=new VerificationFeed(async url=>{called.push(String(url).split('/').at(-2));return new Response('unavailable',{status:503});},null,{clock:()=>time,random:()=>0});
 await feed.enrichCached(markets,[],now);await Promise.all([...feed.jobs.values()]);
 time=feed.reportFetch.diagnostics().retryAt;await feed.enrichCached(markets,[],time);await Promise.all([...feed.jobs.values()]);
 assert.deepEqual(called,markets.map(m=>m.mint));
});

test('safety verification accepts rough-qualified young, old and undated pools without the hidden age gate',async()=>{
 const markets=[now-1000,now-365*86400000,undefined].map((pairCreatedAt,i)=>verifiedMarket({mint:'1111111111111111111111111111111'+(i+2),pairCreatedAt},now)),inspected=[];
 const feed=new VerificationFeed(async url=>{
  const token=String(url).split('/').at(-2);
  return new Response(JSON.stringify(String(url).includes('rugcheck')?{...report,mint:token}:{}));
 },{inspectMarket:async market=>{inspected.push(market.mint);return markets.find(m=>m.mint===market.mint).evidence;}});
 const result=await feed.enrich(markets.map(m=>({...m,evidence:undefined})),[],now);
 assert.deepEqual(new Set(inspected),new Set(markets.map(m=>m.mint)));
 for(const m of result)assert.equal(rankMarket(m,undefined,now).eligible,true);
});

test('more than six tracked holdings cannot hide a new candidate from safety verification',async()=>{
 const held=Array.from({length:8},(_,i)=>verifiedMarket({mint:'1111111111111111111111111111111'+(i+2)},now)),candidate=verifiedMarket({mint:'1111111111111111111111111111111A'},now),called=[];
 const feed=new VerificationFeed(async url=>{called.push(String(url).split('/').at(-2));return new Response('unavailable',{status:503});});
 for(const m of held)feed.cache.set(m.mint+':'+m.pairAddress,{at:now-1000,value:{evidence:m.evidence}});
 await feed.enrichCached([...held,candidate],held.map(m=>m.mint),now);await Promise.all([...feed.jobs.values()]);
 assert.deepEqual(called,[candidate.mint]);assert.equal(feed.jobs.size,0);
});
test('paper refreshes expired quotes after 10 seconds while keeping report and facts cached for 20 seconds',async t=>{
 const {rankPaperMarket}=await import('../src/paper-policy.js');let time=now,reports=0,facts=0,quotes=0;t.mock.method(Date,'now',()=>time);
 const current=()=>verifiedMarket({mint,change5mPct:27,scalpConfirmed:true},time);
 const execution={inspectMarketFacts:async()=>{facts++;const {roundTripQuoteOk,roundTripLossPct,probeSol,buyImpactPct,sellImpactPct,quoteCheckedAt,...rest}=current().evidence;return rest;},inspectMarketQuote:async()=>{quotes++;return {roundTripQuoteOk:true,roundTripLossPct:3,probeSol:.6,buyImpactPct:1,sellImpactPct:1,quoteCheckedAt:time};}};
 const feed=new VerificationFeed(async url=>{if(String(url).includes('api.rugcheck.xyz'))reports++;return new Response(JSON.stringify(report));},execution,{rankMarket:rankPaperMarket,ignoreH4:true,cacheMs:10000});
 await feed.enrich([current()],[],time);assert.equal(quotes,1);assert.equal(reports,1);assert.equal(facts,1);
 time=now+9000;await feed.enrich([current()],[],time);assert.equal(quotes,1);
 time=now+11000;await feed.enrich([current()],[],time);assert.equal(quotes,2);assert.equal(reports,1);assert.equal(facts,1);
});
