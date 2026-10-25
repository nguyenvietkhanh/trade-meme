import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';
import {Keypair,PublicKey} from '@solana/web3.js';import bs58 from 'bs58';
import {AutomaticTreasury} from '../src/automatic-treasury.js';
import {ACTIVE_BOT_CONFIGS} from '../src/paper-bot-config.js';
import {initialBotState} from '../src/paper-bot-state.js';
import {LiveModelBotRuntime} from '../src/live-model-runtime.js';
import {earnedAIProfit} from '../src/automatic-profit.js';
async function fixture(t){
 const dir=await mkdtemp(path.join(tmpdir(),'external-wallet-')),kp=Keypair.generate(),mint=Keypair.generate().publicKey.toBase58(),pool=Keypair.generate().publicKey.toBase58();t.after(()=>rm(dir,{recursive:true,force:true}));let now=Date.now(),held='100',receipt=null,balance=.8,reads=0,invalid=false;
 const execution={network:async()=>{},balance:async()=>balance,confirmedInventory:async()=>{reads++;return invalid?{complete:false,slot:40,balances:{}}:{complete:true,slot:40,balances:{[mint]:{rawAmount:held,rentLamports:0}}};},externalSaleReceipt:async()=>receipt,holdings:async()=>{if(held==='0')return [];const d=Buffer.alloc(165);new PublicKey(mint).toBuffer().copy(d);kp.publicKey.toBuffer().copy(d,32);d.writeBigUInt64LE(BigInt(held),64);return [{account:{data:d}}];},prepare:async()=>{throw Error('Must not sign or prepare an oversell');},send:async()=>{throw Error('Must not broadcast');}};
 const opts={owner:kp.publicKey.toBase58(),legacyDir:dir,clock:()=>now,signerEnv:{LIVE_SIGNER_SECRET_KEY:bs58.encode(kp.secretKey)}};let tr=new AutomaticTreasury(dir,execution,opts);await tr.load();await tr.connect();tr.s.initialSol=1;tr.s.positions=[{agentId:'kade',mint,pairAddress:pool,symbol:'CATTLEAXE',paperPositionId:'buy',rawQuantity:'100',quantity:.0001,decimals:6,costSol:.2,initialCostSol:.2,realizedPnlSol:0,aiStopLossPct:10,openedAt:now-20000,exitPolicy:ACTIVE_BOT_CONFIGS[0].exitPolicy}];tr.s.trades=[{id:'buy',side:'BUY',agentId:'kade',positionId:'buy',signature:'buy-signature',slot:10,at:now-20000}];await tr.save();
 return {get tr(){return tr;},mint,pool,get now(){return now;},get reads(){return reads;},set held(v){held=v;},set receipt(v){receipt=v;},set balance(v){balance=v;},set invalid(v){invalid=v;},advance:()=>{now+=5001;},reload:async()=>{tr=new AutomaticTreasury(dir,execution,opts);await tr.load();}};
}
const sellReceipt=(amount,sol)=>({signature:'manual-sale',slot:40,feeSol:.00002,decimals:6,tokenDelta:'-'+amount,solDelta:sol,rentDeltaLamports:0});
test('manual full sale reconciles from receipt, records actual PnL once and releases the stale SELL',async t=>{
 const f=await fixture(t);f.held='0';f.receipt=sellReceipt('100',.25);f.balance=1.05;
 await f.tr.sync();assert.equal(f.tr.s.netDepositsSol,.25,'native proceeds can arrive before token reconciliation');
 const result=await f.tr.request({id:'live:kade:stale-sell',side:'SELL',mint:f.mint,pairAddress:f.pool,positionId:'buy',amount:'100',decisionAt:f.now-3000,readyAt:f.now-1000},{mint:f.mint,pairAddress:f.pool},'kade');
 assert.equal(result.status,'wallet-changed');assert.equal(result.terminal,true);assert.equal(result.view.positions.length,0);assert.equal(f.tr.s.realizedPnlSol,.05);assert.equal(f.tr.s.trades[0].decisionEngine,'external-wallet');assert.match(f.tr.s.telegramOutbox[0].text,/VÍ CHỦ/);await f.tr.sync();assert.equal(f.tr.s.netDepositsSol,0);
 await f.reload();await f.tr.reconcileInventory();assert.equal(f.tr.s.trades.length,2);assert.equal(f.tr.s.realizedPnlSol,.05);
 const state={...initialBotState(ACTIVE_BOT_CONFIGS[0]),...f.tr.view('kade'),pending:{side:'SELL',mint:f.mint,positionId:'buy',amount:'100'},lastError:{code:'LIVE_TOKEN_BALANCE_CONFLICT'}};
 const runtime=new LiveModelBotRuntime(ACTIVE_BOT_CONFIGS[0],state,{ai:{enabled:true},save:async()=>{}});runtime.inventoryRevision=0;await runtime.tick({timestamp:f.now,markets:[]},f.now);assert.equal(state.pending,null);assert.equal(state.lastError,null);
});
test('manual partial sale keeps remaining raw units, basis and AI stop; oversized local SELL is dropped',async t=>{
 const f=await fixture(t);f.held='60';f.receipt=sellReceipt('40',.1);f.balance=.9;await f.tr.reconcileInventory();const p=f.tr.s.positions[0];assert.equal(p.rawQuantity,'60');assert.equal(p.costSol,.12);assert.equal(p.aiStopLossPct,10);assert.equal(f.tr.s.realizedPnlSol,.02);await f.tr.sync();assert.equal(f.tr.s.netDepositsSol,0);
 const state={...initialBotState(ACTIVE_BOT_CONFIGS[0]),...f.tr.view('kade'),pending:{side:'SELL',mint:f.mint,positionId:'buy',amount:'100'}};const runtime=new LiveModelBotRuntime(ACTIVE_BOT_CONFIGS[0],state,{ai:{enabled:true},save:async()=>{}});await runtime.tick({timestamp:f.now,markets:[]},f.now);assert.equal(state.pending,null);
});
test('unknown disposal needs two confirmed observations, never invents a sale/PnL/profit payout and survives restart',async t=>{
 const f=await fixture(t);f.held='0';await f.tr.reconcileInventory();assert.equal(f.tr.s.positions.length,1);f.advance();await f.tr.reconcileInventory();assert.equal(f.tr.s.positions.length,0);assert.equal(f.tr.s.trades[0].side,'EXTERNAL');assert.equal(f.tr.s.trades[0].pnlSol,null);assert.equal(f.tr.s.realizedPnlSol,0);assert.equal(earnedAIProfit(f.tr.s),0);assert.equal(f.tr.status().externalInventory.pnlUnknown,true);assert.equal(f.tr.s.netDepositsSol,-.2);await f.reload();assert.equal(f.tr.s.externalAdjustments.length,1);await f.tr.reconcileInventory();assert.equal(f.tr.s.externalAdjustments.length,1);
});
test('an incomplete RPC response and an app-signed pending order cannot remove a tracked position',async t=>{
 const f=await fixture(t);f.invalid=true;await assert.rejects(f.tr.reconcileInventory(),{code:'LIVE_INVENTORY_UNVERIFIED'});assert.equal(f.tr.s.positions[0].rawQuantity,'100');f.invalid=false;f.held='0';f.advance();f.tr.s.orders.x={terminal:false,signature:'pending-app-signature'};await f.tr.reconcileInventory();assert.equal(f.reads,1);assert.equal(f.tr.s.positions[0].rawQuantity,'100');
});
