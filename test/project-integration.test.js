import test from 'node:test';
import assert from 'node:assert/strict';
import {projectRulesConfig,projectEquity} from '../src/project-risk.js';
import {newRulesExitPolicy,exitV5,LIVE_EXIT_V5} from '../src/rules-v5.js';
import {RulesTreasury} from '../src/rules-treasury.js';
import {pumpEvents,ProjectResearch} from '../src/project-research.js';
import {PUMP_PROGRAM_ID} from '@pump-fun/pump-sdk';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';
const now=Date.parse('2026-10-30T03:00:00Z'),policy=projectRulesConfig({});
test('saved legacy exits are unchanged; only new positions receive fixed project exits',()=>{const old={entryPriceSol:1,openedAt:now,exitPolicy:{...LIVE_EXIT_V5}},copy=structuredClone(old),fresh={...old,exitPolicy:newRulesExitPolicy(policy)};assert.equal(exitV5(old,.79,now,{}).reason,'stop-loss');assert.equal(exitV5(fresh,.79,now,{}),null);assert.equal(exitV5(fresh,2,now,{}).fraction,.4);assert.deepEqual(old,copy);assert.equal(exitV5(fresh,1,now+86400000,{}),null);});
test('global account equity includes old RUNNER market value and refuses stale valuation',()=>{const state={positions:[{group:'RUNNER',mint:'m',pairAddress:'p',quantity:2,costSol:.1}]},snapshot={markets:[{mint:'m',pairAddress:'p',priceAt:now,spotPriceSol:.2}]};assert.equal(projectEquity(.5,state,snapshot,now),.9);assert.equal(projectEquity(.5,state,snapshot,now+1501),null);});
function treasury(time=now,trades=[]){const t=new RulesTreasury('/unused',{balance:async()=>.5},{policy,signerEnv:{},clock:()=>time,marketSnapshot:()=>({markets:[],solUsd:150}),rulesClient:{grants:new Map()}});t.s={positions:[],orders:{},trades,rentByMint:{}};return t;}
test('signing boundary rechecks quiet hours, loss cooldown, global position slots and actual fee budget',async()=>{
 const order={side:'BUY',amount:'5000000'},prepared={fixedEntryCostSol:.002,networkFeeEstimateSol:.000025};
 await assert.rejects(treasury(Date.parse('2026-10-29T18:00:00Z')).authorizePrepared(order,prepared),{code:'PROJECT_QUIET_HOURS'});
 const trades=['a','b'].map((positionId,i)=>({positionId,at:now-(i+1)*1000,side:'SELL',closed:true,positionPnlSol:-.001}));await assert.rejects(treasury(now,trades).authorizePrepared(order,prepared),{code:'PROJECT_LOSS_COOLDOWN'});
 const t=treasury();t.s.orders=Object.fromEntries([1,2,3,4].map(id=>[id,{id,side:'BUY',terminal:false}]));await assert.rejects(t.authorizePrepared(order,prepared),{code:'PROJECT_POSITION_LIMIT'});
 await assert.rejects(treasury().authorizePrepared(order,{fixedEntryCostSol:.01,networkFeeEstimateSol:.001}),{code:'PROJECT_RISK_BUDGET'});
});
test('foreign program logs and undecoded/truncated trade events cannot become complete coverage',()=>{
 const coder={decode:()=>({name:'tradeEvent',data:{mint:'mint'}})};
 assert.equal(pumpEvents({meta:{err:null,logMessages:['Program fake invoke [1]','Program data: forged','Program fake success']}},coder,'mint').events.length,0);
 const rows={meta:{err:null,logMessages:[`Program ${PUMP_PROGRAM_ID} invoke [1]`,'Program log: Instruction: Buy',`Program ${PUMP_PROGRAM_ID} success`]}};assert.equal(pumpEvents(rows,coder,'mint').complete,false);
 rows.meta.logMessages.push('Log truncated');assert.equal(pumpEvents(rows,coder,'mint').complete,false);
});
test('missing wallets list is not silently an empty blacklist; explicitly empty lists are supported',async()=>{const dir=await mkdtemp(path.join(tmpdir(),'project-wallets-')),file=path.join(dir,'wallets.txt');let at=now;try{const r=new ProjectResearch({file,clock:()=>at,execution:{rpc:{}}});await r.list();assert.equal(r.walletsAvailable,false);await writeFile(file,'# configure this list\n');at+=11000;await r.list();assert.equal(r.walletsAvailable,false);await writeFile(file,'# allow-empty\n');at+=11000;await r.list();assert.equal(r.walletsAvailable,true);}finally{await rm(dir,{recursive:true,force:true});}});
