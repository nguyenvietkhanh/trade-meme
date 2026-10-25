import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveModelBotRuntime} from '../src/live-model-runtime.js';
import {initialBotState} from '../src/paper-bot-state.js';
import {ACTIVE_BOT_CONFIGS} from '../src/paper-bot-config.js';
test('restored signed intent polls without a market listing, ignores BUY age expiry, clears only on terminal receipt, and retains polling interval',async()=>{
 const now=Date.now(),config=ACTIVE_BOT_CONFIGS[0],pending={id:'live:kade:old:1',side:'BUY',mint:'existing-mint',pairAddress:'existing-pool',amount:'50000000',decisionAt:now-60000,readyAt:now-1000,signature:'already-signed'},state={...initialBotState(config,now),mode:'live',initialSol:0,cashSol:1,livePending:pending,running:false,nextAt:now+100000,ai:{wasEnabled:true,nextAt:now+100000}};let calls=0,terminal=false;
 const runtime=new LiveModelBotRuntime(config,state,{ai:{name:'fixture',enabled:true},execute:async input=>{calls++;assert.equal(input.id,pending.id);return {terminal,status:terminal?'confirmed':'unknown',view:{id:'kade',livePending:terminal?null:pending}};}});
 const snapshot={snapshotId:'removed-token',markets:[],solUsd:100,timestamp:now};await runtime.tick(snapshot,now);assert.equal(calls,1);assert.equal(state.pending.wasSubmitted,true);await runtime.tick(snapshot,now+250);assert.equal(calls,1,'book must not reset backoff every tick');terminal=true;state.livePending=null;await runtime.tick(snapshot,now+2000);assert.equal(calls,2);assert.equal(state.pending,null);assert.equal(state.trades.length,0,'worker never fabricates a receipt or adjusts money');
});
test('liquidity protection survives replacement by authoritative financial books; trigger contains no paper haircut',()=>{
 const now=Date.now(),config=ACTIVE_BOT_CONFIGS[0],p={agentId:'kade',paperPositionId:'live:kade:position',mint:'mint',pairAddress:'pool',rawQuantity:'1000000',quantity:1,costSol:1,initialCostSol:1,openedAt:now-1000,controlMode:'model',exitPolicy:config.exitPolicy},state={...initialBotState(config,now),mode:'live',initialSol:0,cashSol:1,positions:[structuredClone(p)],nextAt:now+100000,ai:{wasEnabled:true,nextAt:now+100000}};
 const runtime=new LiveModelBotRuntime(config,state,{ai:{enabled:true}}),snapshot={markets:[{mint:'mint',pairAddress:'pool',spotPriceSol:1.1,priceAt:now,liquidityUsd:100000}],solUsd:100};runtime.monitor(snapshot,now);assert.equal(state.pending,null);state.positions=[structuredClone(p)];snapshot.markets[0].liquidityUsd=50000;runtime.monitor(snapshot,now);assert.equal(state.pending.side,'SELL');assert.equal(state.pending.reason,'emergency-risk');
});
