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
 let calls=0;const feed=new VerificationFeed(async()=>{calls++;return new Response('blocked',{status:403});});
 const result=await feed.enrich([{...m,evidence:undefined}],[],now);assert.equal(result[0].evidence,undefined);assert.ok(result[0].verificationError);assert.equal(result[0].priceUsd,m.priceUsd);
 await feed.enrich([m],[],now+1000);assert.equal(calls,1);
 await feed.enrich([{...m,updatedAt:now+30001}],[],now+30001);assert.equal(calls,2);
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
