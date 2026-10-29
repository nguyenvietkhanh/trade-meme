import test from 'node:test';import assert from 'node:assert/strict';
import {confirmEntry,validEntryConfirmation} from '../src/rules-confirmation.js';
import {entryFacts} from './fixtures/rules-confirmation.js';
import {evaluateV5,exitV5,LIVE_EXIT_V53,RULES_VERSION} from '../src/rules-v5.js';
import {RulesEvidence} from '../src/rules-evidence.js';
import {RulesRuntime} from '../src/rules-runtime.js';
import {ACTIVE_BOT_CONFIGS} from '../src/paper-bot-config.js';import {initialBotState} from '../src/paper-bot-state.js';
const at=1900000000000;
test('two source observations must actually advance, not merely the loop clock',()=>{
 const history=new Map(),c={mint:'mint',pool:'pool',solUsd:100,rawMarket:{updatedAt:at,priceUsd:100,buys5m:18,sells5m:9}};
 assert.equal(confirmEntry(history,c,{},at),null);assert.equal(confirmEntry(history,c,{},at+6000),null);
 c.rawMarket={...c.rawMarket,updatedAt:at+6000,priceUsd:101,buys5m:20,sells5m:10};const p=confirmEntry(history,c,{},at+6000);assert.ok(p);const i={token:'mint',pool:'pool',current_time_ms:at+6000,buys_5m:20,sells_5m:10,entry_confirmation:p};assert.equal(validEntryConfirmation(i),true);
 for(const change of [{pool:'other'},{current_time_ms:at+40000},{buys_5m:99},{entry_confirmation:{...p,secondAt:p.firstAt+4999}},{entry_confirmation:{...p,secondPrice:130}},{entry_confirmation:{...p,secondSells:20}}])assert.equal(validEntryConfirmation({...i,...change}),false);
});
test('break-even arms at +50%, survives serialized memory, and never upgrades an old policy implicitly',()=>{
 const p={entryPriceSol:1,openedAt:at,rulesPolicyVersion:RULES_VERSION,exitPolicy:LIVE_EXIT_V53},memory={};assert.equal(exitV5(p,1.49,at+1000,memory),null);assert.equal(memory.breakEvenArmed,false);exitV5(p,1.5,at+2000,memory);assert.equal(memory.breakEvenArmed,true);
 const restored=JSON.parse(JSON.stringify(memory));assert.equal(exitV5(p,1.01,at+3000,restored),null);assert.equal(exitV5(p,1,at+4000,restored).reason,'stop-loss');assert.equal(exitV5(p,1.1,at+5000,restored).reason,'stop-loss');
 const legacy={...p,exitPolicy:{stopLossPct:20}},old={};exitV5(legacy,1.8,at+1000,old);assert.equal(exitV5(legacy,1,at+2000,old),null);assert.equal(exitV5(legacy,.8,at+3000,old).reason,'stop-loss');
});
test('the worker restores an armed new-policy stop and queues a full protective SELL on return to entry',()=>{
 const config=ACTIVE_BOT_CONFIGS[0],p={mint:'mint',pairAddress:'pool',paperPositionId:'lot',rulesPolicyVersion:RULES_VERSION,exitPolicy:LIVE_EXIT_V53,entryPriceSol:1,quantity:1,rawQuantity:'100',openedAt:at,rulesPeakPriceSol:1.6,rulesBreakEvenArmed:true},s={...initialBotState(config,at),mode:'live',aiOnly:true,running:false,positions:[p],livePendings:[]},r=new RulesRuntime(config,s,{ai:{},execute:()=>{throw Error('NO_REAL_ORDER');}});
 r.monitor({markets:[{mint:'mint',pairAddress:'pool',spotPriceSol:1,priceAt:at+1000}],solUsd:100},at+1000);assert.equal(s.pendingOrders[0].side,'SELL');assert.equal(s.pendingOrders[0].amount,'100');assert.equal(s.pendingOrders[0].reason,'stop-loss');
});
