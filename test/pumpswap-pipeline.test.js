import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VerificationFeed} from '../src/verification.js';
import {rankMarket} from '../src/strategy.js';
import {verifiedMarket} from './fixtures/verified-market.js';
import {recordEvaluation} from '../src/scanner.js';
import {jupiterRoundTrip,jupiterEntryQuote,jupiterSellQuote} from '../src/sell-quote.js';
import {SOL} from '../src/engine.js';
import {quoteScheduler} from '../src/quote-queue.js';
import {withRpcPriority} from '../src/rpc-priority.js';
const mint='11111111111111111111111111111112';
const report=m=>({mint:m.mint,token:{mintAuthority:null,freezeAuthority:null},markets:[{pubkey:m.pairAddress,lp:{lpLockedPct:95}}],risks:[]});
const fetchReport=m=>async url=>new Response(JSON.stringify(String(url).includes('rugcheck')?report(m):{}));

test('cheap cap/trend/activity failures and disabled curves never call safety providers or quote',async()=>{
 const now=Date.now(),m=verifiedMarket({mint},now);let calls=0;
 const feed=new VerificationFeed(async()=>{calls++;throw Error('must not call');},{inspectMarketFacts:async()=>{calls++;},inspectMarketQuote:async()=>{calls++;}});
 for(const change of [{valuationUsd:2999},{change1hPct:0},{buys5m:0},{dexId:'pumpfun',venue:'pumpfun'},{updatedAt:now-30001}]){const [row]=await feed.enrich([{...m,...change}],[],now);assert.equal(row.evidence,m.evidence);}
 assert.equal(calls,0);assert.equal(feed.cache.size,0);
});
test('unsafe distribution, low reserves, LP, program and critical warnings prevent all Jupiter quotes',async()=>{
 for(const change of [{top10Pct:36},{largestHolderPct:9},{quoteReserveSol:19},{devPct:6},{tokenProgram:'unknown'}]){
  const now=Date.now(),m=verifiedMarket({mint},now);let quotes=0;
  const feed=new VerificationFeed(fetchReport(m),{inspectMarketFacts:async()=>({...m.evidence,quoteReserveSol:30,...change}),inspectMarketQuote:async()=>{quotes++;return m.evidence;}});
  const [row]=await feed.enrich([{...m,evidence:undefined}],[],now);assert.equal(quotes,0,JSON.stringify(change));assert.equal(rankMarket(row,undefined,now).eligible,false);
 }
 for(const patch of [{risks:[{name:'critical',level:'danger'}]},{markets:[]}]){
  const now=Date.now(),m=verifiedMarket({mint},now);let calls=0;
  const feed=new VerificationFeed(async()=>new Response(JSON.stringify({...report(m),...patch})),{inspectMarketFacts:async()=>{calls++;},inspectMarketQuote:async()=>{calls++;}});
  await feed.enrich([{...m,evidence:undefined}],[],now);assert.equal(calls,0);
 }
});
test('quote retries reuse recent report/holder facts without restamping them; mutable caches expire at 20 seconds',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);const original=now,m=verifiedMarket({mint,liquidityQuoteSol:null},now);let reports=0,facts=0,quotes=0;
 const feed=new VerificationFeed(async url=>{if(String(url).includes('rugcheck')){reports++;return new Response(JSON.stringify(report(m)));}return new Response('{}');},{inspectMarketFacts:async()=>{facts++;return {...m.evidence,quoteReserveSol:30};},inspectMarketQuote:async()=>{quotes++;if(quotes===1)throw Error('Jupiter HTTP 429');return {...m.evidence,quoteCheckedAt:now};}});
 const first=(await feed.enrich([{...m,evidence:undefined}],[],now))[0];assert.match(first.verificationError,/HTTP 429/);
 now+=5000;const second=(await feed.enrich([{...m,evidence:undefined,updatedAt:now}],[],now))[0];assert.equal(reports,1);assert.equal(facts,1);assert.equal(quotes,2);assert.equal(second.evidence.checkedAt,original);assert.equal(second.evidence.rugFetchedAt,original);assert.equal(second.evidence.quoteCheckedAt,now);assert.equal(second.verificationError,undefined);
 now+=20001;await feed.enrich([{...m,evidence:undefined,updatedAt:now}],[],now);assert.equal(reports,2);assert.equal(facts,2);
 assert.equal(rankMarket({...second,updatedAt:now+6000},undefined,now+6000).eligible,false);
});
test('diagnostics separate missing cap/safety from failed limits, and score never overrides gates',()=>{
 const now=Date.now(),m=verifiedMarket({},now);
 const missing=rankMarket({...m,valuationUsd:null},undefined,now),low=rankMarket({...m,valuationUsd:2999},undefined,now),high=rankMarket({...m,valuationUsd:6000000},undefined,now);
 assert.equal(missing.blockingCategory,'missing-data');assert.ok(missing.primaryFlags.includes('MISSING_MARKET_CAP'));assert.equal(low.blockingCategory,'rule-failed');assert.ok(low.primaryFlags.includes('MARKET_CAP_TOO_LOW'));assert.ok(high.primaryFlags.includes('MARKET_CAP_TOO_HIGH'));
 const unknown=rankMarket({...m,evidence:{}},undefined,now),unsafe=rankMarket({...m,evidence:{...m.evidence,top10Pct:36}},undefined,now);assert.ok(unknown.missingData.includes('HOLDER_CONCENTRATION'));assert.ok(unsafe.failedChecks.includes('HOLDER_CONCENTRATION'));assert.equal(unsafe.eligible,false);assert.equal(unsafe.minScore,60);
 assert.equal(rankMarket({...m,change1hPct:0},undefined,now).eligible,false,'H1 flat remains an unvalidated hypothesis');
 assert.equal(rankMarket({...m,evidence:{...m.evidence,quoteCheckedAt:now-30001}},undefined,now).eligible,false);
});
test('repeated SKIP display rows are suppressed for 30 seconds, counters advance and changed reasons show immediately',()=>{
 const s={},at=Date.now(),row={at,mint,action:'SKIP',blockingStage:'market',score:70,reason:'M5/H1'};
 recordEvaluation(s,{...row});recordEvaluation(s,{...row,at:at+5000});assert.equal(s.decisions.length,1);assert.equal(s.decisions[0].repeats,2);assert.equal(s.decisionStats.evaluated,2);
 recordEvaluation(s,{...row,at:at+10000,reason:'low liquidity'});assert.equal(s.decisions.length,2);
 recordEvaluation(s,{...row,at:at+15000,action:'WATCH',reason:'all gates pass'});assert.equal(s.decisions[0].action,'WATCH');
 recordEvaluation(s,{...row,at:at+20000});recordEvaluation(s,{...row,at:at+50001});assert.equal(s.decisions.length,5);assert.equal(s.decisionStats.totalEvaluated,6);
});
function response(url){const u=new URL(url),input=u.searchParams.get('inputMint'),amount=u.searchParams.get('amount'),bps=Number(u.searchParams.get('slippageBps')),out=input===SOL?'1000000':'195000000';return new Response(JSON.stringify({inputMint:input,outputMint:u.searchParams.get('outputMint'),inAmount:amount,outAmount:out,otherAmountThreshold:(BigInt(out)*BigInt(10000-bps)/10000n).toString(),slippageBps:bps,swapMode:'ExactIn',contextSlot:100,routePlan:[{}],priceImpactPct:'0.01'}));}
test('exact-size Jupiter reads coalesce/cache for 2 seconds with original timestamps; changed sizes and errors are never reused',async t=>{
 let now=Date.now(),calls=0;t.mock.method(Date,'now',()=>now);const start=now,fetcher=async url=>{calls++;return response(url);};
 const [a,b]=await Promise.all([jupiterRoundTrip(mint,fetcher,.2),jupiterRoundTrip(mint,fetcher,.2)]);assert.equal(calls,2);assert.equal(a.quoteCheckedAt,b.quoteCheckedAt);
 now+=1000;const entry=await jupiterEntryQuote(mint,'200000000',fetcher);assert.equal(calls,2);assert.equal(entry.checkedAt,start);
 await jupiterEntryQuote(mint,'190000000',fetcher);assert.equal(calls,3);
 now+=1001;await jupiterEntryQuote(mint,'200000000',fetcher);assert.equal(calls,4);
 let badCalls=0;const bad=async()=>{badCalls++;return new Response('{}',{status:429});};await assert.rejects(jupiterSellQuote({mint,rawAmount:'1'},bad),/429/);await assert.rejects(jupiterSellQuote({mint,rawAmount:'1'},bad),/429/);assert.equal(badCalls,2);
});
test('Jupiter read queue is serial, prioritizes SELL ahead of queued BUY, and expires queue waits',async()=>{
 const schedule=quoteScheduler({intervalMs:2,queueTimeoutMs:100}),order=[];let release,active=0,max=0;const gate=new Promise(r=>release=r);
 const first=withRpcPriority('background',()=>schedule(async()=>{active++;max=Math.max(max,active);await gate;order.push('first');active--;}));
 const buy=withRpcPriority('background',()=>schedule(async()=>{active++;max=Math.max(max,active);order.push('buy');active--;}));
 const sell=withRpcPriority('exit',()=>schedule(async()=>{active++;max=Math.max(max,active);order.push('sell');active--;}));release();await Promise.all([first,buy,sell]);assert.deepEqual(order,['first','sell','buy']);assert.equal(max,1);
 const blocked=quoteScheduler({intervalMs:1,queueTimeoutMs:10});let done;const waiting=blocked(()=>new Promise(r=>done=r));await assert.rejects(blocked(()=>assert.fail('expired read must not execute')),/chờ hạn mức/);done();await waiting;
});
