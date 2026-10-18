import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankMarket} from '../src/strategy.js';
import {VerificationFeed} from '../src/verification.js';
import {diagnose,diagnoseOwnerEntry} from '../src/diagnostics.js';
import {createOwnerLedger,nextOwnerOrder} from '../src/owner-ledger.js';
import {verifiedMarket} from './fixtures/verified-market.js';
const now=Date.now();

test('missing optional Dex reserves reach RPC verification but cannot pass BUY until actual reserves are proven',()=>{
 const m=verifiedMarket({liquidityQuoteSol:null},now);
 assert.equal(rankMarket(m,undefined,now).roughEligible,true);assert.equal(rankMarket(m,undefined,now).eligible,false);
 const good={...m,evidence:{...m.evidence,quoteReserveSol:20}};
 assert.equal(rankMarket(good,undefined,now).eligible,true);
 for(const changes of [{quoteReserveSol:19.99},{checkedAt:now-30001},{mint:'wrong'},{pairAddress:'wrong'}])assert.equal(rankMarket({...good,evidence:{...good.evidence,...changes}},undefined,now).eligible,false);
 assert.equal(rankMarket({...good,liquidityQuoteSol:19},undefined,now).eligible,false,'known low reserves remain a veto');
});

test('a realistic normalized candidate without Dex quote reserves can complete verification and produce a BUY intent',async()=>{
 const m=verifiedMarket({mint:'11111111111111111111111111111112',liquidityQuoteSol:null},now),report={mint:m.mint,token:{mintAuthority:null,freezeAuthority:null},markets:[{pubkey:m.pairAddress,lp:{lpLockedPct:95}}],risks:[]};let inspections=0;
 const verification=new VerificationFeed(async url=>new Response(JSON.stringify(String(url).includes('rugcheck')?report:{})),{inspectMarket:async()=>{inspections++;return {...m.evidence,quoteReserveSol:30};}});
 const [verified]=await verification.enrich([{...m,evidence:undefined}],[],now);
 assert.equal(inspections,1);assert.equal(rankMarket(verified,undefined,now).eligible,true);
 const s=createOwnerLedger('owner',.3),feed={markets:[verified],solUsd:150,updatedAt:Date.now()};
 assert.equal(nextOwnerOrder(s,feed,.3).side,'BUY');assert.equal(s.positions.length,0,'an intent must not become a fabricated fill');
});

test('diagnostics report the first failing stage instead of counting unrequested safety evidence as a failure',()=>{
 const s=createOwnerLedger('owner',.3);s.running=true;
 const old=verifiedMarket({pairCreatedAt:now-172800000,evidence:{}},now);old.evidence={};
 const safe=verifiedMarket({},now),rankings=[old,safe].map(m=>({...m,...rankMarket(m,undefined,now)}));
 const d=diagnose(s,{markets:[old,safe],solUsd:150,updatedAt:now},rankings,now);
 assert.equal(d.stages.discovery,1);assert.equal(d.stages.ready,1);assert.equal(d.topBlockers.some(b=>b.reason.includes('authority')||b.reason.includes('kiểm chứng')),false);
 const awaiting=rankMarket({...safe,evidence:{}},undefined,now);assert.equal(awaiting.blockingStage,'safety');assert.ok(awaiting.primaryReasons.some(x=>x.includes('kiểm chứng')));
});

test('owner entry diagnosis distinguishes risk, RPC, pause, reserve and retry blocks without changing any state',()=>{
 const s=createOwnerLedger('owner',.3);s.running=true;const feed={markets:[verifiedMarket({},now)],solUsd:150,updatedAt:now};
 const initial=structuredClone(s);assert.equal(diagnoseOwnerEntry(s,feed,.3,now).phase,'ready');assert.deepEqual(s,initial);
 for(const [changes,balance,phase]of [[{buyPaused:true},.3,'buy-paused'],[{buyBlockedReason:'API unavailable'},.3,'execution-blocked'],[{halted:'daily limit'},.3,'risk-halt'],[{},NaN,'rpc-unavailable'],[{cashSol:.05},.3,'reserve'],[{lossPauseUntil:now+1000},.3,'loss-pause'],[{orderAttempts:{'BUY:test-mint:fixed':4}},.3,'retry-limit']])assert.equal(diagnoseOwnerEntry({...s,...changes},feed,balance,now).phase,phase);
});
