import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditDesk} from '../src/auditor.js';
import {freshState,DEFAULTS} from '../src/engine.js';
import {TRADE_RULES,AUDIT_RULES} from '../src/desk-rules.js';
import {rankMarket} from '../src/strategy.js';
const now=Date.now();
test('the auditor requires forty measured closes and does not invent expectancy from unknown risk',()=>{
 const s=freshState(now);assert.equal(DEFAULTS,TRADE_RULES);assert.equal(auditDesk(s,now).status,'insufficient-data');
 s.trades=Array.from({length:40},(_,i)=>({side:'SELL',closed:true,at:now,positionPnlSol:i%2===0?.012:-.006,initialRiskSol:.006}));
 let report=auditDesk(s,now);assert.equal(report.winRate,.5);assert.ok(Math.abs(report.expectancyR-.5)<1e-10);assert.equal(report.status,'passed');
 s.trades[0].initialRiskSol=null;assert.equal(auditDesk(s,now).status,'insufficient-data');s.trades[0].initialRiskSol=.006;s.maxDrawdownObservedPct=AUDIT_RULES.maxDrawdownPct+1;assert.equal(auditDesk(s,now).status,'review');assert.equal(s.halted,null);
});
test('stale positions are flagged rather than sold and inconsistent volume or missing prices cannot pass the scanner',()=>{
 const s=freshState(now);s.positions=[{mint:'held',openedAt:now-73*3600000}];assert.deepEqual(auditDesk(s,now).stalePositions,['held']);assert.equal(s.positions.length,1);
 const m={mint:'t',priceUsd:1,updatedAt:now,dexId:'pumpswap',hasProfile:true,pairCreatedAt:now-86400000,liquidityUsd:250000,volume24hUsd:1000000,volume5mUsd:10000,volume1hUsd:30000,valuationUsd:1000000,valuationSource:'marketCap',change5mPct:3,change1hPct:10,change6hPct:20,change24hPct:30,buys5m:40,sells5m:5,signalConfirmed:true};
 assert.equal(rankMarket(m,s.settings,now).eligible,true);for(const change of [{priceUsd:NaN},{volume24hUsd:60000,volume1hUsd:100000},{volume5mUsd:50000}])assert.equal(rankMarket({...m,...change},s.settings,now).eligible,false);
});
