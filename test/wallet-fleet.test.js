import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {WalletFleet} from '../src/wallet-fleet.js';
import {tenMarket} from './fixtures/ten-market.js';
test('production wallet fleet runs exactly three independent AI contexts without a vault or password, and never implies unattended signing',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'wallet-fleet-'));let fleet; t.after(async()=>{await fleet?.stop();await rm(dir,{recursive:true,force:true});});const contexts=new Map(),client={settings:()=>({configured:true,enabled:true,name:'fixture',pollMs:15000}),status:()=>({configured:true,enabled:true}),cancel:()=>{},decide:async(id,ctx)=>{contexts.set(id,ctx);return {decision:{action:'HOLD',mint:null,order_sol:null,sell_percent:null,confidence:.5,reason:'Wait'},expiresAt:Date.now()+30000};}},execution={network:async()=>{},balance:async()=>.308951,send:async()=>{throw Error('must not broadcast without owner wallet');}},data={snapshot:()=>{const now=Date.now();return {snapshotId:'wallet-test',timestamp:now,solUsd:100,markets:[tenMarket('kade',now)]};},status:()=>({})};
 fleet=new WalletFleet(path.join(dir,'live'),data,{modelClient:client,execution,legacyDir:dir,storageMode:'local-disk'});await fleet.load();await assert.rejects(fleet.pause(false),{code:'LIVE_WALLET_NOT_CONNECTED'});await fleet.pause(true);fleet.start();await fleet.connectWallet();for(let i=0;i<100&&contexts.size!==3;i++){fleet.publish();await delay(30);}assert.deepEqual([...contexts.keys()].sort(),['kade','nyx','sage']);for(const ctx of contexts.values()){assert.equal(ctx.mode,'live');assert.equal(ctx.requiresWalletSignature,true);assert.equal(ctx.limits.maxOrderSol,.203951);}assert.equal(fleet.state.cashSol,.308951);assert.equal(fleet.state.live.walletConnected,true);assert.equal(fleet.state.live.unattendedSigningAvailable,false);assert.equal(fleet.treasury.vault.keypair,null);await fleet.pause(true);assert.equal(fleet.state.running,false);await fleet.pause(false);assert.equal(fleet.state.running,true);await fleet.disconnectWallet();assert.equal(fleet.state.running,false);assert.equal(fleet.state.live.walletConnected,false);
});
