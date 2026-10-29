import test from 'node:test';import assert from 'node:assert/strict';import {RulesQuoteBroker,quoteLadder,quoteFailure} from '../src/rules-quotes.js';import {rulesConfig} from '../src/rules-config.js';
const at=1900000000000,p=rulesConfig({QUOTE_BACKOFF_MS:'0'}),m={mint:'mint',pairAddress:'pool',dexId:'pumpswap'},q=size=>({roundTripQuoteOk:true,probeSol:size,roundTripLossPct:3,buyImpactPct:.5,sellImpactPct:.5,quoteCheckedAt:at});
test('quote ladder picks largest size satisfying loss/impact and only caches identical size reads',async()=>{
 const calls=[],b=new RulesQuoteBroker({roundTripQuote:async(_m,a)=>{const size=Number(a)/1e9;calls.push(size);return {...q(size),roundTripLossPct:size>.025?8:3};}},{clock:()=>at,policy:p,marketSnapshot:()=>({markets:[m]})});
 assert.deepEqual(quoteLadder(.1,.0025),[.1,.05,.025,.0025]);const r=await b.select({mint:'mint',pool:'pool'},{size:.1});assert.equal(r.ok,true);assert.equal(r.size,.025);assert.deepEqual(calls,[.1,.05,.025]);await b.select({mint:'mint',pool:'pool'},{size:.025});assert.equal(calls.length,3);assert.ok(r.attempts.every(a=>'quote_age_ms'in a&&'source'in a));
});
test('429 reads retry at most three per size, carry specific diagnostics and never invoke send',async()=>{
 let calls=0;const b=new RulesQuoteBroker({roundTripQuote:async()=>{calls++;throw Object.assign(Error('HTTP 429'),{status:429});},send:()=>{throw Error('NO_SEND');}},{clock:()=>at,policy:p,wait:async()=>{},marketSnapshot:()=>({markets:[m]})});const r=await b.select({mint:'mint',pool:'pool'},{size:.0025});assert.equal(r.ok,false);assert.equal(calls,3);assert.equal(r.reason,'rate_limited');assert.equal(r.attempts[0].httpStatus,429);
 assert.equal(quoteFailure(null,{...q(.01),quoteCheckedAt:at-5001},.01,at,p),'stale');assert.equal(quoteFailure(Error('no route'),null,.01,at,p),'no_route');
});
test('read quote concurrency is bounded even while queued calls hand off their slot',async()=>{
 let active=0,peak=0;const b=new RulesQuoteBroker({roundTripQuote:async(_m,amount)=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,2));active--;return q(Number(amount)/1e9);}},{policy:p,clock:()=>at,marketSnapshot:()=>({markets:[m]})});await Promise.all(Array.from({length:8},(_,i)=>b.select({mint:'mint',pool:'pool'},{size:.01+i*.0001})));assert.equal(peak,1);assert.equal(b.active,0);
});
