import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {SCAN_RULES,initializeScanner,scannerMarkets,recordEvaluation} from '../src/scanner.js';
import {freshState} from '../src/engine.js';
import {rankMarket} from '../src/strategy.js';
import {verifiedMarket} from './fixtures/verified-market.js';
import {createOwnerLedger,nextOwnerOrder,applyOwnerReceipt} from '../src/owner-ledger.js';

test('a token rejected on the previous scan can qualify five seconds later despite a legacy cooldown',()=>{
 const now=Date.now(),s=freshState(now),m=verifiedMarket({},now);
 s.coarseCooldowns={[m.mint]:now+1800000};
 const bad=scannerMarkets(s,[{...m,valuationUsd:2999,coarseCooldownUntil:now+1800000}])[0];
 assert.ok(rankMarket(bad,undefined,now).red_flags.includes('MARKET_CAP_TOO_LOW'));
 assert.equal(s.coarseCooldowns,undefined);assert.equal(bad.coarseCooldownUntil,undefined);
 const recovered=scannerMarkets(s,[verifiedMarket({coarseCooldownUntil:now+1800000},now+5000)])[0];
 assert.equal(rankMarket(recovered,undefined,now+5000).eligible,true);
 const unsafe={...recovered,evidence:{...recovered.evidence,lpSecuredPct:89}};
 assert.equal(rankMarket(unsafe,undefined,now+5000).eligible,false);
});

test('ten thousand evaluations clear the scan display without clearing any trading protection or pending order',()=>{
 const now=Date.now(),s=freshState(now);
 s.positions=[{mint:'held'}];s.trades=[{signature:'confirmed'}];s.pending={signature:'uncertain'};
 s.cooldowns={stopped:now+86400000};s.blacklistedMints={fake:true};s.observations={held:[{at:now}]};
 s.halted='risk limit';s.dailyLossBlocked=true;s.lossPauseUntil=now+7200000;s.orderAttempts={held:4};
 s.decisionStats={evaluated:9999,rejected:9998,bought:3};s.decisions=[{reason:'previous cycle'}];
 const protectedState=structuredClone(s);delete protectedState.decisionStats;delete protectedState.decisions;
 recordEvaluation(s,{at:now,action:'SKIP',mint:'candidate'});
 assert.deepEqual(s.decisionStats,{evaluated:0,rejected:0,bought:3,totalEvaluated:10000,cycle:2,resetAt:now});
 assert.deepEqual(s.decisions,[]);
 const after=structuredClone(s);delete after.decisionStats;delete after.decisions;assert.deepEqual(after,protectedState);
 recordEvaluation(s,{at:now+5000,action:'WATCH',mint:'next'});
 assert.equal(s.decisionStats.evaluated,1);assert.equal(s.decisionStats.totalEvaluated,10001);assert.equal(s.decisions[0].mint,'next');
});

test('old persisted oversized counters reset once; the impersonation blacklist survives a rename',()=>{
 const s=freshState(),m=verifiedMarket();s.decisionStats.evaluated=25000;
 initializeScanner(s);initializeScanner(s);assert.equal(s.decisionStats.cycle,2);assert.equal(s.decisionStats.totalEvaluated,25000);
 const fake=scannerMarkets(s,[{...m,symbol:'BONK'}])[0];assert.equal(fake.blacklisted,true);
 const renamed=scannerMarkets(s,[{...m,symbol:'INNOCENT'}])[0];assert.equal(rankMarket(renamed).eligible,false);
});

