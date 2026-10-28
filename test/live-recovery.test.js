import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Keypair,VersionedTransaction,TransactionMessage,SystemProgram} from '@solana/web3.js';
import bs58 from 'bs58';
import {AutomaticFleet} from '../src/automatic-fleet.js';
import {AutomaticTreasury} from '../src/automatic-treasury.js';
import {LiveModelBotRuntime} from '../src/live-model-runtime.js';
import {initialBotState} from '../src/paper-bot-state.js';
import {ACTIVE_BOT_CONFIGS} from '../src/paper-bot-config.js';

test('RPC reconnect preserves open lots, signed unknown orders and paused BUY across restart',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'live-recovery-'));t.after(()=>rm(dir,{recursive:true,force:true}));const kp=Keypair.generate();let now=100000,down=true,networks=0,sends=0,polls=0;
 const execution={network:async()=>{networks++;if(down)throw Object.assign(Error('RPC_UNAVAILABLE'),{code:'RPC_UNAVAILABLE'});},balance:async()=>1,status:async signature=>{assert.ok(signature.length>50);polls++;return null;},height:async()=>1,send:async()=>{sends++;throw Error('must not broadcast');}};
 const data={snapshot:()=>({markets:[]}),status:()=>({})},opts={clock:()=>now,owner:kp.publicKey.toBase58(),legacyDir:dir,execution,modelClient:{verify:async()=>({verified:true}),status:()=>({configured:true}),settings:()=>({})},signerEnv:{LIVE_SIGNER_SECRET_KEY:bs58.encode(kp.secretKey)}};
 let fleet=new AutomaticFleet(dir,data,opts);await fleet.load();
 const lot={agentId:'kade',paperPositionId:'original-lot',mint:'mint',pairAddress:'pool',rawQuantity:'123456',quantity:.123456,decimals:6,costSol:.1,initialCostSol:.1,openedAt:100,aiStopLossPct:12};
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:kp.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:kp.publicKey,toPubkey:kp.publicKey,lamports:1})]}).compileToV0Message());tx.sign([kp]);const signature=bs58.encode(tx.signatures[0]);
 const order={decisionAt:now-1000,transaction:Buffer.from(tx.serialize()).toString('base64'),id:'original-order',agentId:'kade',side:'BUY',mint:'other',pairAddress:'other-pool',amount:'10000000',signature,lastValidBlockHeight:999,status:'unknown',terminal:false};
 fleet.treasury.s.positions=[structuredClone(lot)];fleet.treasury.s.orders[order.id]=structuredClone(order);fleet.treasury.s.initialSol=1;fleet.treasury.s.cashSol=1;await fleet.treasury.save();fleet.meta.walletAuthorized=true;fleet.meta.buyEnabledWanted=false;await fleet.save();await fleet.stop();
 fleet=new AutomaticFleet(dir,data,opts);await fleet.load();fleet.treasury.reconcileInventory=async()=>{};fleet.treasury.sweepProfit=async()=>{};
 await assert.rejects(fleet.pulse(),{code:'RPC_UNAVAILABLE'});assert.equal(fleet.treasury.ownerConnected,true);assert.equal(fleet.treasury.signingReady(),false);assert.equal(fleet.admission().code,'RPC_UNAVAILABLE');assert.equal(fleet.state.running,false);
 const attempts=networks;await fleet.pulse();assert.equal(networks,attempts,'backoff must not repeat RPC work');down=false;now+=16000;await fleet.pulse();assert.equal(fleet.treasury.signingReady(),true,'retry even if ownerConnected was already true');assert.equal(fleet.state.running,false,'reconnect preserves BUY pause');assert.equal(fleet.meta.buyEnabledWanted,false);assert.equal(fleet.treasury.s.orders[order.id].signature,order.signature);assert.equal(fleet.treasury.s.orders[order.id].terminal,false);assert.deepEqual(fleet.treasury.s.positions,[lot]);assert.equal(sends,0);assert.ok(polls>=2);
 const disk=JSON.parse(await readFile(fleet.treasury.file));assert.deepEqual(disk.positions,[lot]);assert.equal(disk.orders[order.id].signature,signature);await fleet.stop();
});
test('stop errors identify wallet, signer and missing stop independently without changing the lot',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'stop-errors-'));t.after(()=>rm(dir,{recursive:true,force:true}));const kp=Keypair.generate(),tr=new AutomaticTreasury(dir,{network:async()=>{},balance:async()=>1},{owner:kp.publicKey.toBase58(),legacyDir:dir,signerEnv:{LIVE_SIGNER_SECRET_KEY:bs58.encode(kp.secretKey)}});await tr.load();
 tr.s.positions=[{agentId:'kade',paperPositionId:'lot',mint:'mint',aiStopLossPct:12}];const input={side:'SET_STOP',mint:'mint',positionId:'lot',aiStopLossPct:8};
 await assert.rejects(tr.request(input,{},'kade'),{code:'LIVE_WALLET_NOT_CONNECTED'});tr.ownerConnected=true;await assert.rejects(tr.request(input,{},'kade'),{code:'LIVE_SIGNER_LOCKED'});tr.connectionError='RPC_UNAVAILABLE';await assert.rejects(tr.request(input,{},'kade'),{code:'RPC_UNAVAILABLE'});tr.connectionError=null;tr.vault.enable();await assert.rejects(tr.request({...input,aiStopLossPct:null},{},'kade'),{code:'LIVE_AI_STOP_REQUIRED'});assert.equal(tr.s.positions[0].aiStopLossPct,12);await tr.request(input,{},'kade');assert.equal(tr.s.positions[0].aiStopLossPct,8);
});
test('a transient RPC error never discards a submitted intent or its original ID',async()=>{
 const now=Date.now(),c=ACTIVE_BOT_CONFIGS[0],order={id:'original',side:'BUY',mint:'mint',pairAddress:'pool',readyAt:now-1,decisionAt:now-60000,wasSubmitted:true},s={...initialBotState(c,now),mode:'live',initialSol:0,livePending:{...order,signature:'signed'},pending:order};let calls=0;
 const runtime=new LiveModelBotRuntime(c,s,{ai:{enabled:true},execute:async()=>{calls++;throw Object.assign(Error('RPC_UNAVAILABLE'),{code:'RPC_UNAVAILABLE'});}});await runtime.fill({markets:[]},now);assert.equal(s.pending.id,'original');assert.equal(s.livePending.signature,'signed');await runtime.fill({markets:[]},now+2000);assert.equal(calls,1);assert.equal(s.pending.readyAt,now+15000);
});
test('stop updates wait for signer recovery without recreating or rejecting the pending update',async()=>{
 const now=Date.now(),c=ACTIVE_BOT_CONFIGS[0],order={id:'stop',side:'SET_STOP',mint:'mint',pairAddress:'pool',positionId:'lot',aiStopLossPct:8,readyAt:now-1},s={...initialBotState(c,now),mode:'live',initialSol:0,liveSigningReady:false,pending:order};let calls=0;
 const runtime=new LiveModelBotRuntime(c,s,{ai:{enabled:true},execute:async()=>{calls++;return {terminal:true,status:'stop-updated'};}});await runtime.fill({markets:[{mint:'mint',pairAddress:'pool'}]},now);assert.equal(calls,0);assert.equal(s.pending.id,'stop');s.liveSigningReady=true;await runtime.fill({markets:[{mint:'mint',pairAddress:'pool'}]},now+15000);assert.equal(calls,1);assert.equal(s.pending,null);
});
test('duplicate live errors are counted rather than flooding the event list',()=>{
 const f=Object.create(AutomaticFleet.prototype);f.errors=[];f.mode='live';f.error({bot:'kade',message:'RPC_UNAVAILABLE'});f.error({bot:'data',message:'RPC_UNAVAILABLE'});f.error({bot:'kade',message:'RPC_UNAVAILABLE'});assert.equal(f.errors.length,2);assert.equal(f.errors.find(e=>e.message.includes('kade')).count,2);
});
