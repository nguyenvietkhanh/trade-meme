import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fourHourRisk,fetchStructure} from '../src/candles.js';
import {rankMarket,coarseMarket} from '../src/strategy.js';
import {observeMarkets} from '../src/signals.js';
import {freshState,recordBuy} from '../src/engine.js';
import {createOwnerLedger,nextOwnerOrder} from '../src/owner-ledger.js';
import {VerificationFeed} from '../src/verification.js';
import {verifiedMarket} from './fixtures/verified-market.js';
const bucket=Math.floor(Date.now()/14400000)*14400000,now=bucket+3600000,created=now-1200000;
const bar=(open,high,low,close,start=bucket)=>[start/1000,open,high,low,close,100];

test('market cap floor is 3000 and a rising 3k candidate still needs all safety conditions',()=>{
 const m=verifiedMarket({valuationUsd:3000},now);assert.equal(rankMarket(m,undefined,now).eligible,true);
 assert.equal(coarseMarket({...m,valuationUsd:2999.99},undefined,now).eligible,false);
 for(const changes of [{change5mPct:0},{change5mPct:-1},{change1hPct:0},{change1hPct:-30}])assert.ok(rankMarket({...m,...changes},undefined,now).red_flags.includes('NO_UPTREND'));
 assert.equal(rankMarket({...m,evidence:{...m.evidence,lpSecuredPct:89}},undefined,now).eligible,false);
});

test('H4 rejects a plunge, pump with a long upper wick and a weak bounce below a prior rejection',()=>{
 assert.ok(fourHourRisk([bar(100,105,70,75)],75,created,now).reasons.includes('H4_BEARISH_BODY'));
 const spike=fourHourRisk([bar(100,400,90,110)],110,created,now);assert.equal(spike.state,'reject');assert.ok(spike.reasons.includes('H4_PUMP_REJECTION'));
 const bounce=fourHourRisk([bar(100,400,70,80,bucket-14400000),bar(80,95,78,90)],90,bucket-18000000,now);assert.ok(bounce.reasons.includes('H4_PREVIOUS_REJECTION'));
});

test('a healthy forming H4 candle can pass without requiring four hours of pool history',()=>{
 assert.equal(fourHourRisk([bar(100,120,95,115)],115,created,now).state,'clear');
 assert.equal(fourHourRisk([bar(100,180,95,145)],145,created,now).state,'clear');
 assert.equal(fourHourRisk([bar(100,120,95,115)],115,now-600000,now).state,'unknown');
 for(const rows of [[],[bar(100,90,95,110)],[bar(100,120,95,110),bar(100,120,95,110)],[bar(100,120,95,110,bucket-28800000)]])assert.equal(fourHourRisk(rows,110,created,now).state,'unknown');
});

test('known bearish H4 cannot be overridden by a high score; unavailable H4 reduces size, never creates a safe flag',()=>{
 const m=verifiedMarket({},now),risk={mint:m.mint,pairAddress:m.pairAddress,checkedAt:now,state:'reject'};
 const blocked=rankMarket({...m,evidence:{...m.evidence,h4Risk:risk}},undefined,now);assert.ok(blocked.score>=75);assert.equal(blocked.eligible,false);assert.ok(blocked.red_flags.includes('H4_DUMP_PATTERN'));
 const unknown=rankMarket({...m,evidence:{...m.evidence,h4Risk:undefined}},undefined,now);assert.equal(unknown.eligible,true);assert.equal(unknown.orderSol,.02);assert.equal(unknown.h4Status,'unknown');assert.equal(unknown.h4Penalty,5);
 const stale=rankMarket({...m,evidence:{...m.evidence,h4Risk:{...risk,checkedAt:now-60001}}},undefined,now);assert.equal(stale.eligible,false,'an outage must not clear a recent rejection');
 const mismatched=rankMarket({...m,evidence:{...m.evidence,h4Risk:{...risk,mint:'other'}}},undefined,now);assert.equal(mismatched.h4Status,'unknown');
});

