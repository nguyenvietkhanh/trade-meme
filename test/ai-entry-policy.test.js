import test from 'node:test';import assert from 'node:assert/strict';
import {aiMarketEligible,aiMarketCap} from '../src/autonomous-policy.js';
import {createModelContext,modelMessages,validateModelDecision} from '../src/paper-model-context.js';
import {ACTIVE_BOT_CONFIGS} from '../src/paper-bot-config.js';
import {initialBotState} from '../src/paper-bot-state.js';
import {AutomaticTreasury} from '../src/automatic-treasury.js';
const risk={approved:true,reason:'Adequate observed liquidity for this size; concentration remains unknown',risks:['volatile'],unknowns:['holder concentration']};
test('AI sees rising tokens across all market caps, including unknown cap; market cap never blocks entry',()=>{
 const now=Date.now(),market=(mint,cap,gain=20)=>({mint,pairAddress:mint+'-pool',dexId:'pumpswap',priceUsd:.001,updatedAt:now,marketCapUsd:cap,change5mPct:gain,volume5mUsd:1000});
 for(const cap of [1999,2000,20000,20001,5e9,null,NaN])assert.equal(aiMarketEligible(market('x',cap)),true);
 for(const gain of [-5,0,null,NaN])assert.equal(aiMarketEligible(market('x',10000,gain)),false);
 const fdv={...market('fdv',null),valuationUsd:8000,valuationSource:'pump-fdv'};assert.equal(aiMarketCap(fdv),null);
 const c=ACTIVE_BOT_CONFIGS[0],s={...initialBotState(c),mode:'live',aiOnly:true,liveSpendableSol:.1,liveBookAt:now,positions:[]};
 const context=createModelContext(c,s,{snapshotId:'snapshot',solUsd:100,markets:[market('large',5e9),market('small',1999),fdv]},now);
 assert.deepEqual(context.candidates.map(m=>m.mint).sort(),['fdv','large','small']);assert.equal(context.limits.targetMarketCapUsd,null);assert.equal(context.limits.requiresAIRiskAssessment,true);assert.match(modelMessages(context)[0].content,/NO fixed minimum or maximum market capitalization/);
});
test('parent rechecks fresh momentum before signing without a cap limit and never applies entry signals to SELL',async()=>{
 const now=Date.now(),input={id:'live:kade:entry',side:'BUY',mint:'token',pairAddress:'pool'},market={mint:'token',pairAddress:'pool',marketCapUsd:1e9,change5mPct:20,updatedAt:now};let current={...market,change5mPct:-1};
 const tr=new AutomaticTreasury('/tmp/no-io-for-target-test',{}, {clock:()=>now,signerEnv:{},marketSnapshot:()=>({markets:[current]})});tr.s={orders:{}};
 await assert.rejects(tr.execute(input,market,'kade'),{code:'LIVE_AI_TARGET_MARKET'});
 current={...market,marketObservedAt:now-5001};await assert.rejects(tr.execute(input,market,'kade'),{code:'LIVE_AI_MARKET_STALE'});
 current={...market};await assert.rejects(tr.execute(input,market,'kade'),{code:'LIVE_SIGNER_LOCKED'});
 current={...market,change5mPct:-1};await assert.rejects(tr.authorizePrepared(input,{}),{code:'LIVE_AI_TARGET_MARKET'});
 await assert.rejects(tr.execute({...input,side:'SELL'},market,'kade'),{code:'LIVE_SIGNER_LOCKED'});
});
test('BUY needs AI risk acceptance plus an SL; rejection/unknown/missing assessment never becomes a buy',()=>{
 const context={aiOnly:true,wallet:{running:true},positions:[],candidates:[{mint:'token'}],limits:{minOrderSol:.0025,maxOrderSol:.1,maxPositions:100}},buy={action:'BUY',mint:'token',order_sol:.01,sell_percent:null,stop_loss_pct:12,confidence:.6,reason:'Evidence supports a small trade'};
 for(const assessment of [null,{...risk,approved:false},{approved:true},{...risk,reason:''}])assert.throws(()=>validateModelDecision({...buy,risk_assessment:assessment},context),{code:'MODEL_INVALID_DECISION'});
 assert.throws(()=>validateModelDecision({...buy,stop_loss_pct:null,risk_assessment:risk},context),{code:'MODEL_INVALID_DECISION'});assert.deepEqual(validateModelDecision({...buy,risk_assessment:risk},context).risk_assessment,risk);
 const tr=new AutomaticTreasury('/tmp/no-io-risk-test',{}, {signerEnv:{}});tr.s={orders:{}};assert.throws(()=>tr.request({id:'new',side:'BUY',aiStopLossPct:12},{},'kade'),{code:'LIVE_AI_RISK_ASSESSMENT_REQUIRED'});
});
