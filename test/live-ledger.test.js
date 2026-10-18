import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {Keypair,PublicKey} from '@solana/web3.js';
import {LiveTrader} from '../src/live.js';
import {recordBuy} from '../src/engine.js';
import {DEFAULT_OWNER} from '../src/security.js';
const kp=Keypair.generate(),mint=Keypair.generate().publicKey.toBase58();
const market={mint,symbol:'TEST',priceUsd:.01,updatedAt:Date.now()};
async function setup(fn){const dir=await mkdtemp(path.join(tmpdir(),'live-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
test('write-ahead signature exists before broadcast; no fill until chain confirmation; reconciliation applies once',async()=>setup(async dir=>{
 let sent=0;const vault={keypair:kp,publicKey:kp.publicKey.toBase58(),apiKey:'fake-test-api'};
 const execution={mintCheck:async()=>({decimals:9}),prepare:async request=>{assert.equal(request.amount,'200000000');return {signature:'test-signature',lastValidBlockHeight:100,bytes:new Uint8Array()};},send:async()=>{const disk=JSON.parse(await readFile(path.join(dir,'live-state.json'),'utf8'));assert.equal(disk.pending.status,'signed');sent++;return 'test-signature';},status:async()=>({confirmationStatus:'confirmed'}),receipt:async()=>({solDelta:-.2001,tokenDelta:450000000000n,rawBalance:'450000000000',decimals:9,slot:10})};
 const live=new LiveTrader(dir,vault,execution);live.state.cashSol=.3;
 await live.submit(market,'BUY',1,'test',150);assert.equal(sent,1);assert.equal(live.state.positions.length,0);assert.equal(live.state.pending.status,'broadcast');
 await live.reconcile([market],150);assert.equal(live.state.positions.length,1);assert.equal(live.state.trades[0].mode,'live');assert.equal(live.state.trades[0].signature,'test-signature');assert.ok(Math.abs(live.state.cashSol-.0999)<1e-9);await live.reconcile([market],150);assert.equal(live.state.positions.length,1);assert.equal(live.state.journal.length,1);
}));
test('unknown transaction blocks new orders and is not silently replaced after expiry',async()=>setup(async dir=>{
 let sent=0;const vault={keypair:kp,publicKey:kp.publicKey.toBase58(),apiKey:'fake-test-api'};
 const execution={status:async()=>null,height:async()=>101,send:async()=>{sent++;}};
 const live=new LiveTrader(dir,vault,execution);live.state.pending={signature:'unknown',lastValidBlockHeight:100,status:'broadcast'};live.state.enabled=true;
 await assert.rejects(live.submit(market,'BUY',1,'test',150));await live.reconcile([market],150);assert.equal(live.state.pending,null);assert.equal(live.state.enabled,false);assert.equal(live.state.journal[0].status,'expired');assert.equal(sent,0);
}));
test('missing signer, oversized initial funding and budget violations cannot send funds',async()=>setup(async dir=>{
 let sent=0;const execution={network:async()=>{},balance:async()=>1.2,send:async()=>{sent++;}};
 const vault={keypair:null,publicKey:kp.publicKey.toBase58(),apiKey:null};const live=new LiveTrader(dir,vault,execution);
 await assert.rejects(live.enable('ENABLE MAINNET 1.19 SOL'));vault.keypair=kp;await assert.rejects(live.enable('ENABLE MAINNET 1.19 SOL'));vault.apiKey='test-api';await assert.rejects(live.enable('ENABLE MAINNET 1.19 SOL'));live.state.cashSol=.06;await assert.rejects(live.submit(market,'BUY',1,'test',150));assert.equal(sent,0);
}));
test('reserve limits stop new buys without disabling management of existing positions',async()=>setup(async dir=>{
 let sends=0;const vault={keypair:kp,publicKey:kp.publicKey.toBase58(),apiKey:'test-key'};
 const execution={balance:async()=>.06,holdings:async()=>[],prepare:async()=>{sends++;throw Error('must not prepare');}};
 const live=new LiveTrader(dir,vault,execution);Object.assign(live.state,{cashSol:.06,funded:true,enabled:true,dayStartEquity:.06,peakEquity:.06});
 const m={...market,dexId:'pumpswap',hasProfile:true,pairCreatedAt:Date.now()-86400000,valuationUsd:1000000,valuationSource:'marketCap',liquidityUsd:250000,volume24hUsd:1000000,volume5mUsd:10000,volume1hUsd:30000,change5mPct:3,change1hPct:10,change6hPct:20,change24hPct:30,buys5m:40,sells5m:5,signalConfirmed:true};
 await live.tick({markets:[m],solUsd:100,updatedAt:Date.now()});assert.equal(sends,0);assert.equal(live.state.enabled,true);assert.equal(live.state.lastError,null);
}));
test('mainnet recovery adjusts the raw sell size to a net quote and broadcasts only the final transaction',async()=>setup(async dir=>{
 const vault={keypair:kp,publicKey:kp.publicKey.toBase58(),apiKey:'test-key'};let quotes=0,sends=0;
 const execution={prepare:async request=>{quotes++;if(quotes===2)assert.ok(BigInt(request.amount)>2333333333n);return {signature:'final-'+quotes,lastValidBlockHeight:100,bytes:new Uint8Array(),minNativeOutLamports:quotes===1?40000000n:42500000n};},send:async()=>{sends++;return 'final-2';}};
 const live=new LiveTrader(dir,vault,execution);live.state.cashSol=.3;
 recordBuy(live.state,{...market,priceUsd:1},100,{quantity:3,costSol:.03,priceUsd:1,rawQuantity:'3000000000',decimals:9},Date.now(),'test','live');
 await live.submit({...market,priceUsd:1.8},'SELL',7/9,'recover-capital',100);
 assert.equal(quotes,2);assert.equal(sends,1);assert.equal(live.state.pending.signature,'final-2');assert.equal(live.state.trades.length,1);
}));
test('five live positions keep exit management enabled, and missing held prices block additional risk',async()=>setup(async dir=>{
 let prepares=0;const held=[],vault={keypair:kp,publicKey:kp.publicKey.toBase58(),apiKey:'test-key'};
 const execution={balance:async()=>.15,holdings:async()=>held.map(m=>{const data=Buffer.alloc(165);new PublicKey(m.mint).toBuffer().copy(data);data.writeBigUInt64LE(3000000000n,64);return {account:{data}};}),prepare:async()=>{prepares++;throw Error('must not buy');}};
 const live=new LiveTrader(dir,vault,execution);live.state.cashSol=.3;
 for(let i=0;i<5;i++){const m={...market,mint:Keypair.generate().publicKey.toBase58(),priceUsd:1};held.push(m);recordBuy(live.state,m,100,{quantity:3,costSol:.03,priceUsd:1,rawQuantity:'3000000000',decimals:9},Date.now(),'test','live');}
 Object.assign(live.state,{enabled:true,funded:true});
 const candidate={...market,dexId:'pumpswap',hasProfile:true,pairCreatedAt:Date.now()-86400000,valuationUsd:1000000,valuationSource:'marketCap',liquidityUsd:250000,volume24hUsd:1000000,volume5mUsd:10000,volume1hUsd:30000,change5mPct:3,change1hPct:10,change6hPct:20,change24hPct:30,buys5m:40,sells5m:5,signalConfirmed:true};
 await live.tick({markets:[...held,candidate],solUsd:100,updatedAt:Date.now()});assert.equal(live.state.enabled,true);assert.equal(prepares,0);assert.equal(live.state.entryBlockedReason,null);
 await live.tick({markets:[...held.slice(1),candidate],solUsd:100,updatedAt:Date.now()});assert.equal(live.state.enabled,true);assert.equal(prepares,0);assert.ok(live.state.entryBlockedReason.includes('Chưa có giá'));
}));
test('withdrawal only returns to the pinned owner and returned capital is recorded separately from losses',async()=>setup(async dir=>{
 const vault={keypair:kp,publicKey:kp.publicKey.toBase58(),apiKey:'test-key',status:()=>({})};let sends=0;
 const execution={withdrawal:async(key,recipient)=>{assert.equal(recipient,DEFAULT_OWNER);return {signature:'withdraw-test',lastValidBlockHeight:100,amountLamports:299990000,bytes:new Uint8Array()};},send:async()=>{sends++;return 'withdraw-test';},status:async()=>({confirmationStatus:'confirmed'}),receipt:async()=>({solDelta:-.299995,slot:51})};
 const live=new LiveTrader(dir,vault,execution);assert.equal(live.state.cashSol,0);assert.equal(live.state.peakEquity,0);live.state.cashSol=.3;
 await assert.rejects(live.withdraw(mint,'WITHDRAW TO OWNER'));assert.equal(sends,0);
 await live.withdraw(DEFAULT_OWNER,'WITHDRAW TO OWNER');await live.reconcile([],100);
 assert.equal(sends,1);assert.equal(live.state.withdrawnSol,.29999);assert.ok(Math.abs(live.state.cashSol+live.state.withdrawnSol-.3+.000005)<1e-9);assert.equal(live.state.enabled,false);
}));
test('unexplained deposits stop signing and display the observed RPC balance without rewriting the ledger',async()=>setup(async dir=>{
 const vault={keypair:kp,publicKey:kp.publicKey.toBase58(),apiKey:'test-key',status:()=>({})};
 const live=new LiveTrader(dir,vault,{balance:async()=>.31});Object.assign(live.state,{funded:true,enabled:true,cashSol:.3});
 await live.tick({markets:[],solUsd:100,updatedAt:Date.now()});assert.equal(live.state.enabled,false);assert.equal(live.state.balanceMismatch,true);assert.equal(live.state.cashSol,.3);assert.equal(live.status().balanceSol,.31);assert.ok(live.state.lastError.includes('ngoài sổ'));
}));
