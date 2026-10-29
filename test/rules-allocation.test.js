import test from 'node:test';import assert from 'node:assert/strict';import {planRulesOrder} from '../src/rules-allocation.js';import {rulesConfig} from '../src/rules-config.js';import {softRisk} from '../src/rules-risk.js';
const i={wallet_balance_sol:.5,account_equity_sol:.5,available_capital_sol:.445,open_exposure_sol:0,quote_reserve_sol:10,holder_count:100,top10_pct:10,dev_wallet_pct:2,volume_5m_sol:3,buys_5m:20,sells_5m:10,change_5m_pct:5},p=rulesConfig({});
test('risk sizing uses available cash, 1.5% /50% and bounded pool/wallet/exposure, not a 50% allocation',()=>{
 const s=planRulesOrder(i,{},p);assert.equal(s.tier,'STANDARD');assert.equal(s.size,.01335);assert.equal(s.maxOrder,.05);assert.ok(s.size<.5*.1);
 const probe=planRulesOrder({...i,buys_5m:4,sells_5m:3,volume_5m_sol:.3}, {},p);assert.equal(probe.tier,'PROBE');assert.equal(probe.size,.00445);
 assert.equal(planRulesOrder({...i,account_equity_sol:100,wallet_balance_sol:100,available_capital_sol:99}, {},p).size,.15);
 assert.ok(planRulesOrder({...i,open_exposure_sol:.149}, {},p).size<=.001000001);
});
test('closed-position loss streak/daily/drawdown brakes only shrink size, never create a timed BUY pause',()=>{
 for(const lossStreak of [0,3,5,10])for(const dd of [0,.11,.16]){const r=softRisk({lossStreak,dayStartSol:10,dailyPnlSol:-.6,peakSol:10,equitySol:10*(1-dd)},p);assert.equal(r.buyPaused,false);assert.ok(r.factor>0&&r.factor<=1);const s=planRulesOrder({...i,softRisk:r},{},p);assert.ok(s.size<=planRulesOrder(i,{},p).size);}
 assert.equal(softRisk({lossStreak:3},p).factor,.5);assert.equal(softRisk({lossStreak:5},p).factor,.25);assert.equal(softRisk({lossStreak:5},p).probeOnly,true);
});
test('config percentages, manual kill switch and BE disabled flag have explicit safe defaults',()=>{
 assert.equal(p.maxOrderFraction,.1);assert.equal(p.poolFraction,.015);assert.equal(p.exposureFraction,.3);assert.equal(p.killSwitch,false);assert.equal(p.paperMode,false);assert.equal(rulesConfig({BREAKEVEN_AFTER_PCT:'0',KILL_SWITCH:'true'}).breakEvenTriggerPct,0);assert.throws(()=>rulesConfig({ASSUMED_WORST_LOSS:'50'}));assert.throws(()=>rulesConfig({QUOTE_MAX_ATTEMPTS:'4'}));
});
test('closed partial SELL is not a separate loss streak and the UTC daily baseline survives restart',async()=>{
 const {riskSnapshot}=await import('../src/rules-risk.js'),now=Date.parse('2026-10-29T12:00:00Z'),s={realizedPnlSol:-3,netDepositsSol:0,rulesRisk:{day:'2026-10-29',dayStartSol:10,dayStartRealizedPnl:0,peakSol:10,netDepositsSol:0,baselineObservedAt:now-1000},trades:[{side:'SELL',at:now,closed:true,positionPnlSol:-3,pnlSol:-2},{side:'SELL',at:now-100,closed:false,pnlSol:-1}]};
 const r=riskSnapshot(s,7,now,p);assert.equal(r.lossStreak,1);assert.equal(r.dailyPnlSol,-3);assert.equal(r.probeOnly,true);const restored=JSON.parse(JSON.stringify(s));assert.equal(riskSnapshot(restored,7,now+1000,p).dailyPnlSol,-3);
});
