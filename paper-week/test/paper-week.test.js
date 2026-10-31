import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PaperWeek} from '../engine.js';
import {PaperStore,dayFor} from '../store.js';
import {readOnlyRpc} from '../readonly.js';
import {paperReportEnd,nextPaperReportEnd} from '../../src/paper-schedule.js';
const initial=Date.parse('2026-10-30T03:00:00Z');
async function setup(t){const dir=await mkdtemp(path.join(tmpdir(),'paper-week-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));let now=initial,price=.005,available=true,unknown=false;
 const market=()=>({mint:'fixture-mint',pairAddress:'fixture-pool',symbol:'TEST_FIXTURE',dexId:'pumpfun',solUsd:100,spotPriceSol:price,priceUsd:price*100,updatedAt:now,priceAt:now,liquidityQuoteSol:100,liquidityUsd:20000,volume5mSol:1,buys5m:12,sells5m:6,change5mPct:20});
 const adapter={evidence:async()=>({source:'TEST_FIXTURE',inputs:{top10_pct:10,dev_wallet_pct:1,holder_count:100,quote_reserve_sol:100,curve_progress_pct:40,volume_5m_sol:1,buys_5m:12,sells_5m:6,change_5m_pct:20,priority_fee_sol:.000025,project_research:{checkedAt:now,top10WalletsVerified:true,devSellHistoryVerified:true,devSoldFirst15m:false,creationBlockComplete:true,creationBlockBuyers:[{wallet:'fixture-wallet',sol:1}],socials:unknown?null:{verified:true,ageHours:100,followers:100},walletsListAvailable:true,blockedWalletMatches:[]}}}),quote:async order=>{if(!available)throw Error('source unavailable');return {out:order.side==='BUY'?'1000000':String(Math.floor(Number(order.amount)/1e6*price*1e9)),at:now,decimals:6,roundTripLossPct:1,impactPct:.1,source:'TEST_FIXTURE'};}};
 const store=new PaperStore(dir,{clock:()=>now}),engine=new PaperWeek(store,adapter,{clock:()=>now});await engine.load();return {engine,store,dir,market,advance:n=>now+=n,setNow:n=>now=n,setPrice:n=>price=n,setAvailable:b=>available=b,setUnknown:b=>unknown=b,now:()=>now};}
test('paper fills wait for quote, conserve virtual cash through TP and fixed stop; no real funds',async t=>{
 const f=await setup(t),e=f.engine;await e.step([f.market()]);assert.equal(e.state.positions.length,0);assert.equal(e.state.pending.side,'BUY');f.advance(2000);await e.step([f.market()]);assert.equal(e.state.positions.length,1);assert.equal(e.state.cash,500000000-5000000-25000-2039280);
 f.setPrice(.01);f.advance(2000);await e.step([f.market()]);assert.equal(e.state.pending.side,'SELL');assert.equal(e.state.pending.amount,'400000');f.advance(2000);await e.step([f.market()]);assert.equal(e.state.positions[0].raw,'600000');assert.equal(e.state.positions[0].tpDone,true);
 f.setPrice(.0034);f.advance(2000);await e.step([f.market()]);assert.equal(e.state.pending.reason,'stop-loss');f.advance(2000);await e.step([f.market()]);assert.equal(e.state.positions.length,0);assert.equal(e.state.closed,1);assert.equal(e.state.cash-e.state.initial,e.state.realized);assert.equal(e.state.fees,75000);assert.equal(e.status().simulation,true);assert.equal(e.status().signing,false);
 const text=await f.store.training(dayFor(f.now()));assert.match(text,/'?virtual_fill'?/);assert.match(text,/TEST_FIXTURE/);
});
test('missing mandatory evidence yields WATCH, not simulated BUY',async t=>{const f=await setup(t);f.setUnknown(true);await f.engine.step([f.market()]);assert.equal(f.engine.state.pending,null);assert.equal(f.engine.state.counts.virtualBuys,0);assert.equal(f.engine.state.skips.WATCH,1);});
test('unavailable quote never invents fill or changes virtual cash',async t=>{const f=await setup(t);await f.engine.step([f.market()]);f.advance(2000);f.setAvailable(false);await f.engine.step([f.market()]);assert.equal(f.engine.state.cash,500000000);assert.equal(f.engine.state.positions.length,0);assert.ok(f.engine.state.pending);});
test('restarting restores virtual positions, fees and cash, not a new 0.5 SOL allocation',async t=>{const f=await setup(t);await f.engine.step([f.market()]);f.advance(2000);await f.engine.step([f.market()]);const second=new PaperWeek(new PaperStore(f.dir),f.engine.adapter,{initialSol:10,clock:f.now});await second.load();assert.equal(second.state.cash,f.engine.state.cash);assert.equal(second.state.initial,500000000);assert.equal(second.state.positions.length,1);});
test('after seven days entries stop and open virtual positions remain in the ledger',async t=>{const f=await setup(t);await f.engine.step([f.market()]);f.advance(2000);await f.engine.step([f.market()]);f.setNow(f.engine.state.endsAt+1);await f.engine.step([f.market()]);assert.equal(f.engine.status().entryWindowOpen,false);assert.equal(f.engine.state.positions.length,1);assert.equal(f.engine.state.counts.virtualBuys,1);});
test('report is due at 23:59 Vietnam, contains TXT and persistent Telegram receipt',async t=>{const f=await setup(t),e=f.engine;let sends=0,body;const telegram={configured:true,document:async(name,caption,bytes)=>{sends++;assert.match(name,/\.txt$/);assert.match(caption,/SOL ẢO/);body=bytes.toString();return 123;}};
 const end=nextPaperReportEnd(paperReportEnd(f.now()));f.setNow(end-1);await e.reportTick(telegram);assert.equal(sends,0);f.setNow(end);await e.reportTick(telegram);assert.equal(sends,1);assert.match(body,/TRAINING EXPORT/);assert.match(body,/policyVersion/);await e.reportTick(telegram);assert.equal(sends,1);assert.equal(e.state.outbox[0].status,'sent');
 const restored=new PaperWeek(new PaperStore(f.dir),e.adapter,{clock:f.now});await restored.load();await restored.reportTick(telegram);assert.equal(sends,1);
});
test('Telegram timeout remains unknown and is never automatically sent twice',async t=>{const f=await setup(t);let sends=0;f.setNow(nextPaperReportEnd(paperReportEnd(f.now())));const telegram={configured:true,document:async()=>{sends++;throw Error('timeout');}};await f.engine.reportTick(telegram);await f.engine.reportTick(telegram);assert.equal(sends,1);assert.equal(f.engine.state.outbox[0].status,'unknown');});
test('training cap drops observer rows without touching the virtual state',async t=>{const f=await setup(t);f.store.maxFileBytes=50;const cash=f.engine.state.cash;await f.engine.log('large',{payload:'x'.repeat(100)});assert.ok(f.store.dropped>0);assert.equal(f.engine.state.cash,cash);await assert.rejects(f.store.document('../live-ledger.json'),/INVALID_DOCUMENT/);});
test('RPC capability rejects writes/subscriptions/private methods while exposing read methods',()=>{let sends=0;const r=readOnlyRpc({getSlot:()=>99,sendTransaction:()=>sends++,sendRawTransaction:()=>sends++});assert.equal(r.getSlot(),99);assert.throws(()=>r.sendTransaction,/READ_ONLY/);assert.throws(()=>r.sendRawTransaction,/READ_ONLY/);assert.throws(()=>r._rpcRequest,/READ_ONLY/);assert.equal(sends,0);});
test('offline analysis deduplicates exported fills and does not treat partial exits as wins',async()=>{const {summarize}=await import('../analyze.js');const buy={type:'virtual_fill',simulation:true,id:'b',side:'BUY',positionId:'p',inputs:{top10_pct:10},feeSol:.000025},partial={type:'virtual_fill',simulation:true,id:'s1',side:'SELL',positionId:'p',closed:false,pnlSol:.01},closed={type:'virtual_fill',simulation:true,id:'s2',side:'SELL',positionId:'p',closed:true,positionPnlSol:.02,pnlSol:.01};const r=summarize([buy,partial,closed,buy,closed]);assert.equal(r.uniqueVirtualFills,3);assert.equal(r.closed,1);assert.equal(r.wins,1);assert.equal(r.features.top10_pct.virtualWinMedian,10);assert.match(r.warning,/UNDER_200/);});
test('known Telegram refusal retries with backoff; successful retry remains idempotent',async t=>{const f=await setup(t);let calls=0;f.setNow(nextPaperReportEnd(paperReportEnd(f.now())));const telegram={configured:true,document:async()=>{calls++;if(calls===1)throw Object.assign(Error('known not sent'),{code:'PAPER_TELEGRAM_NOT_SENT',retryMs:60000});return 9;}};await f.engine.reportTick(telegram);assert.equal(f.engine.state.outbox[0].status,'queued');await f.engine.reportTick(telegram);assert.equal(calls,1);f.advance(60000);await f.engine.reportTick(telegram);assert.equal(calls,2);assert.equal(f.engine.state.outbox[0].status,'sent');});

test('candidate rotation visits later tokens instead of repeating the first two',async t=>{
 const f=await setup(t);f.setUnknown(true);const visited=[],evidence=f.engine.adapter.evidence;
 f.engine.adapter.evidence=async m=>{visited.push(m.mint);return evidence(m);};
 const markets=()=>Array.from({length:6},(_,i)=>({...f.market(),mint:'fixture-'+i}));
 for(let i=0;i<3;i++){await f.engine.step(markets());f.advance(10000);}
 assert.deepEqual(visited,Array.from({length:6},(_,i)=>'fixture-'+i));
 assert.equal(f.engine.state.counts.virtualBuys,0);
});
test('old candidate price gets a real refresh before evidence; source timestamp is preserved',async t=>{
 const f=await setup(t),m=f.market();f.advance(10000);let refreshed=0;
 f.engine.adapter.refreshCandidate=async old=>{refreshed++;assert.equal(old.priceAt,initial);return {...old,spotPriceSol:.006,priceAt:f.now()};};
 const evidence=f.engine.adapter.evidence;f.engine.adapter.evidence=async market=>{
 assert.equal(market.priceAt,f.now());assert.equal(market.updatedAt,initial);
 return evidence(market);
 };
 await f.engine.step([m]);assert.equal(refreshed,1);assert.equal(f.engine.state.pending.side,'BUY');
 assert.equal(f.engine.prices.get(m.mint+':'+m.pairAddress).price,.006);
});
test('failed refresh never relabels old data as fresh or creates an order',async t=>{
 const f=await setup(t),m=f.market();f.advance(10000);
 f.engine.adapter.refreshCandidate=async()=>null;
 f.engine.adapter.evidence=async market=>({error:f.now()-market.priceAt>5000?'RULES_MARKET_STALE':null,inputs:{}});
 await f.engine.step([m]);assert.equal(m.priceAt,initial);assert.equal(f.engine.state.pending,null);
 assert.equal(f.engine.state.skips.RULES_MARKET_STALE,1);
});

// The new strategy is tested with explicit synthetic quotes, never live transactions.
const {momentumConfig,MOMENTUM_VERSION}=await import('../momentum.js');
async function momentumSetup(t,{venue='pumpfun',cash=20}={}){
 const dir=await mkdtemp(path.join(tmpdir(),'paper-momentum-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let now=Date.parse('2026-10-30T19:30:00Z'),price=.01,change=10,quoteAvailable=true;let evidenceCalls=0;
 const market=(mint='fixture-momentum')=>({mint,pairAddress:'pool-'+mint,symbol:'TEST_FIXTURE',dexId:venue,solUsd:100,solUsdAt:now,spotPriceSol:price,priceUsd:price*100,updatedAt:now,priceAt:now,activityCheckedAt:now,change5mPct:change});
 const adapter={evidence:async()=>{evidenceCalls++;throw Error('strict evidence must not gate momentum');},quote:async order=>{
  if(!quoteAvailable)throw Error('TEST_FIXTURE_NO_ROUTE');
  return {out:order.side==='BUY'?String(Math.floor(Number(order.amount)/1e9/price*1e6)):String(Math.floor(Number(order.amount)/1e6*price*1e9)),at:now,decimals:6,roundTripLossPct:null,impactPct:null,source:'TEST_FIXTURE'};
 }};
 const store=new PaperStore(dir,{clock:()=>now}),engine=new PaperWeek(store,adapter,{initialSol:cash,policy:momentumConfig(),clock:()=>now});await engine.load();
 return {dir,store,engine,adapter,market,now:()=>now,advance:n=>now+=n,price:n=>price=n,change:n=>change=n,available:n=>quoteAvailable=n,evidenceCalls:()=>evidenceCalls};
}
async function momentumBuy(f,mint){f.advance(1000);await f.engine.step([f.market(mint)]);assert.equal(f.engine.state.pending?.side,'BUY');assert.equal(f.engine.state.pending.amount,'1000000000');f.advance(2000);await f.engine.step([f.market(mint)]);}

test('momentum buys exactly 1 SOL on both venues at night without holder/social/curve gates',async t=>{
 for(const venue of ['pumpfun','pumpswap']){const f=await momentumSetup(t,{venue});
  f.engine.state.trades=[{id:'old1',positionId:'old1',side:'SELL',closed:true,positionPnlSol:-.1,at:f.now()-2000},{id:'old2',positionId:'old2',side:'SELL',closed:true,positionPnlSol:-.1,at:f.now()-1000}];
  await momentumBuy(f);assert.equal(f.engine.state.positions.length,1);assert.equal(f.engine.state.positions[0].initialCost,1000025000);
  assert.equal(f.engine.state.cash,20000000000-1000000000-25000-2039280);assert.equal(f.evidenceCalls(),0);
  assert.equal(f.engine.state.positions[0].venue,venue);assert.equal(f.engine.state.skips.VALID_SETUP,undefined);
 }
});
test('four profit tiers sell 50/20/20/10 of initial tokens and conserve cash after fees/rent',async t=>{
 const f=await momentumSetup(t);await momentumBuy(f);
 for(const [i,multiple] of [2,3,5,10].entries()){
  f.price(.01*multiple);f.advance(2000);await f.engine.step([f.market()]);
  assert.equal(f.engine.state.pending?.reason,'momentum-tp'+(i+1));
  f.advance(2000);await f.engine.step([f.market()]);
  if(i<3)assert.equal(f.engine.state.positions[0].tpSoldSteps,i+1);
 }
 // A new order may be queued immediately after the final close; it is not filled yet.
 assert.equal(f.engine.state.positions.length,0);assert.equal(f.engine.state.closed,1);
 const sells=f.engine.state.trades.filter(r=>r.side==='SELL').reverse();
 assert.deepEqual(sells.map(r=>r.raw),['50000000','20000000','20000000','10000000']);
 assert.equal(f.engine.state.realized,2599875000);assert.equal(f.engine.state.fees,125000);
 assert.equal(f.engine.state.cash-f.engine.state.initial,f.engine.state.realized);
});
test('30% stop exits the entire remainder, including after partial take-profit',async t=>{
 for(const partial of [false,true]){const f=await momentumSetup(t);await momentumBuy(f);
  if(partial){f.price(.02);f.advance(2000);await f.engine.step([f.market()]);f.advance(2000);await f.engine.step([f.market()]);}
  f.price(.0069);f.advance(2000);await f.engine.step([f.market()]);
  assert.equal(f.engine.state.pending.reason,'stop-loss');assert.equal(f.engine.state.pending.amount,partial?'50000000':'100000000');
  f.advance(2000);await f.engine.step([f.market()]);assert.equal(f.engine.state.closed,1);assert.equal(f.engine.state.positions.length,0);
  assert.equal(f.engine.state.cash-f.engine.state.initial,f.engine.state.realized);
 }
});
test('no four-position limit; cash cap prevents overspending and duplicate simultaneous mint entries',async t=>{
 const f=await momentumSetup(t,{cash:6});
 for(let i=0;i<5;i++)await momentumBuy(f,'fixture-'+i);
 assert.equal(f.engine.state.positions.length,5);assert.ok(f.engine.state.cash>0);
 f.advance(2000);await f.engine.step([f.market('fixture-extra')]);assert.equal(f.engine.state.pending,null);
 assert.ok(f.engine.state.skips.MOMENTUM_CASH);assert.equal(f.engine.state.counts.virtualBuys,5);
});
test('negative, zero, missing or stale 5m signals never fabricate an entry',async t=>{
 const f=await momentumSetup(t);for(const change of [-1,0,null]){f.change(change);await f.engine.step([f.market()]);f.advance(2000);}
 f.change(10);const old=f.market();f.advance(46000);await f.engine.step([old]);
 assert.equal(f.engine.state.pending,null);assert.equal(f.engine.state.counts.virtualBuys,0);
});
test('BUY is revalidated after delay; falling 5m change cancels it and missing quotes do not invent fills',async t=>{
 const f=await momentumSetup(t);await f.engine.step([f.market()]);f.change(-1);f.advance(2000);await f.engine.step([f.market()]);
 assert.equal(f.engine.state.counts.virtualBuys,0);assert.equal(f.engine.state.pending,null);
 f.change(5);f.advance(2000);await f.engine.step([f.market()]);f.available(false);f.advance(2000);await f.engine.step([f.market()]);
 assert.equal(f.engine.state.counts.virtualBuys,0);assert.equal(f.engine.state.cash,20000000000);
});
test('restart keeps completed TP steps and cannot sell the first tranche twice',async t=>{
 const f=await momentumSetup(t);await momentumBuy(f);f.price(.02);f.advance(2000);await f.engine.step([f.market()]);f.advance(2000);await f.engine.step([f.market()]);
 const restored=new PaperWeek(new PaperStore(f.dir),f.adapter,{policy:momentumConfig(),clock:f.now});await restored.load();
 f.advance(2000);await restored.step([f.market()]);assert.equal(restored.state.positions[0].tpSoldSteps,1);assert.equal(restored.state.pending,null);
 f.price(.03);f.advance(2000);await restored.step([f.market()]);assert.equal(restored.state.pending.reason,'momentum-tp2');assert.equal(restored.state.pending.amount,'20000000');
});
test('strategy migration preserves balance, history and legacy exits while cancelling old BUY',async t=>{
 const f=await setup(t);await f.engine.step([f.market()]);f.advance(2000);await f.engine.step([f.market()]);
 const cash=f.engine.state.cash,ends=f.engine.state.endsAt,oldPosition=f.engine.state.positions[0];
 f.engine.state.pending={side:'BUY',id:'old-pending'};await f.store.save(f.engine.state);
 const migrated=new PaperWeek(new PaperStore(f.dir),f.engine.adapter,{policy:momentumConfig(),clock:f.now});await migrated.load();
 assert.equal(migrated.state.cash,cash);assert.equal(migrated.state.endsAt,ends);assert.equal(migrated.state.pending,null);
 assert.deepEqual(migrated.state.positions[0],oldPosition);assert.equal(migrated.state.policyVersion,MOMENTUM_VERSION);
 assert.equal(migrated.state.policyHistory[0].from,'pumpfun-project-rules-v6');assert.equal(migrated.state.trades.length,1);
});
test('a stop on a held token preempts a queued BUY instead of waiting for its quote',async t=>{
 const f=await momentumSetup(t);await momentumBuy(f);f.advance(2000);await f.engine.step([f.market(),f.market('fixture-next')]);
 assert.equal(f.engine.state.pending.side,'BUY');f.price(.006);f.advance(1000);await f.engine.step([f.market(),f.market('fixture-next')]);
 assert.equal(f.engine.state.pending.side,'SELL');assert.equal(f.engine.state.pending.reason,'stop-loss');
 assert.equal(f.engine.state.counts.virtualBuys,1);
});
test('crossing all targets at once sells sequential tranches, closes dust, never sells more than bought',async t=>{
 const f=await momentumSetup(t);await momentumBuy(f);f.price(.1);
 for(let i=0;i<5;i++){f.advance(2000);await f.engine.step([f.market()]);}
 assert.equal(f.engine.state.closed,1);assert.equal(f.engine.state.positions.length,0);
 const sold=f.engine.state.trades.filter(r=>r.side==='SELL').reduce((n,r)=>n+BigInt(r.raw),0n);assert.equal(sold,100000000n);
});
test('rounding dust is closed at the final target even when middle tranches round to zero',async t=>{
 const f=await momentumSetup(t);await momentumBuy(f);const p=f.engine.state.positions[0];p.raw=p.initialRaw='3';p.entry=.01;p.basis=1000025000;f.change(-1);
 f.price(.1);for(let i=0;i<9;i++){f.advance(2000);await f.engine.step([f.market()]);}
 assert.equal(f.engine.state.closed,1);assert.equal(f.engine.state.positions.length,0);
 const sold=f.engine.state.trades.filter(r=>r.side==='SELL').reduce((n,r)=>n+BigInt(r.raw),0n);assert.equal(sold,3n);
});
test('an unavailable SELL times out without losing position or inventing proceeds',async t=>{
 const f=await momentumSetup(t);await momentumBuy(f);const cash=f.engine.state.cash;f.available(false);f.price(.006);
 f.advance(2000);await f.engine.step([f.market()]);const first=f.engine.state.pending.id;
 f.advance(11000);await f.engine.step([f.market()]);assert.equal(f.engine.state.positions.length,1);assert.equal(f.engine.state.cash,cash);
 assert.equal(f.engine.state.pending.side,'SELL');assert.notEqual(f.engine.state.pending.id,first);assert.equal(f.engine.state.counts.virtualSells,0);
});
test('a newly triggered stop preempts a take-profit quote waiting on a different position',async t=>{
 const f=await momentumSetup(t);await momentumBuy(f,'fixture-A');await momentumBuy(f,'fixture-B');
 const rows=(a,b)=>[{...f.market('fixture-A'),spotPriceSol:a,priceUsd:a*100},{...f.market('fixture-B'),spotPriceSol:b,priceUsd:b*100}];
 f.advance(1000);await f.engine.step(rows(.02,.01));assert.equal(f.engine.state.pending.reason,'momentum-tp1');
 f.advance(1000);await f.engine.step(rows(.02,.006));assert.equal(f.engine.state.pending.reason,'stop-loss');assert.equal(f.engine.state.pending.mint,'fixture-B');
});
