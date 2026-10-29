import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {once} from 'node:events';
import {outcome,publicMarket,publicPair,decisionCode} from '../src/candidate-observer-data.js';
import {CandidateStore} from '../src/candidate-observer-store.js';
import {CandidateObserver,observerConfig,observeCandidates} from '../src/candidate-observer.js';
import {analyze,exportCsv} from '../scripts/analyze-candidates.js';
const mint='8tjtN7AGLaSLbMoNizXbZFTKqdk3iCFgcqmhHY4Hpump',pool='28vWTtEwxoWp5MpHutAMSK5DeVf8xXk8jEEtbrtppump';
const now=Date.now(),c={mint,pool,firstSeenAt:now,wouldBuy:true,evaluationStatus:'EVALUATED'};
const series=(f,liq=()=>10000)=>Array.from({length:121},(_,i)=>({at:now+i*30000,priceUsd:f(i),liquidityUsd:liq(i)}));
const snaps=(end=1)=>[{minute:0,values:{priceUsd:1,liquidityUsd:10000}},{minute:15,values:{priceUsd:1.1}},{minute:60,values:{priceUsd:end}}];
test('labels WIN, RUG, LOSS, FLAT with observed drawdown and exact endpoints',()=>{
 const win=outcome(c,series(i=>i===30?1.5:1),snaps(1.1),now+3600000);assert.equal(win.label,'WIN');assert.equal(win.max_gain_pct,50);assert.ok(Math.abs(win.max_drawdown_pct-100/3)<1e-8);assert.ok(Math.abs(win.return_15m-10)<1e-8);
 assert.equal(outcome(c,series(i=>i===3?.09:1),snaps(),now+3600000).label,'RUG');
 assert.equal(outcome(c,series(()=>1,i=>i===3?1999:10000),snaps(),now+3600000).label,'RUG');
 assert.equal(outcome(c,series(()=>.95),snaps(.95),now+3600000).label,'LOSS');assert.equal(outcome(c,series(()=>1),snaps(),now+3600000).label,'FLAT');
});
test('incomplete samples never certify not-rug or fabricate return',()=>{
 const l=outcome(c,[{at:now,priceUsd:1,liquidityUsd:10000}],snaps().slice(0,1),now+3600000);assert.equal(l.label,null);assert.equal(l.is_rug,null);assert.equal(l.return_60m,null);assert.equal(l.coverage.complete,false);
 const observed=outcome(c,[{at:now,priceUsd:1},{at:now+1000,priceUsd:.01}],snaps(),now+3600000);assert.equal(observed.label,'RUG');
 assert.equal(outcome(c,series(()=>1),[{minute:0,values:{priceUsd:null}}],now+3600000).max_gain_pct,null);
});
test('allowlist removes secrets, owners, signatures; partial and stale data stay null',()=>{
 const row=publicMarket({mint,pairAddress:pool,updatedAt:now,priceUsd:1,owner:'PRIVATE',secretKey:'SECRET',signedTransaction:'TX',strategyData:{flow:{mint,pairAddress:pool,checkedAt:now,uniqueBuyers:30,windowComplete:false}}},now);
 assert.equal(row.values.uniqueBuyers5m,null);assert.equal(row.values.buyVolume5mUsd,null);assert.equal(row.values.top10Pct,null);assert.doesNotMatch(JSON.stringify(row),/PRIVATE|SECRET|TX/);
 assert.equal(publicMarket({mint,updatedAt:now-20000,priceUsd:1},now).values.priceUsd,null);
 assert.equal(publicPair({chainId:'ethereum',baseToken:{address:mint}}),null);
});
async function withStore(fn,env={}){const dir=await mkdtemp(path.join(os.tmpdir(),'observer-'));let store;try{const conf=observerConfig(dir,{...env,CANDIDATE_OBSERVER_DIR:dir});store=new CandidateStore(conf);await fn(store,conf,dir);}finally{try{store?.close();}catch{}await rm(dir,{recursive:true,force:true});}}
const row=(at,price=1,liq=10000)=>publicMarket({mint,pairAddress:pool,updatedAt:at,priceUsd:price,liquidityUsd:liq,marketCapUsd:20000,buys5m:5,sells5m:2,volume5mUsd:100},at);
test('SQLite: one candidate, six immutable horizons, consistent pool, labels and restart',()=>withStore(async(s,conf,dir)=>{
 s.transaction(()=>{for(let i=0;i<=120;i++)s.seen(row(now+i*30000,i===30?1.5:1),now+i*30000);s.decision({mint,at:now+1000,action:'BUY',code:'BUY_DECISION',wouldBuy:true,filterPassed:true});s.expire(now+3621000);});
 assert.equal(s.status().candidates,1);assert.equal(s.status().snapshots,6);assert.equal(s.status().labeled,1);const first=s.get(mint).record.firstSeenAt;
 const before=s.db.prepare('SELECT data FROM snapshots WHERE mint=? AND minute=0').get(mint).data;s.seen({...row(now+500),pool:'9v4airX4Vt45ADFg3QQG9pXX68LkX9Big4GiYEuJpump'},now+500);assert.equal(s.db.prepare('SELECT data FROM snapshots WHERE mint=? AND minute=0').get(mint).data,before);
 s.close();const restarted=new CandidateStore(conf);try{assert.equal(restarted.get(mint).record.firstSeenAt,first);const a=analyze(restarted.file);assert.equal(a.counts.WIN,1);assert.equal(a.groups.BUY.winRate,1);assert.ok(a.warning);const csv=path.join(dir,'export.csv');await exportCsv(restarted.file,csv);assert.match(await readFile(csv,'utf8'),/t0_priceUsd/);}finally{restarted.close();}
}));
test('overdue snapshots after restart are dropped, not filled with new prices',()=>withStore(async(s)=>{
 s.seen(row(now),now);s.expire(now+120000);s.seen(row(now+120000,100),now+120000);const snap=JSON.parse(s.db.prepare('SELECT data FROM snapshots WHERE mint=? AND minute=1').get(mint).data);assert.equal(snap.dropped,true);assert.equal(snap.values.priceUsd,null);assert.equal(snap.missing.all,'MISSED_WINDOW');
}));
test('pending horizon schedule survives restart; raw source null never becomes a number',()=>withStore(async(s,conf)=>{
 s.seen(row(now),now);s.close();const b=new CandidateStore(conf);try{assert.equal(b.status().pendingSnapshots,5);b.seen(row(now+60000,1.2),now+60000);assert.equal(JSON.parse(b.db.prepare('SELECT data FROM snapshots WHERE mint=? AND minute=1').get(mint).data).values.priceUsd,1.2);}finally{b.close();}
}));
test('retention deletes only research and does not touch sibling files',()=>withStore(async(s,conf,dir)=>{
 await writeFile(path.join(dir,'financial-ledger.json'),'preserve');s.seen(row(now),now);s.maintain(now+15*86400000);assert.equal(s.status().candidates,0);assert.equal(await readFile(path.join(dir,'financial-ledger.json'),'utf8'),'preserve');assert.ok(s.status().usedBytes<conf.maxBytes);
}));
test('bounded main queue, disabled observer and thrown observation are harmless',async()=>{
 const disabled=new CandidateObserver('/tmp',{env:{CANDIDATE_OBSERVER_ENABLED:'false'}});disabled.markets([row(now)]);assert.equal(disabled.status().buffered,0);await disabled.close();
 observeCandidates({pairs(){throw Error('bad');}},'pairs',[]);
 const {EventEmitter}=await import('node:events');const worker=new EventEmitter();worker.unref=()=>{};worker.postMessage=()=>{};worker.terminate=async()=>0;
 const o=new CandidateObserver('/tmp',{workerFactory:()=>worker,log:()=>{}});for(let i=0;i<3000;i++)o.enqueue({kind:'seen',row:{mint}});assert.equal(o.status().buffered,2048);assert.equal(o.status().dropped,952);worker.emit('error',Error('fail'));assert.equal(o.status().workerFailed,true);o.closed=true;clearInterval(o.timer);
});
test('actual worker commits, shuts down and reopens without trading capabilities',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'observer-worker-'));
 try{const o=new CandidateObserver(dir,{env:{CANDIDATE_OBSERVER_DIR:dir},log:()=>{}});o.markets([{mint,pairAddress:pool,updatedAt:Date.now(),priceUsd:1,liquidityUsd:10000}]);await o.close();const a=analyze(path.join(dir,'candidates.sqlite'));assert.equal(a.total,1);assert.equal(a.counts.UNLABELED,1);}finally{await rm(dir,{recursive:true,force:true});}
});
test('observer sees price-invalid and unselected raw tokens without changing market selection',async t=>{
 const {loadMarkets}=await import('../src/market.js'),{SOL}=await import('../src/engine.js'),observed=[];
 const pair=(address,price)=>({chainId:'solana',dexId:'pumpswap',baseToken:{address,symbol:'TEST'},quoteToken:{address:SOL},pairAddress:pool,priceUsd:price,liquidity:{usd:10000},txns:{m5:{buys:1,sells:1}}});
 t.mock.method(globalThis,'fetch',async url=>new Response(JSON.stringify(String(url).includes('geckoterminal')?{data:[]}:String(url).endsWith('/latest/v1')?[]:{pairs:String(url).endsWith(SOL)?[pair(SOL,'150')]:[pair(mint,null),pair(pool,'1')]})));
 const base=await loadMarkets([],{},null,{selectMarkets:()=>[]});
 const withObserver=await loadMarkets([],{},null,{selectMarkets:()=>[],onObserved:(kind,rows)=>{if(kind==='pairs')observed.push(...rows);}});
 assert.deepEqual(base.markets,withObserver.markets);assert.ok(observed.some(p=>p.baseToken?.address===mint&&p.priceUsd===null));assert.ok(observed.some(p=>p.baseToken?.address===pool));
 const broken=await loadMarkets([],{},null,{selectMarkets:()=>[],onObserved:()=>{throw Error('observer broken');}});assert.deepEqual(broken.markets,base.markets);
});
test('discovery observer runs before trimming and cannot break discovery',async()=>{
 const {DiscoveryQueue}=await import('../src/discovery.js');const q=new DiscoveryQueue(),rows=[{mint}],seen=[];q.onObserved=r=>{seen.push(...r);throw Error('observer broken');};q.remember(rows);assert.equal(seen[0].mint,mint);assert.equal(q.entries.size,1);
});
test('missing features may be enriched in grace window without rewriting baseline price',()=>withStore(async s=>{
 s.seen(row(now),now);const r=publicMarket({mint,pairAddress:pool,updatedAt:now+5000,priceUsd:2},now+5000,'existing_feed',{at:now+5000,facts:{holderCount:100,top10Pct:10,top10ExcludesPool:true,devPct:1}});s.seen(r,now+5000);const snapshot=JSON.parse(s.db.prepare('SELECT data FROM snapshots WHERE mint=? AND minute=0').get(mint).data);assert.equal(snapshot.values.holderCount,100);assert.equal(snapshot.values.priceUsd,1);
}));
test('snapshot capacity drops schedules but still registers new mint exactly once',()=>withStore(async(s)=>{
 s.config.maxPending=1;s.seen(row(now),now);const other={...row(now),mint:pool};s.seen(other,now);s.seen(other,now);assert.equal(s.status().candidates,2);const dropped=s.db.prepare('SELECT data FROM snapshots WHERE mint=?').all(pool).map(r=>JSON.parse(r.data));assert.equal(dropped.length,6);assert.ok(dropped.every(r=>r.dropped&&r.missing.all==='QUEUE_FULL'));assert.equal(s.status().labeled,0);
}));
test('bounded disk maintenance prunes research under pressure without changing financial file',()=>withStore(async(s,conf,dir)=>{
 await writeFile(path.join(dir,'ledger.json'),'unchanged');const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let full=0;
 for(let i=0;i<2500;i++){const other='1'.repeat(30)+alphabet[Math.floor(i/58)]+alphabet[i%58];try{s.transaction(()=>s.seen({...row(now),mint:other},now));}catch{full++;s.maintain(now);}}
 s.maintain(now);assert.ok(s.status().usedBytes<conf.maxBytes);assert.ok(full>0||s.status().prunedCandidates>0);assert.equal(await readFile(path.join(dir,'ledger.json'),'utf8'),'unchanged');
},{CANDIDATE_MAX_MIB:'8'}));
test('fresh existing feed postpones public polling; absent or stale feed remains eligible',()=>withStore(async s=>{
 s.seen(row(now),now);assert.equal(s.due(now+1000).length,0);assert.equal(s.due(now+31000).length,1);s.seen(row(now+30000),now+30000);assert.equal(s.due(now+31000).length,0);
}));
test('storage-open errors disable observation without unhandled worker errors',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'observer-error-')),file=path.join(dir,'not-a-directory');await writeFile(file,'x');const messages=[];
 try{const o=new CandidateObserver(dir,{env:{CANDIDATE_OBSERVER_DIR:file},log:x=>messages.push(x)});await once(o.worker,'exit');assert.equal(o.status().workerFailed,true);assert.ok(messages.length);await o.close();}finally{await rm(dir,{recursive:true,force:true});}
});
test('CSV export cannot overwrite its source database',()=>withStore(async(s)=>{s.seen(row(now),now);await assert.rejects(exportCsv(s.file,s.file),/OVERWRITE_DATABASE/);assert.equal(s.status().candidates,1);}));
test('worker uses a single public batch and backs off on 429 without Jupiter or RPC',async()=>{
 const {Worker}=await import('node:worker_threads'),dir=await mkdtemp(path.join(os.tmpdir(),'observer-backoff-'));let o;
 try{
  const requests=[];
  o=new CandidateObserver(dir,{env:{CANDIDATE_OBSERVER_DIR:dir},log:()=>{},workerFactory:(url,options)=>new Worker(`const {parentPort}=await import('node:worker_threads');globalThis.fetch=async url=>{parentPort.postMessage({testRequest:String(url)});return new Response('limited',{status:429,headers:{'retry-after':'60'}});};await import(${JSON.stringify(url.href)});`,{...options,eval:true})});
  const first=new Promise(resolve=>o.worker.on('message',m=>{if(m.testRequest){requests.push(m.testRequest);resolve();}}));
  o.ids([{mint},{mint:pool}]);await first;await new Promise(r=>setTimeout(r,1250));assert.equal(requests.length,1);assert.ok(requests[0].startsWith('https://api.dexscreener.com/latest/dex/tokens/'));assert.equal(requests[0].split('/').at(-1).split(',').length,2);assert.doesNotMatch(requests.join(' '),/jupiter|helius|mainnet-beta/);
 }finally{await o?.close();await rm(dir,{recursive:true,force:true});}
});
test('active trading defers observer networking and aborts an in-flight background read',async()=>{
 const {Worker}=await import('node:worker_threads'),dir=await mkdtemp(path.join(os.tmpdir(),'observer-priority-'));let o;
 try{
  let requests=0,aborted=false,resolveRequest;const requested=new Promise(r=>resolveRequest=r);
  o=new CandidateObserver(dir,{env:{CANDIDATE_OBSERVER_DIR:dir},log:()=>{},workerFactory:(url,options)=>new Worker(`const {parentPort}=await import('node:worker_threads');globalThis.fetch=(url,{signal})=>{parentPort.postMessage({testRequest:true});return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{parentPort.postMessage({testAbort:true});reject(Error('aborted'));},{once:true}));};await import(${JSON.stringify(url.href)});`,{...options,eval:true})});
  o.worker.on('message',m=>{if(m.testRequest){requests++;resolveRequest();}if(m.testAbort)aborted=true;});
  o.enqueue({kind:'load',row:{busy:true}});o.ids([{mint}]);await new Promise(r=>setTimeout(r,1250));assert.equal(requests,0);
  o.enqueue({kind:'load',row:{busy:false}});o.drain();await requested;o.enqueue({kind:'load',row:{busy:true}});o.drain();await new Promise(r=>setTimeout(r,100));assert.equal(aborted,true);
 }finally{await o?.close();await rm(dir,{recursive:true,force:true});}
});
test('low disk reserve prunes only observation data',()=>withStore(async s=>{
 s.seen(row(now),now);const free=s.freeBytes();s.config.minFreeBytes=free+1;s.maintain(now);assert.equal(s.status().candidates,0);assert.ok(s.status().minFreeBytes>0);
}));

