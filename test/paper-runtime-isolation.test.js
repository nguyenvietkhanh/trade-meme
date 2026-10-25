import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {BOT_CONFIGS,FILL_MODEL} from '../src/paper-bot-config.js';
import {BotRuntime} from '../src/paper-bot-runtime.js';
import {BotStateStore,initialBotState} from '../src/paper-bot-state.js';
import {migrationPlan,migrateFleet} from '../src/paper-state-migration.js';
import {independentSignal} from '../src/paper-score.js';
import {laneChecks} from '../src/paper-lanes.js';
import {MarketData} from '../src/paper-market-data.js';
import {ProviderBudget} from '../src/paper-provider-budget.js';
import {independenceMetrics} from '../src/paper-independence-metrics.js';
import {TEN_AT,tenMarket} from './fixtures/ten-market.js';
const config=id=>BOT_CONFIGS.find(c=>c.id===id);
function market(id='nova',now=TEN_AT){const m=tenMarket(id,now);m.liquidityUsd=id==='atlas'?100000:20000;m.pairCreatedAt=now-(id==='zara'?600000:7200000);m.spotPriceSol=m.priceUsd/100;m.priceAt=now;return m;}
function snap(now,index=0,rows=[market('nova',now)]){return {timestamp:now,snapshotId:'snapshot-'+index,solUsd:100,updatedAt:now,markets:rows};}
test('entry and exit thresholds stay equal to approved ten profiles; lanes are separate config',()=>{
 const expected=[[12,15,30,8,10],[10,12,25,6,8],[8,10,20,5,6],[7,8,16,4,4],[9,10,20,6,10],[12,18,40,10,15],[10,15,35,8,12],[8,10,22,5,8],[10,12,28,7,8],[7,8,18,4,8]];
 BOT_CONFIGS.forEach((c,i)=>assert.deepEqual([c.exitPolicy.stopLossPct,c.exitPolicy.firstProfitPct,c.exitPolicy.finalProfitPct,c.exitPolicy.trailingPct,c.exitPolicy.maxHoldMs/60000],expected[i]));
 assert.ok(BOT_CONFIGS.every(c=>!c.riskPolicy.drawdownHalt&&!c.riskPolicy.dailyLossHalt&&!c.riskPolicy.lossStreakHalt));
});
test('initial own wallet sizes 0.05 SOL; never spends another bot balance',async()=>{
 const {paperOrderSol}=await import('../src/paper-sizing.js');const a=initialBotState(config('nova'),TEN_AT),b=initialBotState(config('echo'),TEN_AT);assert.equal(paperOrderSol(a),.05);a.cashSol=.08;assert.equal(paperOrderSol(a),0);assert.equal(paperOrderSol(b),.05);
});
test('score has only 60/25/15; quote failure does not alter signal score; confirmation needs new market evidence',()=>{
 const c=config('nova'),m=market(),context={snapshotId:'b',prior:{structural:true,at:TEN_AT-6000,sourceAt:TEN_AT-6000,snapshotId:'a',priceUsd:m.priceUsd,liquidityUsd:m.liquidityUsd}};
 const a=independentSignal(c,m,TEN_AT,context),b=independentSignal(c,{...m,evidence:{roundTripLossPct:null,error:'HTTP_429'}},TEN_AT,context);
 assert.equal(a.eligible,true);assert.deepEqual(a.scoreParts,b.scoreParts);assert.ok(a.scoreParts.main>0&&a.scoreParts.main<60);assert.equal(a.scoreParts.persistence,25);assert.ok(a.scoreParts.lane<=15);assert.equal(a.scoreParts.base,undefined);
 const weak=structuredClone(m);weak.change5mPct=5;weak.buys5m=11;weak.sells5m=10;weak.strategyData.flow.lastTen=weak.strategyData.flow.lastTen.map((t,i)=>({...t,side:i<5?'BUY':'SELL'}));const low=independentSignal(c,weak,TEN_AT,context);assert.equal(low.structural,true);assert.equal(low.stage,'score');assert.ok(low.score<a.score);
 assert.equal(independentSignal(c,m,TEN_AT,{...context,snapshotId:'a'}).eligible,false);
 assert.equal(independentSignal(c,{...m,updatedAt:TEN_AT-6000},TEN_AT,context).eligible,false);
 const cooled=independentSignal(c,m,TEN_AT,{...context,cooldownUntil:TEN_AT+10000});assert.equal(cooled.eligible,false);assert.equal(cooled.stage,'market');assert.ok(cooled.checks.some(c=>c.key==='REENTRY_30M'&&c.status==='fail'));
});
test('lane boundaries: age30m, liquidity30k, sharp red and SAGE2h',()=>{
 const m=market();m.pairCreatedAt=TEN_AT-1800000;assert.equal(laneChecks(config('nova'),m,TEN_AT).find(c=>c.key==='LANE_AGE').status,'fail');
 m.pairCreatedAt=TEN_AT-7200000;m.liquidityUsd=30000;assert.equal(laneChecks(config('sage'),m,TEN_AT).find(c=>c.key==='LANE_LIQUIDITY').status,'fail');
 assert.equal(laneChecks(config('atlas'),m,TEN_AT).some(c=>c.key==='LANE_LIQUIDITY'),false);
 m.strategyData.bars.at(-1)[4]=96;m.strategyData.bars.at(-1)[3]=95;
 assert.equal(laneChecks(config('nova'),m,TEN_AT).find(c=>c.key==='LANE_SHARP_RED').status,'fail');assert.equal(laneChecks(config('nyx'),m,TEN_AT).some(c=>c.key==='LANE_SHARP_RED'),false);
 assert.doesNotThrow(()=>laneChecks(config('orin'),{...m,strategyData:{}},TEN_AT));
});
test('every one of the ten complete lane+score configurations has a reachable independent entry',()=>{
 for(const c of BOT_CONFIGS){const m=market(c.id);
  if(c.id==='orin'){m.change5mPct=3;m.strategyData.bars[25][2]=105;}
  if(c.id==='kade'){m.change5mPct=3;m.strategyData.bars[25][2]=110;}
  const context={snapshotId:'second',liquidityCutoff:90000,prior:{structural:true,at:TEN_AT-6000,sourceAt:TEN_AT-6000,snapshotId:'first',priceUsd:m.priceUsd,liquidityUsd:m.liquidityUsd}};
  const d=independentSignal(c,m,TEN_AT,context);assert.equal(d.eligible,true,c.id+': '+d.reason+'; score='+d.score+'; checks='+JSON.stringify(d.checks.filter(c=>c.status!=='pass')));
 }
});
async function replay({reverse=false,skip=null,changeBalance=null,fail=null}={}){
 let now=TEN_AT;const configs=reverse?[...BOT_CONFIGS].reverse():BOT_CONFIGS,engines=configs.filter(c=>c.id!==skip).map(c=>{const s=initialBotState(c,now);s.nextAt=0;if(c.id===changeBalance)s.cashSol=.01;
  return new BotRuntime(c,s,{execute:async input=>{if(c.id===fail)throw Error('injected worker fault');const out=input.side==='BUY'?String(BigInt(input.amount)/1000n):String(BigInt(input.amount)*1000n);return {quote:{mint:input.mint,side:input.side,inAmount:input.amount,outAmount:out,checkedAt:now},roundTripLossPct:.2,decimals:6,quoteSource:'model',observedNow:now};}});});
 for(let i=0;i<20;i++){now=TEN_AT+i*1000;const rows=['nova','zara','atlas','echo','nyx','rune','sage'].map(id=>market(id,now)),s=snap(now,i,rows);for(const e of engines)await e.tick(s,now);}
 return Object.fromEntries(engines.map(e=>[e.config.id,JSON.stringify({decisions:e.state.decisions,pending:e.state.pending,trades:e.state.trades,cash:e.state.cashSol})]));
}
test('replay: removing/failing A, reordering bots or changing balance A leaves other nine byte identical',async()=>{
 const base=await replay();for(const scenario of [{reverse:true},{skip:'nova'},{changeBalance:'nova'},{fail:'nova'}]){const out=await replay(scenario);for(const id of Object.keys(base).filter(id=>id!=='nova'))assert.equal(out[id],base[id],id+' affected by '+JSON.stringify(scenario));}
});
test('two independent bots may buy the same token with distinct wallet/order IDs',async()=>{
 let now=TEN_AT;const m=market(),engines=['nova','echo'].map(id=>{const s=initialBotState(config(id),now);s.nextAt=0;return new BotRuntime(config(id),s,{execute:async input=>({quote:{mint:input.mint,side:input.side,inAmount:input.amount,outAmount:'50000',checkedAt:now},roundTripLossPct:.2,decimals:6,quoteSource:'model',observedNow:now})});});
 for(const offset of [0,6000,9000]){now=TEN_AT+offset;for(const e of engines)await e.tick(snap(now,offset,[{...market('nova',now),mint:m.mint,pairAddress:m.pairAddress}]),now);}
 assert.ok(engines.every(e=>e.state.positions.length===1));assert.equal(engines[0].state.positions[0].mint,engines[1].state.positions[0].mint);assert.notEqual(engines[0].state.positions[0].paperPositionId,engines[1].state.positions[0].paperPositionId);
});
test('gap loss fills current post-delay output, returns rent exactly once; pending resumes idempotently',async()=>{
 const c=config('nova'),s=initialBotState(c,TEN_AT),p={agentId:c.id,mint:'gap',pairAddress:'pool-gap',symbol:'GAP',paperPositionId:'original',quantity:1,rawQuantity:'1000000',decimals:6,costSol:.5,initialCostSol:.5,openedAt:TEN_AT-1000,rentSol:FILL_MODEL.rentSol,realizedPnlSol:0,exitPolicy:c.exitPolicy,peakLiquidityUsd:20000};
 s.positions=[p];s.cashSol=1.49796072;s.rentLockedSol=FILL_MODEL.rentSol;s.nextAt=Infinity;let now=TEN_AT;const execute=async input=>({quote:{mint:input.mint,side:input.side,inAmount:input.amount,outAmount:'50000000',checkedAt:now},quoteSource:'model',observedNow:now});
 const e=new BotRuntime(c,s,{execute});await e.tick(snap(now,0,[{...market(),mint:'gap',pairAddress:'pool-gap',spotPriceSol:.25,priceAt:now}]),now);assert.equal(s.pending.side,'SELL');assert.equal(s.trades.length,0);
 now+=2000;const restored=structuredClone(s),e2=new BotRuntime(c,restored,{execute});await e2.tick(snap(now,1,[{...market('nova',now),mint:'gap',pairAddress:'pool-gap',spotPriceSol:.05,priceAt:now}]),now);
 assert.equal(restored.positions.length,0);assert.equal(restored.trades[0].gapLoss,true);assert.ok(restored.trades[0].pnlSol<-.45);assert.equal(restored.rentLockedSol,0);const cash=restored.cashSol;await e2.tick(snap(now+1000,2,[]),now+1000);assert.equal(restored.cashSol,cash);assert.equal(restored.trades.length,1);
});
test('migration reconciles existing loss/open rent, blocks unattributed residual and never reissues capital on restart',async()=>{
 const legacy={cashSol:19.9,rentLockedSol:0,positions:[],trades:[],agentStats:{nova:{realizedPnlSol:-.1}},running:true};const plan=migrationPlan(legacy,TEN_AT);assert.equal(plan.states[0].cashSol,1.9);assert.equal(plan.states.reduce((n,s)=>n+s.cashSol,0),19.9);assert.throws(()=>migrationPlan({...legacy,cashSol:19.8},TEN_AT),/does not reconcile/);
 const dir=await mkdtemp(path.join(tmpdir(),'fleet-migration-'));try{await writeFile(path.join(dir,'ledger.json'),JSON.stringify(legacy));await migrateFleet(dir,TEN_AT);const store=new BotStateStore(dir,'nova'),s=await store.load();s.cashSol=1.8;await store.save(s);await migrateFleet(dir,TEN_AT+1000);assert.equal((await store.load()).cashSol,1.8);const doc=JSON.parse(await readFile(store.file,'utf8'));doc.payload.cashSol=9;await writeFile(store.file,JSON.stringify(doc));await assert.rejects(store.load(),/checksum/);}finally{await rm(dir,{recursive:true,force:true});}
});
test('immutable snapshots do not freeze provider caches, retain timestamps; exact requests coalesce and quote429 uses model',async()=>{
 let reads=0,model=0;const market={quote:async()=>{reads++;throw Error('HTTP_429');},modelQuote:async input=>{model++;return {quoteSource:'model',quote:{mint:input.mint,inAmount:input.amount,outAmount:'1',checkedAt:TEN_AT}};}};
 const data=new MarketData(market,{clock:()=>TEN_AT});data.setFeed({updatedAt:TEN_AT-5000,markets:[marketFixture()],solUsd:100});const s=data.snapshot();assert.equal(s.updatedAt,TEN_AT-5000);assert.throws(()=>{s.markets[0].priceUsd=1;});data.feed.markets[0].strategyData.status.candles='new';
 const request={mint:'mint',side:'BUY',amount:'50000000',minObservedAt:TEN_AT},m={mint:'mint',pairAddress:'pool'};const values=await Promise.all([data.execute(request,m),data.execute(request,m)]);assert.ok(values.every(v=>v.quoteSource==='model'));assert.equal(reads,1);assert.equal(model,1);await data.execute({...request,amount:'40000000'},m);assert.equal(model,2);
 function marketFixture(){return {mint:'mint',priceUsd:10,strategyData:{status:{candles:'observed'}}};}
});
test('45 pair metrics use null for no trades/constant hourly PnL; full overlap warns',()=>{
 const ids=BOT_CONFIGS.map(c=>c.id);const empty=independenceMetrics([],ids,0,86400000);assert.equal(empty.length,45);assert.ok(empty.every(p=>p.jaccard===null&&p.hourlyPnlCorrelation===null));const fills=['nova','echo'].map(agentId=>({id:agentId,side:'BUY',agentId,mint:'same',at:100}));const pair=independenceMetrics(fills,['nova','echo'],0,86400000)[0];assert.equal(pair.jaccard,1);assert.equal(pair.warning,true);
});
