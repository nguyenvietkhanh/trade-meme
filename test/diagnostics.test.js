import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diagnose} from '../src/diagnostics.js';
import {freshState} from '../src/engine.js';
const now=Date.UTC(2026,9,17,12);
const feed={updatedAt:now,error:null};
const ranked={mint:'mint',eligible:true,reasons:[]};
function running(){const s=freshState(now);s.running=true;s.automationRequested=true;return s;}
test('running but no qualifying candidates reports waiting signal with counted blockers',()=>{
 const s=running();s.lastEvaluationAt=now;
 const d=diagnose(s,feed,[{...ranked,eligible:false,reasons:['Thanh khoản thấp','Giá chưa tăng']},{...ranked,mint:'two',eligible:false,reasons:['Giá chưa tăng']}],now);
 assert.equal(d.phase,'waiting-signal');assert.equal(d.candidates,2);assert.equal(d.eligible,0);assert.equal(d.topBlockers[0].reason,'Giá chưa tăng');assert.equal(d.topBlockers[0].count,2);assert.equal(d.lastEvaluationAt,now);assert.equal(s.trades.length,0);
});
test('diagnostic distinguishes a stopped bot, feed errors and stale prices',()=>{
 assert.equal(diagnose(freshState(now),feed,[ranked],now).phase,'paused');
 assert.equal(diagnose(running(),{...feed,error:'HTTP 429'},[ranked],now).phase,'waiting-data');
 assert.equal(diagnose(running(),{updatedAt:now-90001,error:null},[ranked],now).phase,'waiting-data');
});
test('position limits, reserve, cooldown and risk halt are not misreported as missing signals',()=>{
 const full=running();full.positions=Array.from({length:5},(_,i)=>({mint:String(i)}));assert.equal(diagnose(full,feed,[ranked],now).phase,'position-limit');
 const reserve=running();reserve.cashSol=.06;assert.equal(diagnose(reserve,feed,[ranked],now).phase,'reserve');
 const cooldown=running();cooldown.cooldowns.mint=now+1000;assert.equal(diagnose(cooldown,feed,[ranked],now).phase,'cooldown');
 const halt=running();halt.halted='daily loss';assert.equal(diagnose(halt,feed,[ranked],now).phase,'risk-halt');
 assert.equal(diagnose(running(),feed,[ranked],now).phase,'ready');
});
