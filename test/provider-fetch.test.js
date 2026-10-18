import {test} from 'node:test';
import assert from 'node:assert/strict';
import {backoffFetch,retryAfterMs} from '../src/provider-fetch.js';

test('concurrent identical public reads share one request but receive independent bodies; later reads are fresh',async()=>{
 let calls=0,release;const wait=new Promise(r=>release=r),fetcher=backoffFetch(async()=>{calls++;await wait;return new Response(JSON.stringify({value:calls}));});
 const requests=Array.from({length:6},()=>fetcher('https://provider.example/quote'));assert.equal(calls,1);release();
 const responses=await Promise.all(requests);assert.deepEqual(await Promise.all(responses.map(r=>r.json())),Array.from({length:6},()=>({value:1})));
 assert.deepEqual(await (await fetcher('https://provider.example/quote')).json(),{value:2});
});
test('429 respects Retry-After across tokens without sleeping or replaying, then probes fresh data',async()=>{
 let now=1000,calls=0;const fetcher=backoffFetch(async()=>{calls++;return calls===1?new Response('slow down',{status:429,headers:{'retry-after':'120'}}):new Response('{"fresh":true}');},{provider:'Jupiter',clock:()=>now,random:()=>0});
 assert.equal((await fetcher('https://provider.example/token-a')).status,429);
 now=120999;await assert.rejects(fetcher('https://provider.example/token-b'),e=>e.code==='PROVIDER_BACKOFF'&&e.status===429);assert.equal(calls,1);
 now=121000;assert.deepEqual(await (await fetcher('https://provider.example/token-b')).json(),{fresh:true});assert.equal(calls,2);assert.equal(fetcher.diagnostics().retryAt,0);
 assert.equal(retryAfterMs('Thu, 01 Jan 1970 00:03:00 GMT',now),59000);
});
test('provider failures back off exponentially; route-not-found responses are not treated as outages',async()=>{
 let now=0,calls=0;const fetcher=backoffFetch(async()=>{calls++;return new Response('{}',{status:calls<=2?503:400});},{clock:()=>now,random:()=>0});
 await fetcher('https://provider.example/a');assert.equal(fetcher.diagnostics().retryAt,5000);
 now=5000;await fetcher('https://provider.example/b');assert.equal(fetcher.diagnostics().retryAt,15000);
 now=14999;await assert.rejects(fetcher('https://provider.example/c'));assert.equal(calls,2);
 now=15000;assert.equal((await fetcher('https://provider.example/c')).status,400);assert.equal(fetcher.diagnostics().retryAt,0);assert.equal((await fetcher('https://provider.example/d')).status,400);
});
test('a concurrent success cannot erase a newer rate-limit response or leak request credentials',async()=>{
 let release;const wait=new Promise(r=>release=r);let calls=0;
 const fetcher=backoffFetch(async url=>{calls++;if(String(url).endsWith('/slow')){await wait;return new Response('{}');}return new Response('private response must stay hidden',{status:403});},{provider:'RugCheck',clock:()=>1000,random:()=>0});
 const slow=fetcher('https://provider.example/?api-key=private/slow');await fetcher('https://provider.example/blocked');release();await slow;
 await assert.rejects(fetcher('https://provider.example/next'),e=>e.code==='PROVIDER_BACKOFF'&&!e.message.includes('private'));assert.equal(calls,2);assert.equal(fetcher.diagnostics().status,403);
});
