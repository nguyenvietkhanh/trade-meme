import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {RulesFunnel} from '../src/rules-funnel.js';
import {RulesClient} from '../src/rules-client.js';
import {preFilter} from '../src/rules-signal.js';
const start=Date.parse('2026-10-29T08:00:00Z');
test('UTC completed hour, tiers, discovery and top SKIPs remain distinct and never reconstruct missing history',()=>{
 let now=start+1000;const f=new RulesFunnel({clock:()=>now});
 assert.equal(f.report().lastCompletedHour.status,'unavailable');assert.equal(f.report().lastCompletedHour.counts,null);
 f.discovery([{mint:'publicMint'},{mint:'publicMint'},{mint:'otherMint'}],now);
 f.add('seen',now);f.add('signal',now,null,{tier:'STANDARD'});f.add('signal',now,null,{tier:'PROBE'});f.add('none',now,'quote_rate_limited');f.add('none',now,'quote_rate_limited');
 now=start+3600000;const r=f.report().lastCompletedHour;assert.equal(r.counts.discovery_seen,2);assert.equal(r.counts.seen,1);assert.equal(r.signalByTier.STANDARD,1);assert.equal(r.signalByTier.PROBE,1);assert.equal(r.signalByTier.QUICK,0);assert.equal(r.uniqueDiscovered.count,2);assert.equal(r.topSkips[0].count,2);assert.equal(r.coverage.continuousHourVerified,false);assert.equal(r.complete,true);
 assert.equal(f.report().currentHour.status,'unavailable');
});
test('legacy counters restore without pretending tier coverage or missing observations were zero',()=>{
 const f=new RulesFunnel({clock:()=>start+1000});f.restore({hours:{'2026-10-29T07':{seen:15,signal:1,reasons:{FEE_DATA_UNKNOWN:12}}}});
 const r=f.report().lastCompletedHour;assert.equal(r.counts.seen,15);assert.equal(r.counts.discovery_seen,null);assert.equal(r.signalByTier,null);assert.equal(r.coverage.tierCoverage,'legacy_unavailable');assert.equal(r.uniqueDiscovered,null);
});
test('bounded counters and duplicate discovery do not grow without limit or leak untrusted reasons',()=>{
 const f=new RulesFunnel({clock:()=>start});for(let h=0;h<100;h++){f.discovery(Array.from({length:4100},(_,i)=>({mint:'mint'+i})),start+h*3600000);for(let i=0;i<90;i++)f.add('none',start+h*3600000,'reason'+i);}
 assert.ok(f.hours.size<=48);assert.ok(f.days.size<=14);assert.ok(f.unique.size<=2);for(const u of f.unique.values()){assert.ok(u.mints.size<=4096);assert.equal(u.truncated,true);}for(const r of f.hours.values())assert.ok(Object.keys(r.reasons).length<=65);
 f.add('none',start,'https://private.invalid?api-key=secret');assert.ok(!JSON.stringify(f.snapshot()).includes('api-key'));
});
test('real uploaded dead-pool rows reach pre_filter SKIP counters without quotes or fabricated fee/holder data',async()=>{
 const real=JSON.parse(await readFile(new URL('./fixtures/observed-rules-prefilter.json',import.meta.url),'utf8'));
 let quotes=0;const c=new RulesClient({clock:()=>start+1000,quoteSelector:()=>{quotes++;throw Error('must not quote');}});
 const candidates=real.rows.map(r=>{const filtered=preFilter(r.availableInputs);assert.equal(filtered.ok,false);return {mint:r.mint,pool:'fixture-public-pool',rulesEvidence:{error:'pre_filter_dead',inputs:r.availableInputs,missing:filtered.failed}};});
 const reply=await c.decide('kade',{candidates,wallet:{running:true},limits:{maxBatchOrders:5}});
 const r=c.funnel.report().currentHour;assert.equal(reply.decision.action,'HOLD');assert.equal(quotes,0);assert.equal(r.counts.seen,3);assert.equal(r.counts.pre_filter,0);assert.equal(r.topSkips.find(x=>x.reason==='pre_filter_dead').count,3);assert.equal(r.topSkips.find(x=>x.reason==='pre_filter.reserve').count,3);
});
