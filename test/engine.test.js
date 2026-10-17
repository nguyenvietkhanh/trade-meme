import {verifiedMarket} from './fixtures/verified-market.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshState,buy,sell,tick,riskCheck,equity,DEFAULTS} from '../src/engine.js';
const now=Date.UTC(2026,9,17,12),sol=150;
const market=(overrides={})=>verifiedMarket(overrides,now);
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);
test('round trip deducts slippage and fees on both sides; no fabricated profit',()=>{
 const s=freshState(now),m=market();buy(s,m,sol,now);assert.equal(s.positions.length,1);
 close(s.cashSol,.3-.03-.0001);sell(s,m,sol,now+1);
 close(s.cashSol,.3-.03-.0001+.03/1.015*.985-.0001);assert.ok(s.trades[0].pnlSol<0);assert.equal(s.positions.length,0);
});
test('fresh quotes and minimum liquidity required for buys',()=>{
 for(const m of [market({updatedAt:now-90001}),market({priceUsd:NaN}),market({liquidityUsd:-1}),market({volume24hUsd:-1})])assert.throws(()=>buy(freshState(now),m,sol,now));
});
test('reserve, position cap, duplicate and cooldown enforced',()=>{
 const s=freshState(now);buy(s,market(),sol,now);assert.throws(()=>buy(s,market(),sol,now));
 buy(s,market({mint:'two'}),sol,now);assert.throws(()=>buy(s,market({mint:'three'}),sol,now));
 sell(s,market(),sol,now);assert.throws(()=>buy(s,market(),sol,now+1));
 const poor=freshState(now);poor.cashSol=.06;assert.throws(()=>buy(poor,market(),sol,now));
});
test('stop loss exits after fees at a loss past 20%',()=>{const s=freshState(now);buy(s,market(),sol,now);s.running=true;tick(s,[market({priceUsd:.007,change5mPct:0})],sol,now+1000);assert.equal(s.positions.length,0);assert.equal(s.trades[0].reason,'stop-loss');});
test('a pause stops automatic exits and entries but manual exit works',()=>{
 const s=freshState(now);buy(s,market(),sol,now);tick(s,[market({priceUsd:.005})],sol,now+1);assert.equal(s.positions.length,1);sell(s,market({priceUsd:.005}),sol,now+2);assert.equal(s.positions.length,0);
});
test('daily loss and drawdown circuit breaker persists and disallows buys',()=>{
 const s=freshState(now);s.cashSol=.269;riskCheck(s,[],sol,now);assert.ok(s.halted);assert.throws(()=>buy(s,market(),sol,now));
 const d=freshState(now);d.peakEquity=.4;riskCheck(d,[],sol,now);assert.ok(d.halted);
});
test('UTC day rollover resets daily baseline but never silently clears a halt',()=>{
 const s=freshState(now);s.halted='risk';s.cashSol=.28;riskCheck(s,[],sol,now+86400000);close(s.dayStartEquity,.28);assert.equal(s.halted,'risk');
});
test('strategy selects momentum and rejects missing signal',()=>{
 const s=freshState(now);s.running=true;tick(s,[market({change5mPct:0})],sol,now);assert.equal(s.positions.length,0);
 tick(s,[market()],sol,now+1);assert.equal(s.positions.length,1);assert.equal(s.trades[0].reason,'auto-score:100');
});
test('stale price never creates automatic entry or exit',()=>{
 const s=freshState(now);buy(s,market(),sol,now);s.running=true;tick(s,[market({priceUsd:.001,updatedAt:now-90001})],sol,now);assert.equal(s.positions.length,1);
});
test('risk exit is permitted even after liquidity collapses',()=>{
 const s=freshState(now);buy(s,market(),sol,now);s.running=true;tick(s,[market({priceUsd:.007,liquidityUsd:0,volume24hUsd:0})],sol,now+1);assert.equal(s.positions.length,0);
});
test('equity includes SOL/USD change and open marked value',()=>{
 const s=freshState(now);buy(s,market(),sol,now);close(equity(s,[market()],sol),s.cashSol+s.positions[0].quantity*.01/sol);
 assert.ok(equity(s,[market()],300)<equity(s,[market()],150));
});
test('default budget reserves at least 0.05 SOL and fees reduce fills',()=>{
 assert.equal(DEFAULTS.initialSol,.3);assert.equal(DEFAULTS.maxPositions,2);assert.ok(DEFAULTS.orderSol*2+DEFAULTS.feeSol*2+DEFAULTS.reserveSol<DEFAULTS.initialSol);
});
