import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
import {AutomaticFleet} from '../src/automatic-fleet.js';
import {AutomaticTreasury} from '../src/automatic-treasury.js';
import {RulesHealth,signerUnavailable,compactHealthAlerts} from '../src/rules-health.js';
const rpcError=()=>Object.assign(Error('RPC_UNAVAILABLE'),{code:'RPC_UNAVAILABLE'});
async function setup(t,signer=true){const dir=await mkdtemp(path.join(tmpdir(),'balance-signer-'));t.after(()=>rm(dir,{recursive:true,force:true}));const kp=Keypair.generate();let now=100000,down=false,balance=.398467;
 const execution={network:async()=>{if(down)throw rpcError();},balance:async()=>{if(down)throw rpcError();return balance;}};
 const data={snapshot:()=>({snapshotId:'empty',markets:[],solUsd:100,updatedAt:now}),status:()=>({})};
 const opts={clock:()=>now,owner:kp.publicKey.toBase58(),legacyDir:dir,execution,modelClient:{verify:async()=>({verified:true}),settings:()=>({}),status:()=>({})},signerEnv:signer?{LIVE_SIGNER_SECRET_KEY:bs58.encode(kp.secretKey)}:{}};
 return {dir,data,opts,execution,setDown:v=>down=v,advance:n=>now+=n,setBalance:n=>balance=n};}
test('read-only balance refresh works when signer is absent and reconnect is failing',async t=>{
 const f=await setup(t,false),fleet=new AutomaticFleet(f.dir,f.data,f.opts);await fleet.load();await assert.rejects(fleet.connectWallet(),{code:'LIVE_SIGNER_NOT_CONFIGURED'});await fleet.refreshBalance();assert.equal(fleet.treasury.status().balanceSol,.398467);assert.equal(fleet.treasury.signingReady(),false);
 f.advance(15000);f.setDown(true);await fleet.refreshBalance();let status=fleet.treasury.status();assert.equal(status.balanceSol,.398467);assert.equal(status.availableSol,0);assert.equal(status.connection.balanceFresh,false);assert.equal(status.connection.balanceError,'RPC_UNAVAILABLE');
 f.setDown(false);f.setBalance(.4);await fleet.refreshBalance();status=fleet.treasury.status();assert.equal(status.balanceSol,.4);assert.equal(status.connection.balanceFresh,true);assert.equal(status.connection.balanceError,null);
});
test('persisted observed balance survives restart as stale display only, never spendable',async t=>{
 const f=await setup(t);let tr=new AutomaticTreasury(f.dir,f.execution,f.opts);await tr.load();await tr.sync();f.advance(1000);tr=new AutomaticTreasury(f.dir,f.execution,f.opts);await tr.load();let s=tr.status();assert.equal(s.balanceSol,.398467);assert.equal(s.connection.balanceFresh,false);assert.equal(s.availableSol,0);assert.equal(tr.signingReady(),false);
 await tr.sync();s=tr.status();assert.equal(s.connection.balanceFresh,true);assert.ok(s.availableSol>0);
});
test('RPC failure on reconnect preserves a previously valid enabled signer, blocks BUY and can recover',async t=>{
 const f=await setup(t),tr=new AutomaticTreasury(f.dir,f.execution,f.opts);await tr.load();await tr.connect();assert.equal(tr.signingReady(),true);f.setDown(true);await assert.rejects(tr.connect(),{code:'RPC_UNAVAILABLE'});assert.equal(tr.signingReady(),true);assert.equal(tr.running,false);assert.equal(tr.status().connection.error,'RPC_UNAVAILABLE');assert.equal(signerUnavailable(tr.status(),true),false);
 f.setDown(false);await tr.connect();assert.equal(tr.running,true);assert.equal(tr.status().connection.error,null);await tr.disconnect();assert.equal(tr.signingReady(),false,'explicit disconnect still revokes signing');
});
test('persistent incident alerts send once until recovery, including across restarts',()=>{
 let now=100000;const h=new RulesHealth({clock:()=>now});const first=h.check({signerError:true,signerCode:'LIVE_SIGNER_OWNER_MISMATCH'});assert.equal(first.length,1);assert.match(first[0].text,/LIVE_SIGNER_OWNER_MISMATCH/);now+=3600000;assert.equal(h.check({signerError:true}).length,0);
 const restarted=new RulesHealth({clock:()=>now});restarted.restore(h.snapshot());assert.equal(restarted.check({signerError:true}).length,0);assert.equal(restarted.check({signerError:false}).length,0);const next=restarted.check({signerError:true});assert.equal(next.length,1);assert.notEqual(next[0].id,first[0].id);
});
test('real signer configuration errors remain distinct from RPC/startup waiting',()=>{
 assert.equal(signerUnavailable({signer:{configured:false,unlocked:false},connection:{error:'RPC_UNAVAILABLE'}},true,true),true);
 assert.equal(signerUnavailable({signer:{configured:true,unlocked:false},connection:{error:'RPC_UNAVAILABLE'}},true),false);
 assert.equal(signerUnavailable({signer:{configured:true,unlocked:false},connection:{}},true,true),false);
 assert.equal(signerUnavailable({signer:{configured:true,unlocked:false},connection:{}},true),true);
});

test('queued duplicates collapse and obsolete incidents resolve without deleting notification audit',()=>{const rows=[{id:'health:SIGNER_UNAVAILABLE:1',status:'queued'},{id:'health:SIGNER_UNAVAILABLE:2',status:'queued'},{id:'health:RPC_UNAVAILABLE:3',status:'queued'},{id:'trade:signature',status:'queued'}];assert.equal(compactHealthAlerts(rows,['SIGNER_UNAVAILABLE']),true);assert.deepEqual(rows.map(r=>r.status),['superseded','queued','resolved','queued']);assert.equal(rows.length,4);});
test('fleet retries a failed connection even with signer preserved and keeps the manual BUY pause',async t=>{
 const f=await setup(t),fleet=new AutomaticFleet(f.dir,f.data,f.opts);await fleet.load();await fleet.connectWallet();await fleet.pause(true);fleet.treasury.reconcileInventory=async()=>{};fleet.treasury.sweepProfit=async()=>{};
 f.setDown(true);await assert.rejects(fleet.treasury.connect(),{code:'RPC_UNAVAILABLE'});assert.equal(fleet.treasury.signingReady(),true);f.setDown(false);f.advance(16000);await fleet.pulse();assert.equal(fleet.treasury.status().connection.error,null);assert.equal(fleet.treasury.running,false);assert.equal(fleet.meta.buyEnabledWanted,false);
});
