import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ModelBotRuntime} from '../src/paper-model-runtime.js';
import {BOT_CONFIGS,FILL_MODEL} from '../src/paper-bot-config.js';
import {initialBotState} from '../src/paper-bot-state.js';
import {tenMarket,TEN_AT} from './fixtures/ten-market.js';
const hold={action:'HOLD',mint:null,order_sol:null,sell_percent:null,confidence:.5,reason:'Đứng ngoài'};
function setup({decide,positions=[]}={}){
 let now=TEN_AT;const config=BOT_CONFIGS[0],state=initialBotState(config,now);state.positions=positions;state.nextAt=0;
 const runtime=new ModelBotRuntime(config,state,{ai:{enabled:true,pollMs:30000,name:'test-model'},decide:async ctx=>{const decision=await (decide?.(ctx)??hold);return {decision,modelName:'test-model',expiresAt:ctx.asOf+30000};},execute:async input=>({quote:{mint:input.mint,side:input.side,inAmount:input.amount,outAmount:input.side==='BUY'?String(Math.floor(Number(input.amount)/1e9/1.005*1e6)):String(BigInt(input.amount)*1005n),checkedAt:now},roundTripLossPct:1,quoteSource:'model',decimals:6,observedNow:now})});state.ai.nextAt=0;
 const snapshot=()=>{const m=tenMarket('nova',now);delete m.strategyData;m.change5mPct=-1;return {snapshotId:'snapshot-'+now,timestamp:now,solUsd:100,markets:[m]};};
 return {runtime,state,snapshot,advance:ms=>now+=ms,now:()=>now};
}
async function receive(x){await x.runtime.tick(x.snapshot(),x.now());await x.runtime.modelTask;x.state.nextAt=0;x.advance(1000);await x.runtime.tick(x.snapshot(),x.now());}
test('AI chooses its own BUY despite missing M1/rule signal, sizes within own wallet and fills only after delay',async()=>{
 const x=setup({decide:ctx=>({action:'BUY',mint:ctx.candidates[0].mint,order_sol:.025,sell_percent:null,confidence:.7,reason:'AI chọn từ dữ liệu có thật'})});await receive(x);assert.equal(x.state.pending.side,'BUY');assert.equal(x.state.pending.decisionEngine,'model');assert.equal(x.state.trades.length,0);x.advance(2000);await x.runtime.tick(x.snapshot(),x.now());assert.equal(x.state.positions.length,1);assert.equal(x.state.positions[0].controlMode,'model');assert.equal(x.state.trades[0].decisionEngine,'model');assert.equal(x.state.trades[0].modelName,'test-model');assert.ok(x.state.cashSol<2&&x.state.cashSol>1.9);
});
test('API error or HOLD never falls through to an automatic rule BUY',async()=>{
 for(const decide of [()=>{throw Object.assign(Error('MODEL_HTTP_429'),{code:'MODEL_HTTP_429'});},()=>hold]){const x=setup({decide});await receive(x);assert.equal(x.state.pending,null);assert.equal(x.state.positions.length,0);assert.equal(x.state.decisionEngine,'model');assert.ok(x.state.decisions.some(d=>d.action==='WAIT'||d.action==='HOLD'));}
});
test('expired response and a changed own balance are rejected without creating an order',async()=>{
 for(const changed of ['clock','wallet']){const x=setup({decide:ctx=>({action:'BUY',mint:ctx.candidates[0].mint,order_sol:.025,sell_percent:null,confidence:.5,reason:'Mua'})});await x.runtime.tick(x.snapshot(),x.now());await x.runtime.modelTask;if(changed==='clock')x.advance(31000);else{x.advance(1000);x.state.cashSol=1.9;}x.state.nextAt=0;await x.runtime.tick(x.snapshot(),x.now());assert.equal(x.state.pending,null);assert.ok(x.state.ai.history.some(d=>!d.applied&&d.reason===(changed==='clock'?'MODEL_DECISION_EXPIRED':'MODEL_WALLET_CHANGED')));await x.runtime.modelTask;}
});
function position(){return {mint:'token-nova',pairAddress:'pool-nova',symbol:'NOVA',agentId:'nova',paperPositionId:'owned',quantity:.05,rawQuantity:'50000',decimals:6,costSol:.05,initialCostSol:.05,openedAt:TEN_AT-1000,rentSol:FILL_MODEL.rentSol,realizedPnlSol:0,controlMode:'model',exitPolicy:BOT_CONFIGS[0].exitPolicy};}
test('model inference does not block protective SELL monitoring when the price collapses',async()=>{
 let resolve;const x=setup({positions:[position()],decide:()=>new Promise(r=>resolve=r)});await x.runtime.tick(x.snapshot(),x.now());await Promise.resolve();assert.ok(x.runtime.modelTask);x.advance(1000);const snap=x.snapshot();snap.markets[0].spotPriceSol=.1;snap.markets[0].priceAt=x.now();await x.runtime.tick(snap,x.now());assert.equal(x.state.pending.side,'SELL');assert.equal(x.state.pending.reason,'stop-loss');assert.equal(x.state.pending.decisionEngine,'model-safety');resolve(hold);await x.runtime.modelTask;
});
test('AI can sell a fraction of its own position even when BUY is paused',async()=>{
 const x=setup({positions:[position()],decide:()=>({action:'SELL',mint:'token-nova',order_sol:null,sell_percent:50,confidence:.8,reason:'Giảm vị thế'})});x.state.running=false;await receive(x);assert.equal(x.state.pending.side,'SELL');assert.equal(x.state.pending.amount,'25000');assert.equal(x.state.pending.positionId,'owned');x.advance(2000);await x.runtime.tick(x.snapshot(),x.now());assert.equal(x.state.positions[0].rawQuantity,'25000');assert.equal(x.state.trades[0].side,'SELL');
});
test('AI HOLD at a large profit cannot mask the maximum holding time or liquidity emergency',async()=>{
 for(const emergency of [false,true]){const p=position();if(!emergency)p.openedAt=TEN_AT-p.exitPolicy.maxHoldMs;else p.peakLiquidityUsd=100000;const x=setup({positions:[p]});const snap=x.snapshot();snap.markets[0].spotPriceSol=5;snap.markets[0].priceAt=x.now();if(emergency)snap.markets[0].liquidityUsd=10000;await x.runtime.tick(snap,x.now());assert.equal(x.state.pending.reason,emergency?'emergency-risk':'scalp-max-hold');}
});
test('restart keeps model intents and open wallets; lost API key requires explicit rules mode to switch back',()=>{
 const state=initialBotState(BOT_CONFIGS[0],TEN_AT);state.cashSol=1.8;state.ai={wasEnabled:true,history:[]};state.pending={id:'owned-ai-buy',side:'BUY',decisionEngine:'model'};
 const runtime=new ModelBotRuntime(BOT_CONFIGS[0],state,{ai:{enabled:false}});assert.equal(runtime.aiConfig.enabled,true);assert.equal(state.cashSol,1.8);assert.equal(state.pending.id,'owned-ai-buy');const rules=new ModelBotRuntime(BOT_CONFIGS[0],state,{ai:{enabled:false,explicitRulesMode:true}});assert.equal(rules.aiConfig.enabled,false);assert.equal(state.decisionEngine,'rules');
});