test('rate-limit codes identify provider only when source is known',()=>{
 assert.equal(decisionCode({code:'quote_rate_limited',quoteAttempts:[{source:'jupiter'}]}),'JUPITER_429');
 assert.equal(decisionCode({code:'quote_rate_limited',quoteAttempts:[{source:'pumpfun-sdk'}]}),'PUMPFUN_RATE_LIMIT');
 assert.equal(decisionCode({code:'quote_rate_limited'}),'PROVIDER_RATE_LIMIT');
});
test('free-tier defaults cap research and delete completed raw path only after label commit',()=>withStore(async(s,conf)=>{
 assert.equal(conf.retentionDays,3);assert.equal(conf.maxBytes,32*1048576);assert.equal(conf.deleteRawAfterLabel,true);
 s.transaction(()=>{for(let i=0;i<=120;i++)s.seen(row(now+i*30000,i===30?1.5:1),now+i*30000);});
 assert.ok(s.db.prepare('SELECT count(*) AS n FROM samples').get().n>0);
 s.transaction(()=>s.expire(now+3621000));assert.equal(s.db.prepare('SELECT count(*) AS n FROM samples').get().n,0);assert.equal(s.status().snapshots,6);assert.equal(s.status().labeled,1);assert.ok(s.status().rawSamplesDeleted>0);assert.equal(analyze(s.file).counts.WIN,1);
}));
test('raw path cleanup can be disabled while retention remains enforced',()=>withStore(async(s)=>{
 s.transaction(()=>{for(let i=0;i<=120;i++)s.seen(row(now+i*30000),now+i*30000);s.expire(now+3621000);});
 assert.ok(s.db.prepare('SELECT count(*) AS n FROM samples').get().n>0);assert.equal(s.status().labeled,1);s.maintain(now+4*86400000);assert.equal(s.status().candidates,0);
},{CANDIDATE_DELETE_RAW_AFTER_LABEL:'false'}));
test('restart cleanup purges previously completed raw paths without deleting snapshots or labels',()=>withStore(async(s,conf)=>{
 s.config.deleteRawAfterLabel=false;s.transaction(()=>{for(let i=0;i<=120;i++)s.seen(row(now+i*30000),now+i*30000);s.expire(now+3621000);});assert.ok(s.db.prepare('SELECT count(*) AS n FROM samples').get().n>0);
 s.close();const restarted=new CandidateStore({...conf,deleteRawAfterLabel:true});try{assert.equal(restarted.db.prepare('SELECT count(*) AS n FROM samples').get().n,0);assert.equal(restarted.status().labeled,1);assert.equal(restarted.status().snapshots,6);}finally{restarted.close();}
}));
test('periodic cleanup returns freed raw-sample pages to disk',()=>withStore(async(s)=>{
 for(let n=0;n<20;n++){const other='1'.repeat(31)+'123456789ABCDEFGHJKLM'[n];s.transaction(()=>{for(let i=0;i<=120;i++)s.seen({...row(now+i*30000),mint:other},now+i*30000);});}
 const before=s.status().usedBytes;s.transaction(()=>s.expire(now+3621000));s.maintain(now+3622000);assert.ok(s.status().usedBytes<before);assert.equal(s.status().labeled,20);assert.equal(s.status().snapshots,120);
}));
test('failed label transaction preserves raw samples and cleanup counters',()=>withStore(async(s)=>{
 s.seen(row(now),now);const before=s.db.prepare('SELECT count(*) AS n FROM samples').get().n;
 assert.throws(()=>s.transaction(()=>{s.finish(mint,now+3600000);throw Error('simulated write failure');}),/simulated write failure/);
 assert.equal(s.status().labeled,0);assert.equal(s.status().rawSamplesDeleted,0);assert.equal(s.db.prepare('SELECT count(*) AS n FROM samples').get().n,before);
}));
