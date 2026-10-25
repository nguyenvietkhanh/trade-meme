import {test} from 'node:test';
import assert from 'node:assert/strict';
import {botActivity} from '../src/paper-bot-activity.js';
test('all ten bots may be actively scanning while only two have fills; missing heartbeat is not called active',()=>{
 const now=100000,rows=Array.from({length:10},(_,i)=>({heartbeatAt:now,scanIntervalMs:5000,phase:'scanning',signal:{at:now,cycle:30,evaluated:49,eligible:0,decisions:[{eligible:false,reason:'M1 missing'}]},stats:{closed:i===8?1:0},openPositions:i===9?1:0})),statuses=rows.map(a=>botActivity(a,now));
 assert.equal(statuses.filter(a=>a.alive&&a.scanFresh).length,10);assert.equal(statuses.filter(a=>a.hasFills).length,2);assert.ok(statuses.every(s=>s.cycle===30));assert.equal(botActivity({...rows[0],heartbeatAt:now-61000},now).status,'NO_HEARTBEAT');assert.equal(botActivity({...rows[0],signal:{...rows[0].signal,at:now-40000}},now).status,'NO_RECENT_SCAN');
});