test('scan rollover leaves an eligible autonomous BUY and subsequent risk SELL executable',()=>{
 const now=Date.now(),ledger=createOwnerLedger('owner',.3),scan=freshState(now),m=verifiedMarket({priceUsd:1},now);
 scan.decisionStats.evaluated=9999;recordEvaluation(scan,{at:now,action:'WATCH',mint:m.mint});
 const market=scannerMarkets(scan,[{...m,coarseCooldownUntil:now+1800000}])[0],feed={markets:[market],solUsd:100,updatedAt:now};
 const buy=nextOwnerOrder(ledger,feed,.3);assert.equal(buy.side,'BUY');assert.equal(buy.orderSol,.195);
 applyOwnerReceipt(ledger,{intent:{...buy,solUsd:100,priceUsd:1}},{status:'confirmed',signature:'buy-fixture',tokenDelta:'19500000',solDelta:-.19502,decimals:6,feeSol:.00002});
 const exit={...market,exitQuote:{mint:m.mint,rawAmount:'19500000',checkedAt:Date.now(),netSol:.15}};
 const sell=nextOwnerOrder(ledger,{...feed,markets:[exit]},.10498);assert.equal(sell.side,'SELL');assert.equal(sell.reason,'stop-loss');
 assert.equal(sell.amount,'19500000');assert.equal(ledger.positions.length,1,'SELL is only an intent until its receipt confirms');
 applyOwnerReceipt(ledger,{intent:{...sell,solUsd:100,priceUsd:.795}},{status:'confirmed',signature:'sell-fixture',tokenDelta:'-19500000',solDelta:.15,decimals:6,feeSol:.00002});
 assert.equal(ledger.positions.length,0);assert.ok(ledger.cooldowns[m.mint]>now+86399000);
});

test('HTTP scanner clears persisted 30-minute waits and the 10,000 counter, then refreshes again in five seconds',async()=>{
 const dir=await mkdtemp('/tmp/meme-scan-'),saved=freshState();
 saved.coarseCooldowns={EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:Date.now()+1800000};
 saved.decisionStats={evaluated:9999,rejected:9999,bought:0};saved.decisions=[{reason:'old cycle'}];
 await writeFile(dir+'/scanner-state.json',JSON.stringify(saved));
 const child=spawn(process.execPath,['--import','./test/fixtures/scanner-feed.js','src/mainnet-server.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,PAPER_WORKSPACE:'false',SIGNER_MODE:'disabled',HOST:'127.0.0.1',PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
 let output='',errors='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>errors+=c);
 try{
  let base;for(let n=0;n<150;n++){const port=output.match(/127\.0\.0\.1:(\d+)/)?.[1];if(port){base='http://127.0.0.1:'+port;break;}if(child.exitCode!==null)throw Error(errors);await delay(20);}assert.ok(base);
  let first;for(let n=0;n<100;n++){first=await(await fetch(base+'/api/state')).json();if(first.feed.updatedAt)break;await delay(20);}
  assert.ok(first.feed.updatedAt);assert.equal(first.decisionStats.evaluated,0);assert.equal(first.decisionStats.cycle,2);assert.deepEqual(first.decisions,[]);
  assert.equal(first.diagnostics.scanIntervalMs,SCAN_RULES.intervalMs);assert.equal(first.diagnostics.scanCycleLimit,10000);
  assert.equal(first.rankings.some(m=>m.red_flags.includes('COARSE_COOLDOWN')),false);
  const disk=JSON.parse(await readFile(dir+'/scanner-state.json','utf8'));assert.equal(disk.coarseCooldowns,undefined);
  let next;for(let n=0;n<70;n++){await delay(100);next=await(await fetch(base+'/api/state')).json();if(next.feed.updatedAt>first.feed.updatedAt)break;}
  assert.ok(next.feed.updatedAt>first.feed.updatedAt,'a second scan must occur, including when signer mode is disabled');
  assert.ok(next.feed.updatedAt-first.feed.updatedAt>=4500);assert.ok(next.feed.updatedAt-first.feed.updatedAt<7000);
  assert.equal(next.decisionStats.evaluated,1);assert.equal(next.decisionStats.totalEvaluated,10001);
  assert.equal(next.cashSol,null,'scanner counters must not disclose owner funds');
 }finally{if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;}await rm(dir,{recursive:true,force:true});}
});
