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
