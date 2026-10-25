import test from 'node:test';import assert from 'node:assert/strict';
import {aiMarketEligible,aiMarketCap} from '../src/autonomous-policy.js';
import {createModelContext,modelMessages} from '../src/paper-model-context.js';
import {ACTIVE_BOT_CONFIGS} from '../src/paper-bot-config.js';
import {initialBotState} from '../src/paper-bot-state.js';
import {AutomaticTreasury} from '../src/automatic-treasury.js';
test('live targets use actual MC strictly between $2k and $20k and a positive short-term move; FDV is not market cap',()=>{
 const now=Date.now(),market=(mint,cap,gain=20)=>({mint,pairAddress:mint+'-pool',dexId:'pumpswap',priceUsd:.001,updatedAt:now,marketCapUsd:cap,change5mPct:gain,volume5mUsd:1000});
 for(const cap of [1999,2000,20000,20001,null,NaN])assert.equal(aiMarketEligible(market('x',cap)),false);
 assert.equal(aiMarketEligible(market('x',2001)),true);assert.equal(aiMarketEligible(market('x',19999)),true);assert.equal(aiMarketEligible(market('x',10000,-5)),false);assert.equal(aiMarketEligible(market('x',10000,null)),false);
 const fdv={...market('fdv',null),valuationUsd:8000,valuationSource:'pump-fdv'};assert.equal(aiMarketCap(fdv),null);
 const c=ACTIVE_BOT_CONFIGS[0],s={...initialBotState(c),mode:'live',aiOnly:true,liveSpendableSol:.1,liveBookAt:now,positions:[{paperPositionId:'held',mint:'outside',pairAddress:'outside-pool',rawQuantity:'10',quantity:10,costSol:.1,openedAt:now}]};
 const context=createModelContext(c,s,{snapshotId:'snapshot',solUsd:100,markets:[market('allowed',8000),market('too-large',50000),market('too-small',1999),fdv,market('outside',50000)]},now);
 assert.deepEqual(context.candidates.map(m=>m.mint),['allowed']);assert.equal(context.positions[0].mint,'outside','existing holdings remain sellable outside the new entry universe');assert.deepEqual(context.limits.targetMarketCapUsd,{minExclusive:2000,maxExclusive:20000});assert.match(modelMessages(context)[0].content,/strong, sustained short-term upward impulse/);
});
test('parent uses its own fresh cap/momentum, rechecks immediately before signing, and never applies entry bounds to SELL',async()=>{
 const now=Date.now(),input={id:'live:kade:entry',side:'BUY',mint:'token',pairAddress:'pool'},spoof={mint:'token',pairAddress:'pool',marketCapUsd:10000,change5mPct:20,updatedAt:now};let current={...spoof,marketCapUsd:25000};
 const tr=new AutomaticTreasury('/tmp/no-io-for-target-test',{}, {clock:()=>now,signerEnv:{},marketSnapshot:()=>({markets:[current]})});tr.s={orders:{}};
 await assert.rejects(tr.execute(input,spoof,'kade'),{code:'LIVE_AI_TARGET_MARKET'});
 current={...spoof,marketObservedAt:now-5001};await assert.rejects(tr.execute(input,spoof,'kade'),{code:'LIVE_AI_MARKET_STALE'});
 current={...spoof};await assert.rejects(tr.execute(input,spoof,'kade'),{code:'LIVE_SIGNER_LOCKED'});
 current={...spoof,marketCapUsd:22000};await assert.rejects(tr.authorizePrepared(input,{}),{code:'LIVE_AI_TARGET_MARKET'});
 await assert.rejects(tr.execute({...input,side:'SELL'},spoof,'kade'),{code:'LIVE_SIGNER_LOCKED'});
});
