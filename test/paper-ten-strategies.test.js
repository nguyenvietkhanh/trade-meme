import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TEN_AGENTS,tenSignal,validMinuteBars} from '../src/paper-ten-strategies.js';
import {tenMarket,tenContext,TEN_AT as now} from './fixtures/ten-market.js';
import {scalpExitPlan} from '../src/paper-scalp.js';

test('all ten uploaded strategy hypotheses have reachable entries with their own genuine data contract',()=>{
 for(const a of TEN_AGENTS){const m=tenMarket(a.id),d=tenSignal(a.id,m,now,tenContext(m));assert.equal(d.eligible,true,a.name+': '+d.reason+' '+JSON.stringify(d.rank.strategyChecks));assert.ok(d.rank.score>=a.entryRules.minScore);assert.equal(d.rank.policyVersion,'paper-ten-prompts-v1');}
 assert.deepEqual(TEN_AGENTS.map(a=>a.scanIntervalMs),[4000,5000,6000,3000,7000,5000,8000,4000,6000,10000]);assert.deepEqual(TEN_AGENTS.map(a=>a.exitPolicy.maxHoldMs/60000),[10,8,6,4,10,15,12,8,8,8]);assert.equal(TEN_AGENTS.find(a=>a.id==='zara').exitPolicy.firstSellFraction,.4);
 for(const a of TEN_AGENTS){assert.equal(a.riskPolicy.dailyLossHalt,false);assert.equal(a.riskPolicy.lossStreakHalt,false);assert.equal(a.riskPolicy.drawdownHalt,false);}
});
test('cheap strategy gates, quotes, confirmation and own cooldown have explicit SKIP reasons',()=>{
 const m=tenMarket(),ctx=tenContext(m);for(const [changes,context]of [[{liquidityUsd:2999},ctx],[{updatedAt:now-5001},ctx],[{evidence:{...m.evidence,roundTripLossPct:6.01}},ctx],[{evidence:{...m.evidence,quoteCheckedAt:now-5001}},ctx],[{},{}],[{}, {...ctx,prior:{...ctx.prior,at:now-4000}}],[{priceUsd:m.priceUsd*.99},ctx],[{liquidityUsd:m.liquidityUsd*.89},ctx],[{}, {...ctx,cooldownUntil:now+1}]])assert.equal(tenSignal('nova',{...m,...changes},now,context).eligible,false);
 const noProof=tenSignal('nova',{...m,evidence:{}},now,ctx);assert.equal(noProof.stage,'execution');assert.equal(noProof.rank.preQuoteEligible,true,'missing quote must not prevent its own fetch');
 assert.equal(tenSignal('nova',{...m,liquidityUsd:1},now,ctx).rank.roughEligible,false);
});
test('NOVA last ten transactions and ECHO unique wallets cannot be replaced by aggregate trade counts',()=>{
 for(const id of ['nova','echo']){const m=tenMarket(id);m.strategyData.flow=undefined;assert.equal(tenSignal(id,m,now,tenContext(m)).stage,'strategy-data');}
 const m=tenMarket('echo');for(const changes of [{windowComplete:false},{walletsComplete:false},{uniqueBuyers:5,uniqueSellers:5},{largestBuySharePct:26},{smallBuyFraction:.5},{mint:'wrong'},{checkedAt:now-5001}])assert.equal(tenSignal('echo',{...m,strategyData:{...m.strategyData,flow:{...m.strategyData.flow,...changes}}},now,tenContext(m)).eligible,false);
});
test('closed M1 bars enforce timestamps, identity, continuity and no forming-bar look-ahead',()=>{
 const m=tenMarket('orin'),d=m.strategyData;assert.ok(validMinuteBars(d,m,now));for(const bad of [{...d,mint:'other'}, {...d,pairAddress:'other'}, {...d,bars:d.bars.slice(0,-1)}, {...d,bars:d.bars.filter((_,i)=>i!==20)}, {...d,bars:[...d.bars,d.bars.at(-1)]}])assert.equal(validMinuteBars(bad,m,now),null);
 const forming=[Math.floor(now/60000)*60,100,500,90,400,999999];assert.equal(validMinuteBars({...d,bars:[...d.bars,forming]},m,now).length,35);const noSpike=tenMarket('orin');noSpike.strategyData.bars.at(-1)[5]=100;noSpike.strategyData.bars.push(forming);assert.equal(tenSignal('orin',noSpike,now,tenContext(noSpike)).eligible,false);
});
test('every strategy and discovery rank safely handles a fresh quote with absent or malformed optional feature payloads',()=>{
 for(const a of TEN_AGENTS)for(const payload of [{},{bars:{}},{mint:'x',bars:[]},{mint:'x',flow:{lastTen:{}}}]){const m=tenMarket(a.id);m.strategyData=payload;assert.doesNotThrow(()=>tenSignal(a.id,m,now,tenContext(m)),a.name);}
});
test('breakout, three candles, pullback, young pool and contrarian checks remain distinct',()=>{
 const bad={vela:m=>m.priceUsd=120,kade:m=>m.strategyData.bars.at(-1)[4]=102.3,rune:m=>m.priceUsd=119,zara:m=>m.pairCreatedAt=now-120000,nyx:m=>m.change1hPct=-1,atlas:m=>m.valuationUsd=49999};
 for(const [id,edit]of Object.entries(bad)){const m=tenMarket(id);edit(m);assert.equal(tenSignal(id,m,now,tenContext(m)).eligible,false,id);}
});
test('holder fields in the file are optional; observed conflicting holder evidence rejects the corresponding strategy',()=>{
 for(const id of ['zara','sage']){const m=tenMarket(id);assert.equal(tenSignal(id,m,now,tenContext(m)).eligible,true);m.strategyData.holders={mint:m.mint,pairAddress:m.pairAddress,at:now,previousAt:now-300000,current:110,previous:100,top10Pct:40};assert.equal(tenSignal(id,m,now,tenContext(m)).eligible,false);}
});
test('new exits prioritize net stop/TP/time while retaining old policy behavior and ZARA 40% first take',()=>{
 const agent=TEN_AGENTS.find(a=>a.id==='zara'),p={mint:'m',rawQuantity:'1000',quantity:1000,costSol:1,openedAt:now-1000,exitPolicy:agent.exitPolicy,entryLiquidityUsd:10000},mark={mint:'m',updatedAt:now,liquidityUsd:1,exitQuote:{mint:'m',rawAmount:'1000',checkedAt:now,netSol:.7}};assert.equal(scalpExitPlan({...p},mark,now).reason,'stop-loss');const tp=scalpExitPlan({...p},{...mark,exitQuote:{...mark.exitQuote,netSol:1.2}},now);assert.equal(tp.reason,'scalp-tp1');assert.equal(tp.fraction,.4);assert.equal(scalpExitPlan({...p,openedAt:now-agent.exitPolicy.maxHoldMs},{...mark,exitQuote:{...mark.exitQuote,netSol:1}},now).reason,'scalp-max-hold');
});