test('the example mint is excluded from BUY without preventing management of an existing position',()=>{
 const mint='6JVe4NQPab3NkKxE6vaKcEiJVsz8hpSZYvdHh54hpump',m=verifiedMarket({mint},Date.now()),s=createOwnerLedger('owner',.3);
 assert.ok(rankMarket(m).red_flags.includes('OWNER_EXCLUDED_MINT'));
 recordBuy(s,m,100,{quantity:3,costSol:.03,priceUsd:1,rawQuantity:'3000000',decimals:6},Date.now()-21600001,'fixture','live');
 assert.equal(nextOwnerOrder(s,{markets:[m],solUsd:100,updatedAt:Date.now()},.27).side,'SELL');
});

test('two observations require positive M5/H1 and cannot confirm a falling spot price',()=>{
 const s=freshState(now),m=verifiedMarket({priceUsd:1},now);observeMarkets(s,[m],now);
 assert.equal(observeMarkets(s,[{...m,priceUsd:.99}],now+10000)[0].signalConfirmed,false);
 const other=freshState(now);observeMarkets(other,[m],now);observeMarkets(other,[{...m,change1hPct:-1}],now+5000);
 assert.equal(observeMarkets(other,[m],now+10000)[0].signalConfirmed,false);
});

test('H4 adapter requests actual 4-hour candles for the same pool/base token',async t=>{
 t.mock.method(Date,'now',()=>now);const urls=[],m={mint:'token',pairAddress:'pool',priceUsd:110,pairCreatedAt:created};
 const e=await fetchStructure(m,async url=>{urls.push(new URL(url));return new Response(JSON.stringify({meta:{base:{address:m.mint}},data:{attributes:{ohlcv_list:String(url).includes('/hour?')?[bar(100,400,90,110)]:[]}}}));});
 assert.equal(e.h4Risk.state,'reject');assert.equal(e.h4Risk.mint,m.mint);assert.ok(urls.some(u=>u.pathname.endsWith('/ohlcv/hour')&&u.searchParams.get('aggregate')==='4'));
});

test('a failed H4 provider cannot clear a previously observed rejection; fresh recovery can',async t=>{
 let clock=now,phase=0;t.mock.method(Date,'now',()=>clock);
 const m=verifiedMarket({mint:'11111111111111111111111111111112',priceUsd:110,pairCreatedAt:created},now),report={mint:m.mint,token:{mintAuthority:null,freezeAuthority:null},markets:[{pubkey:m.pairAddress,lp:{lpLockedPct:95}}],risks:[]};
 const v=new VerificationFeed(async url=>{
  if(String(url).includes('rugcheck'))return new Response(JSON.stringify(report));
  if(phase===1)return new Response('{}',{status:503});
  return new Response(JSON.stringify({meta:{base:{address:m.mint}},data:{attributes:{ohlcv_list:String(url).includes('/hour?')?[phase===0?bar(100,400,90,110):bar(100,120,95,110)]:[]}}}));
 },{inspectMarket:async()=>m.evidence});
 const run=async()=>{const [out]=await v.enrich([{...m,evidence:undefined,updatedAt:clock}],[],clock);return rankMarket(out,undefined,clock);};
 assert.equal((await run()).h4Status,'reject');clock+=20001;phase=1;assert.equal((await run()).h4Status,'reject');clock+=20001;phase=2;assert.equal((await run()).h4Status,'clear');
});

test('a young or undated pool with unavailable H4 remains eligible at reduced size when trend and mandatory safety pass',()=>{
 for(const pairCreatedAt of [now-1000,undefined,null,0]){
  const m=verifiedMarket({pairCreatedAt},now),h4Risk={...fourHourRisk([bar(100,120,95,115)],115,pairCreatedAt,now),mint:m.mint,pairAddress:m.pairAddress};
  assert.equal(h4Risk.state,'unknown');const rank=rankMarket({...m,evidence:{...m.evidence,h4Risk}},undefined,now);
  assert.equal(rank.eligible,true);assert.equal(rank.orderSol,.02);assert.equal(rank.h4Status,'unknown');
 }
});
