import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TRADE_RULES,PROFIT_RULES,canFundBuy} from '../src/desk-rules.js';
import {createOwnerLedger,allocateOwnerCapital} from '../src/owner-ledger.js';
import {equity,recordBuy,recordSell} from '../src/engine.js';
import {availableProfitLamports,profitOrder} from '../src/profit.js';

const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,`${actual} != ${expected}`);
test('confirmed capital increases preserve historical PnL, daily loss, positions and account stops',()=>{
 const s=createOwnerLedger('owner',.3),a={mint:'closed',symbol:'A',priceUsd:1},b={mint:'held',symbol:'B',priceUsd:1};
 recordBuy(s,a,100,{quantity:3,costSol:.0301,priceUsd:1,rawQuantity:'3000000',decimals:6});
 recordSell(s,a,100,{quantity:3,proceedsSol:.02,priceUsd:2/3,closed:true});
 recordBuy(s,b,100,{quantity:2,costSol:.0201,priceUsd:1,rawQuantity:'2000000',decimals:6});
 Object.assign(s,{buyPaused:true,dailyLossBlocked:true,halted:'daily limit',haltKind:'daily',lossPauseUntil:Date.now()+3600000});
 const before=structuredClone(s),value=equity(s,[b],100),balance=s.cashSol+.89;
 near(allocateOwnerCapital(s,balance,123),.89);assert.equal(s.settings.initialSol,1.19);near(s.cashSol,balance);
 near(equity(s,[b],100)-s.settings.initialSol,value-before.settings.initialSol);
 near(s.dayStartEquity-equity(s,[b],100),before.dayStartEquity-value);
 near(s.peakEquity-equity(s,[b],100),before.peakEquity-value);
 for(const key of ['positions','trades','payouts','realizedNetSol','withdrawnSol','payoutFeesSol','cooldowns','dailyLossBlocked','halted','haltKind','buyPaused','lossPauseUntil'])assert.deepEqual(s[key],before[key],key);
 assert.deepEqual(s.capitalAllocations,[{at:123,amountSol:.89,initialSol:1.19}]);
 assert.equal(allocateOwnerCapital(s,balance),0);assert.equal(s.capitalAllocations.length,1);assert.equal(profitOrder(s,balance),null);
});
test('new capital is limited to actual native wallet surplus, allocated once, and never applied to uncertain orders',()=>{
 const s=createOwnerLedger('owner',.3);near(allocateOwnerCapital(s,.4),.1);near(s.cashSol,.4);near(s.settings.initialSol,.4);
 assert.equal(allocateOwnerCapital(s,.4),0);near(allocateOwnerCapital(s,.399),-.001);near(s.externalWithdrawnSol,.001);
 s.pending={signature:'uncertain'};const before=structuredClone(s);assert.equal(allocateOwnerCapital(s,1.19),0);assert.deepEqual(s,before);s.pending=null;
 for(const balance of [NaN,Infinity,undefined,-1])assert.equal(allocateOwnerCapital(s,balance),0);
 near(allocateOwnerCapital(s,2),1.601);near(s.settings.initialSol,2.001);near(s.cashSol,2);
 const fresh=createOwnerLedger('owner',2);assert.equal(fresh.cashSol,2);assert.equal(allocateOwnerCapital(fresh,2),0);
});
test('the 0.2 SOL fixed size retains reserve and overhead at exact lamport boundaries',()=>{
 assert.equal(TRADE_RULES.orderSol,.2);assert.equal(TRADE_RULES.smallOrderSol,.2);assert.equal(TRADE_RULES.maxPositions,null);
 assert.equal(canFundBuy(.255,.2,.05),true);assert.equal(canFundBuy(.254999999,.2,.05),false);
 assert.equal(canFundBuy(1.19,.2,.05),true);
 for(const balance of [NaN,Infinity,-1,.05])assert.equal(canFundBuy(balance,.2,.05),false);
 assert.equal(TRADE_RULES.maxDailyLossSol,null);assert.equal(TRADE_RULES.maxDrawdownPct,15);assert.equal(TRADE_RULES.stopLossPct,20);
});
test('the new 1.19 SOL principal cannot be paid as profit and the old payout cap stays 0.3 SOL',()=>{
 const s=createOwnerLedger('owner',.3);assert.equal(allocateOwnerCapital(s,1.19),.89);assert.equal(profitOrder(s,1.19),null);
 const state={cashSol:1.21,initialSol:1.19,realizedNetSol:.02};assert.equal(availableProfitLamports(state,1.21),19990000);
 assert.equal(availableProfitLamports({...state,cashSol:1.19},1.21),0);
 assert.equal(availableProfitLamports({...state,cashSol:2,realizedNetSol:.81},2),300000000);
 assert.equal(PROFIT_RULES.maxTransferLamports,300000000);
});
