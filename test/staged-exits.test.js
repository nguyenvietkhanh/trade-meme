import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshState,buy,tick,equity,exitPlan} from '../src/engine.js';
const now=Date.UTC(2026,9,17,12),m=price=>({mint:'test',symbol:'TEST',priceUsd:price,updatedAt:now,liquidityUsd:500000,volume24hUsd:1000000,valuationUsd:1000000,change5mPct:0,pairCreatedAt:now-86400000,buys5m:0,sells5m:0});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function account(){const s=freshState(now);Object.assign(s.settings,{initialSol:100,orderSol:100,reserveSol:0,feeSol:0,slippageBps:0,maxDailyLossSol:50});Object.assign(s,{cashSol:100,peakEquity:100,dayStartEquity:100,running:true});buy(s,m(1),1,now);return s;}
test('$100 to $180: sell 78%, then halve at 2x and 4x entry',()=>{
 const s=account();tick(s,[m(1.79)],1,now);assert.equal(s.trades.length,1);
 tick(s,[m(1.8)],1,now);near(s.cashSol,140.4);near(s.positions[0].quantity*1.8,39.6);assert.equal(s.positions[0].phase,'runner');near(s.positions[0].nextTakeProfitPriceUsd,2);near(equity(s,[m(1.8)],1),180);assert.equal(s.trades[0].closed,false);
 const q=s.positions[0].quantity;tick(s,[m(1.8)],1,now);near(s.positions[0].quantity,q);
 tick(s,[m(2)],1,now);near(s.cashSol,162.4);near(s.positions[0].quantity,q/2);near(s.positions[0].nextTakeProfitPriceUsd,4);
 tick(s,[m(4)],1,now);near(s.cashSol,184.4);near(s.positions[0].quantity,q/4);
});
test('a gap executes one half-sale at the observed quote; no invented historical fills',()=>{
 const s=account();tick(s,[m(1.8)],1,now);const q=s.positions[0].quantity;tick(s,[m(14.4)],1,now);near(s.positions[0].quantity,q/2);near(s.positions[0].nextTakeProfitPriceUsd,16);assert.equal(s.positions[0].runnerSteps,1);
});
test('first take-profit sells a fixed 78%, with fee and slippage deducted',()=>{
 const s=freshState(now);s.running=true;buy(s,m(1),150,now);const initial=s.positions[0].initialCostUsd;
 tick(s,[m(2)],150,now);assert.equal(s.trades[0].reason,'recover-capital');near(s.trades[0].fraction,.78);near(s.trades[0].sol*150,s.trades[1].quantity*.78*2*.985-.0001*150);assert.ok(s.positions[0].quantity>0);
});
test('halves eventually close token dust rather than leaving an infinite position',()=>{
 const s=account();tick(s,[m(1.8)],1,now);let price=1.8;
 for(let i=0;i<25&&s.positions.length;i++){price*=2;tick(s,[m(price)],1,now);}
 assert.equal(s.positions.length,0);assert.equal(s.trades[0].closed,true);assert.ok(s.cooldowns.test>now);
});
test('daily risk halt blocks entries but does not liquidate positions before the individual stop',()=>{
 const s=freshState(now);s.running=true;buy(s,m(1),150,now);s.halted='daily limit';tick(s,[m(.9)],150,now);assert.equal(s.positions.length,1);assert.equal(s.trades.length,1);tick(s,[m(.7)],150,now);assert.equal(s.positions.length,0);assert.equal(s.trades[0].reason,'stop-loss');
});
test('USD profit targets do not silently change when SOL/USD moves',()=>{
 const s=account();const p=s.positions[0];assert.equal(exitPlan(p,m(1.8),2,s.settings,now).reason,'recover-capital');assert.equal(exitPlan(p,m(1.1),.5,s.settings,now),null);
});
