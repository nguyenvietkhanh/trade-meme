import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateQuote,validateSimulation,LIVE_LIMITS} from '../src/solana.js';
import {SOL} from '../src/engine.js';
const quote={inputMint:SOL,outputMint:'token',swapMode:'ExactIn',inAmount:'30000000',outAmount:'1000',otherAmountThreshold:'985',priceImpactPct:'0.005',slippageBps:150,routePlan:[{}]};
test('quote cannot change input, mint, amount, price impact or slippage bounds',()=>{
 assert.doesNotThrow(()=>validateQuote(quote,SOL,'token','30000000'));
 for(const changed of [{inAmount:'300000000'},{inputMint:'another'},{outputMint:'other'},{priceImpactPct:'.5'},{slippageBps:500},{otherAmountThreshold:'0'},{routePlan:[]}])assert.throws(()=>validateQuote({...quote,...changed},SOL,'token','30000000'));
 assert.equal(LIVE_LIMITS.orderFraction,null);assert.equal(LIVE_LIMITS.orderSol,.6);assert.equal(LIVE_LIMITS.budgetSol,null);
});
test('simulation rejects excessive native spend, unrelated asset mutation and missing output',()=>{
 const base={beforeSol:300000000,afterSol:269000000,before:[null],after:[{mint:'token',owner:'owner',amount:'1000',delegate:'none'}],input:SOL,output:'token',amount:'30000000',minOut:'985'};
 assert.doesNotThrow(()=>validateSimulation(base));
 assert.throws(()=>validateSimulation({...base,afterSol:200000000}));
 assert.throws(()=>validateSimulation({...base,after:[{...base.after[0],amount:'1'}]}));
 assert.throws(()=>validateSimulation({...base,before:[{mint:'other',owner:'owner',amount:'100',delegate:'none'}],after:[{mint:'other',owner:'owner',amount:'1',delegate:'none'}]}));
 assert.throws(()=>validateSimulation({...base,before:[{mint:'token',owner:'owner',amount:'0',delegate:'none'}],after:[{mint:'token',owner:'attacker',amount:'1000',delegate:'none'}]}));
});
test('sell simulation debits exactly the authorized token amount and receives bounded SOL',()=>{
 const base={beforeSol:100000000,afterSol:140000000,before:[{mint:'token',owner:'owner',amount:'1000',delegate:'none'}],after:[{mint:'token',owner:'owner',amount:'500',delegate:'none'}],input:'token',output:SOL,amount:'500',minOut:'39000000'};
 assert.doesNotThrow(()=>validateSimulation(base));assert.throws(()=>validateSimulation({...base,amount:'400'}));assert.throws(()=>validateSimulation({...base,afterSol:100000001}));
});
