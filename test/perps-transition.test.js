import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';
import {Keypair} from '@solana/web3.js';import bs58 from 'bs58';
import {tradingProduct} from '../src/trading-product.js';
import {AutomaticTreasury} from '../src/automatic-treasury.js';
import {AutomaticFleet} from '../src/automatic-fleet.js';
import {controlError} from '../src/control-errors.js';
test('selecting Solflare Perps never implies a verified execution venue or signer',()=>{
 const p=tradingProduct({TRADING_PRODUCT:'solflare-perps'});assert.equal(p.spotEntriesAllowed,false);assert.equal(p.perpsEnabled,false);assert.equal(p.underlyingVenue,null);assert.equal(p.signingVerified,false);assert.equal(tradingProduct({}).spotEntriesAllowed,true);assert.throws(()=>tradingProduct({TRADING_PRODUCT:'guessed-venue'}));assert.equal(controlError({code:'PERPS_NOT_READY'}).status,409);
});
test('native Solana selection identifies Drift without claiming a configured account or enabled derivatives execution',()=>{const p=tradingProduct({TRADING_PRODUCT:'solana-perps'});assert.equal(p.venue,'Drift');assert.equal(p.spotEntriesAllowed,false);assert.equal(p.perpsEnabled,false);assert.equal(p.collateralVerified,false);assert.equal(p.signingVerified,false);});
test('migration blocks new spot buys and unsigned buy authorization, while keeping existing order polling',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'perps-transition-'));t.after(()=>rm(dir,{recursive:true,force:true}));const kp=Keypair.generate(),tr=new AutomaticTreasury(dir,{network:async()=>{},balance:async()=>1},{owner:kp.publicKey.toBase58(),legacyDir:dir,spotEntriesAllowed:false,signerEnv:{LIVE_SIGNER_SECRET_KEY:bs58.encode(kp.secretKey)}});await tr.load();await tr.connect();assert.equal(tr.signingReady(),true);assert.equal(tr.running,false);assert.throws(()=>tr.pause(false),{code:'PERPS_NOT_READY'});
 const buy={id:'live:kade:already-signed',side:'BUY',mint:'mint',pairAddress:'pool',amount:'10000000'},m={mint:'mint',pairAddress:'pool'};assert.throws(()=>tr.request(buy,m,'kade'),{code:'SPOT_ENTRIES_DISABLED_FOR_PERPS'});await assert.rejects(tr.authorizePrepared(buy,{}),{code:'SPOT_ENTRIES_DISABLED_FOR_PERPS'});
 tr.s.orders[buy.id]={...buy,agentId:'kade',status:'unknown',signature:'existing-signature',terminal:false};const r=await tr.request(buy,m,'kade');assert.equal(r.status,'unknown');assert.equal(r.signature,'existing-signature');assert.equal(r.terminal,false);
});
test('migration connection preserves SELL/HOLD monitoring but never enables spot BUY or generates perps orders',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'perps-fleet-'));t.after(()=>rm(dir,{recursive:true,force:true}));const kp=Keypair.generate(),product=tradingProduct({TRADING_PRODUCT:'solflare-perps'}),data={snapshot:()=>({markets:[]}),status:()=>({})},fleet=new AutomaticFleet(dir,data,{product,owner:kp.publicKey.toBase58(),legacyDir:dir,signerEnv:{LIVE_SIGNER_SECRET_KEY:bs58.encode(kp.secretKey)},execution:{network:async()=>{},balance:async()=>1,readModelMintFacts:()=>{throw Error('No new entry analysis during transition');}},modelClient:{verify:async()=>({verified:true}),status:()=>({configured:true}),settings:()=>({})}});
 await fleet.load();await fleet.connectWallet();assert.equal(fleet.state.running,false);assert.equal(fleet.treasury.signingReady(),true);assert.equal(fleet.admission().code,'PERPS_NOT_READY');await assert.rejects(fleet.pause(false),{code:'PERPS_NOT_READY'});
 const context=await fleet.prepareModelContext({wallet:{running:true},candidates:[{mint:'new'}],positions:[{mint:'old'}]});assert.equal(context.candidates.length,0);assert.equal(context.positions.length,1);assert.equal(context.wallet.running,false);assert.equal(context.transition.perpsEnabled,false);await fleet.stop();
});
