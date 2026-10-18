import {verifiedMarket} from './fixtures/verified-market.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Keypair,PublicKey,TransactionMessage,VersionedTransaction,SystemProgram} from '@solana/web3.js';
import bs58 from 'bs58';
import {OwnerSignerVault} from '../src/owner-vault.js';
import {OwnerAgent,signerRequestAllowed} from '../src/owner-agent.js';
import {DirectWallet,verifyOwnerTransaction} from '../src/direct-wallet.js';
import {TradePolicyError} from '../src/solana.js';
import {PROFIT_RECIPIENT} from '../src/profit.js';
const password='unit-fixture-password-123456';
async function fixture(){
 const dir=await mkdtemp('/tmp/meme-owner-agent-'),kp=Keypair.generate(),owner=kp.publicKey.toBase58(),mint=Keypair.generate().publicKey.toBase58();let sends=0,balanceSol=.3;
 const market=()=>verifiedMarket({mint,priceUsd:1,pairAddress:'11111111111111111111111111111112'});
 const feed=()=>({markets:[market()],solUsd:100,updatedAt:Date.now()});
 const transaction=(to,lamports)=>new VersionedTransaction(new TransactionMessage({payerKey:kp.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:kp.publicKey,toPubkey:to,lamports})]}).compileToV0Message());
 const execution={provider:'Fixture RPC',network:async()=>{},balance:async()=>balanceSol,holdings:async()=>[],mintCheck:async()=>{},height:async()=>100,prepare:async r=>{assert.equal(r.amount,'200000000');return {bytes:transaction(Keypair.generate().publicKey,200000000).serialize(),lastValidBlockHeight:200};},prepareProfit:async(_owner,amount)=>({bytes:transaction(new PublicKey(PROFIT_RECIPIENT),amount).serialize(),lastValidBlockHeight:200}),send:async bytes=>{const signed=verifyOwnerTransaction(Buffer.from(bytes).toString('base64'),owner),stored=JSON.parse(await readFile(path.join(dir,'owner-agent-state.json'),'utf8'));assert.equal(stored.pending.signature,signed.signature);assert.equal(stored.pending.transaction,Buffer.from(bytes).toString('base64'));sends++;return signed.signature;},status:async()=>({confirmationStatus:'confirmed'}),receipt:async()=>{balanceSol=.0999;return {slot:100,solDelta:-.2001,tokenDelta:20000000n,decimals:6,feeSol:.00002};},profitReceipt:async(_sig,_owner,amount)=>({slot:100,amountLamports:amount,recipient:PROFIT_RECIPIENT,solDelta:-Number(amount)/1e9-.000005,feeSol:.000005})};
 const direct=new DirectWallet(execution);direct.owner=owner;const agent=new OwnerAgent(dir,direct,execution,owner);agent.vault.keypair=kp;
 return {dir,kp,owner,mint,execution,direct,agent,feed,get sends(){return sends;},cleanup:()=>rm(dir,{recursive:true,force:true})};
}
test('owner vault imports only the specified existing wallet, encrypts at rest, rejects overwrite and locks on restart',async()=>{
 const f=await fixture();try{
  const file=path.join(f.dir,'vault.json'),vault=new OwnerSignerVault(file,f.owner),secret=bs58.encode(f.kp.secretKey);
  await assert.rejects(vault.importKey(bs58.encode(Keypair.generate().secretKey),password),/ví chủ/);await vault.importKey(secret,password);
  const contents=await readFile(file,'utf8');assert.ok(!contents.includes(secret));assert.ok(!contents.includes(password));await assert.rejects(vault.importKey(secret,password),/ghi đè/);
  const reopened=new OwnerSignerVault(file,f.owner);await reopened.load();assert.equal(reopened.status().unlocked,false);await assert.rejects(reopened.unlock('wrong-password'));await reopened.unlock(password);assert.equal(reopened.keypair.publicKey.toBase58(),f.owner);reopened.lock();
  const concurrent=new OwnerSignerVault(file,f.owner);await assert.rejects(concurrent.importKey(secret,password));assert.equal(await readFile(file,'utf8'),contents);
  const tampered=JSON.parse(contents);tampered.tag=Buffer.alloc(16).toString('base64');await writeFile(file,JSON.stringify(tampered));await assert.rejects(reopened.unlock(password));assert.equal(reopened.keypair,null);
 }finally{await f.cleanup();}
});
test('the server signs without a browser and durably journals before broadcasting; a restart reconciles without keys or resending',async()=>{
 const f=await fixture();try{
  await f.agent.enable();assert.equal(f.agent.state.settings.initialSol,.3);await f.agent.tick(f.feed());assert.equal(f.sends,1);assert.ok(f.agent.state.pending);assert.equal(f.agent.state.trades.length,0);
  const newDirect=new DirectWallet(f.execution);newDirect.owner=f.owner;const restarted=new OwnerAgent(f.dir,newDirect,f.execution,f.owner);await restarted.load();assert.equal(restarted.vault.keypair,null);assert.equal(restarted.state.running,false);
  await restarted.tick(f.feed());assert.equal(restarted.state.pending,null);assert.equal(restarted.state.trades.length,1);assert.equal(restarted.state.positions[0].rawQuantity,'20000000');assert.equal(f.sends,1);
  const status=await restarted.status();assert.ok(!JSON.stringify(status).includes(bs58.encode(f.kp.secretKey)));assert.equal(status.vault.unlocked,false);await restarted.tick(f.feed());assert.equal(f.sends,1);
 }finally{await f.cleanup();}
});
test('the autonomous agent transfers confirmed realized profit to the fixed recipient without a wallet prompt',async()=>{
 const f=await fixture();try{
  await f.agent.enable();Object.assign(f.agent.state,{cashSol:.32,realizedNetSol:.02});f.execution.balance=async()=>.32;
  await f.agent.tick(f.feed());assert.equal(f.agent.state.pending.intent.side,'PROFIT');assert.equal(f.agent.state.pending.intent.recipient,PROFIT_RECIPIENT);assert.equal(f.agent.state.withdrawnSol,0);
  await f.agent.tick(f.feed());assert.equal(f.agent.state.payouts.length,1);assert.equal(f.agent.state.withdrawnSol,.01999);assert.equal(f.agent.state.pending,null);assert.ok(f.agent.state.cashSol>=.3);assert.equal(f.sends,1);
 }finally{await f.cleanup();}
});

test('enable upgrades an existing allocated budget using confirmed wallet capital without resetting history, then persists it',async()=>{
 const f=await fixture();try{
  await f.agent.enable();await f.agent.tick(f.feed());await f.agent.tick(f.feed());await f.agent.pause();
  const oldPosition=structuredClone(f.agent.state.positions[0]),oldTrade=structuredClone(f.agent.state.trades[0]);
  f.execution.balance=async()=>.9899;await f.agent.enable();
  assert.equal(f.agent.state.settings.initialSol,1.19);assert.ok(Math.abs(f.agent.state.cashSol-.9899)<1e-12);
  assert.deepEqual(f.agent.state.positions[0],oldPosition);assert.deepEqual(f.agent.state.trades[0],oldTrade);assert.equal(f.sends,1);
  const restarted=new OwnerAgent(f.dir,f.direct,f.execution,f.owner);await restarted.load();
  assert.equal(restarted.state.settings.initialSol,1.19);assert.equal(restarted.state.settings.orderSol,.2);assert.equal(restarted.state.settings.maxPositions,null);
  assert.deepEqual(restarted.state.positions[0],oldPosition);assert.deepEqual(restarted.state.trades[0],oldTrade);assert.equal(restarted.state.running,false);
 }finally{await f.cleanup();}
});

test('a running agent durably records confirmed top-up capital before preparing its next 0.2 SOL buy',async()=>{
 const f=await fixture();try{
  await f.agent.enable();f.execution.balance=async()=>1.19;await f.agent.tick(f.feed());
  const stored=JSON.parse(await readFile(f.agent.file,'utf8'));
  assert.equal(stored.settings.initialSol,1.19);assert.equal(stored.cashSol,1.19);assert.equal(stored.pending.intent.amount,'200000000');
  assert.equal(stored.capitalAllocations[0].amountSol,.89);assert.equal(stored.realizedNetSol,0);assert.equal(f.sends,1);
 }finally{await f.cleanup();}
});

test('transient preparation failures recover only after two healthy scans with post-failure verified quotes, retaining retry limits',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);const f=await fixture();try{
  await f.agent.enable();const original=f.execution.prepare;f.execution.prepare=async()=>{throw Error('Jupiter HTTP 429');};
  for(let i=0;i<3;i++){now+=5000;await f.agent.tick(f.feed());}
  assert.equal(f.agent.state.buyCircuitOpen,true);assert.equal(f.agent.state.buyCircuitKind,'network');assert.equal(f.sends,0);
  f.execution.prepare=original;now+=5000;const stale=f.feed();stale.markets[0].evidence.quoteCheckedAt=f.agent.state.buyCircuitOpenedAt-1;await f.agent.tick(stale);assert.equal(f.agent.state.networkHealthyScans,0);
  for(let i=0;i<2;i++){now+=5000;const feed=f.feed();feed.markets[0].evidence.quoteCheckedAt=now;await f.agent.tick(feed);if(i===0){assert.equal(f.agent.state.buyCircuitOpen,true);assert.equal(f.sends,0);}}
  assert.equal(f.agent.state.buyCircuitOpen,false);assert.equal(f.agent.state.buyCircuitKind,null);assert.equal(f.agent.state.pending.intent.amount,'200000000');assert.equal(f.sends,1);assert.equal(f.agent.state.orderAttempts['BUY:'+f.mint+':fixed'],4);
 }finally{await f.cleanup();}
});

test('healthy market and RPC probes never automatically clear failed-transaction or legacy unlabeled circuits',async()=>{
 const f=await fixture();try{
  await f.agent.enable();Object.assign(f.agent.state,{buyCircuitOpen:true,buyCircuitKind:'execution',buyCircuitOpenedAt:Date.now()-10000});
  for(let i=0;i<2;i++){const feed=f.feed();feed.markets[0].evidence.quoteCheckedAt=Date.now();await f.agent.tick(feed);}
  assert.equal(f.agent.state.buyCircuitOpen,true);assert.equal(f.agent.state.buyCircuitKind,'execution');assert.equal(f.sends,0);
  delete f.agent.state.buyCircuitKind;const feed=f.feed();feed.markets[0].evidence.quoteCheckedAt=Date.now();await f.agent.tick(feed);assert.equal(f.agent.state.buyCircuitOpen,true);assert.equal(f.sends,0);
 }finally{await f.cleanup();}
});

test('a 503 during pending receipt reconciliation preserves the signed order, never rebroadcasts and can resume',async()=>{
 const f=await fixture();try{
  await f.agent.enable();await f.agent.tick(f.feed());const pending=structuredClone(f.agent.state.pending),original=f.execution.status;
  f.execution.status=async()=>{throw Error('HTTP 503');};await f.agent.tick(f.feed());assert.equal(f.agent.state.running,true);assert.deepEqual(f.agent.state.pending,pending);assert.equal(f.sends,1);
  f.execution.status=original;await f.agent.tick(f.feed());assert.equal(f.agent.state.pending,null);assert.equal(f.agent.state.trades.length,1);assert.equal(f.sends,1);
 }finally{await f.cleanup();}
});

test('Telegram outbox is committed only with a new confirmed trade and network delivery runs separately',async()=>{
 const f=await fixture();try{
  await f.agent.telegram.configure('123456789:fixture_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789','123456789',f.kp);
  let reports=0;f.agent.telegram.fetcher=async()=>{reports++;const disk=JSON.parse(await readFile(f.agent.file,'utf8'));assert.equal(disk.trades.length,1);assert.equal(disk.telegramOutbox[0].attempts,1);return new Response(JSON.stringify({ok:true,result:{message_id:123}}));};
  await f.agent.enable();await f.agent.tick(f.feed());await f.agent.telegram.tick(f.agent);assert.equal(reports,0);assert.equal(f.agent.state.trades.length,0);
  await f.agent.tick(f.feed());assert.equal(f.agent.state.telegramOutbox.length,1);assert.equal(reports,0);assert.ok(f.agent.state.telegramOutbox[0].text.includes('MUA ĐÃ XÁC NHẬN'));
  await f.agent.telegram.tick(f.agent);await f.agent.telegram.tick(f.agent);assert.equal(reports,1);assert.equal(f.sends,1);
 }finally{await f.cleanup();}
});
test('a failed durable write never broadcasts and an invalid token is skipped with cooldown instead of stopping the service',async()=>{
 const f=await fixture();try{
  await f.agent.enable();f.execution.mintCheck=async()=>{throw new TradePolicyError('unsafe token');};await f.agent.tick(f.feed());assert.equal(f.sends,0);assert.ok(f.agent.state.cooldowns[f.mint]>Date.now());assert.equal(f.agent.state.running,true);
  delete f.agent.state.cooldowns[f.mint];f.agent.lastDecisionFeed=null;f.execution.mintCheck=async()=>{};const saved=f.agent.save.bind(f.agent);let writes=0;f.agent.save=async()=>{if(++writes===3)throw Error('disk full');return saved();};await f.agent.tick(f.feed());assert.equal(f.sends,0);assert.ok(f.agent.state.pending?.signature);assert.equal(f.agent.state.running,false);
 }finally{await f.cleanup();}
});
test('pause interrupts preparation before signing; locking still clears the key if saving fails',async()=>{
 const f=await fixture();try{
  await f.agent.enable();const original=f.execution.prepare;let resolve,entered;const ready=new Promise(r=>entered=r);f.execution.prepare=async r=>{entered();await new Promise(r=>resolve=r);return original(r);};
  const tick=f.agent.tick(f.feed());await ready;const stopped=f.agent.pause(true);resolve();await Promise.all([tick,stopped]);assert.equal(f.sends,0);assert.equal(f.agent.state.pending,null);assert.equal(f.agent.state.running,false);assert.equal(f.agent.vault.keypair,null);
  f.agent.vault.keypair=f.kp;f.agent.save=async()=>{throw Error('disk full');};await assert.rejects(f.agent.pause(true));assert.equal(f.agent.vault.keypair,null);
 }finally{await f.cleanup();}
});
test('private-key entry is restricted to configured Railway HTTPS or real loopback requests',()=>{
 const request={socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:3000'}};assert.equal(signerRequestAllowed(request,null,false),true);assert.equal(signerRequestAllowed({...request,headers:{host:'evil.example:3000'}},null,false),false);assert.equal(signerRequestAllowed({...request,socket:{remoteAddress:'192.168.1.20'}},null,false),false);assert.equal(signerRequestAllowed(request,'http://example.com',true),false);assert.equal(signerRequestAllowed(request,'https://trade-meme-production.up.railway.app',true),true);
});
test('pausing and resuming keeps a valid command epoch, and drawdown review never enables the signer',async()=>{
 const f=await fixture();try{
  await f.agent.enable();await f.agent.pause();assert.ok(Number.isSafeInteger(f.agent.commandEpoch));await f.agent.enable();await f.agent.tick(f.feed());assert.equal(f.sends,1);await f.agent.tick(f.feed());
  await f.agent.pause();Object.assign(f.agent.state,{haltKind:'drawdown',halted:'review-required',dailyLossBlocked:true});
  await assert.rejects(f.agent.enable(),/review-required/);
  f.agent.state.positions=[];const market=f.feed().markets[0];await f.agent.reviewRisk({markets:[market],solUsd:100,updatedAt:Date.now()});assert.equal(f.agent.state.running,false);assert.equal(f.agent.state.haltKind,null);assert.equal(f.agent.state.dailyLossBlocked,false);assert.equal(f.agent.state.pending,null);
 }finally{await f.cleanup();}
});
test('a failed preparation gets at most three retries and unknown signed outcomes never start another attempt',async()=>{
 const f=await fixture();try{
  await f.agent.enable();let attempts=0;f.execution.prepare=async()=>{attempts++;throw Error('quote policy failure');};
  const order={side:'BUY',mint:f.mint,symbol:'TEST',reason:'test'};
  for(let i=0;i<4;i++)await assert.rejects(f.agent.execute(order,f.feed()),/quote policy/);
  await assert.rejects(f.agent.execute(order,f.feed()),/3 lần retry/);assert.equal(attempts,4);assert.equal(f.sends,0);
 }finally{await f.cleanup();}
});
test('kill and BUY-pause during RPC reads prevent a buy from reaching the signer',async()=>{
 for(const mode of ['kill','pause-buy']){const f=await fixture();try{
  await f.agent.enable();let entered,resolve;const ready=new Promise(r=>entered=r);f.execution.balance=async()=>{entered();await new Promise(r=>resolve=r);return .3;};
  const tick=f.agent.tick(f.feed());await ready;const stopped=mode==='kill'?f.agent.pause(true):f.agent.pauseBuys();resolve();await Promise.all([tick,stopped]);assert.equal(f.sends,0);assert.equal(f.agent.state.pending,null);
 }finally{await f.cleanup();}}
});

test('unmanaged wallet tokens do not block starting or buying another mint and are not automatically adopted',async()=>{
 const f=await fixture();try{
  const oldMint=Keypair.generate().publicKey.toBase58(),data=Buffer.alloc(165);new PublicKey(oldMint).toBuffer().copy(data,0);f.kp.publicKey.toBuffer().copy(data,32);data.writeBigUInt64LE(13523538793n,64);
  f.execution.holdings=async(_owner,mint)=>!mint||mint===oldMint?[{account:{data}}]:[];
  await f.agent.enable();await f.agent.inventoryTask;assert.equal(f.agent.state.running,true);assert.equal(f.agent.state.positions.length,0);
  const status=await f.agent.status();assert.equal(status.wallet.inventory[0].mint,oldMint);assert.equal(status.wallet.inventory[0].tracked,false);assert.equal(status.wallet.tokenBalances[oldMint],'13523538793');assert.ok(status.recoveryMessage.includes('tùy chọn'));assert.notEqual(status.entryStatus.phase,'ledger-review');
  await f.agent.tick(f.feed());assert.equal(f.sends,1);assert.equal(f.agent.state.pending.intent.mint,f.mint);
 }finally{await f.cleanup();}
});
test('restart preserves confirmed positions and both journal copies; a missing primary loads the backup paused for normal owner re-enable',async()=>{
 const f=await fixture();try{
  await f.agent.enable();await f.agent.tick(f.feed());await f.agent.tick(f.feed());assert.equal(f.agent.state.positions.length,1);
  assert.equal(await readFile(f.agent.file,'utf8'),await readFile(f.agent.backupFile,'utf8'));
  const restarted=new OwnerAgent(f.dir,f.direct,f.execution,f.owner);await restarted.load();assert.equal(restarted.state.positions[0].rawQuantity,'20000000');assert.ok(Math.abs(restarted.state.cashSol-.0999)<1e-12);assert.equal(restarted.state.trades.length,1);assert.equal(restarted.state.running,false);
  await rm(f.agent.file);const fallback=new OwnerAgent(f.dir,f.direct,f.execution,f.owner);await fallback.load();assert.equal(fallback.state.positions.length,1);assert.equal(fallback.state.recoveryRequired,true);assert.equal(fallback.state.running,false);assert.equal(fallback.state.buyPaused,true);
 }finally{await f.cleanup();}
});
test('a missing primary with a signed backup still reconciles exactly once and never rebroadcasts',async()=>{
 const f=await fixture();try{
  await f.agent.enable();await f.agent.tick(f.feed());assert.equal(f.sends,1);await rm(f.agent.file);
  const direct=new DirectWallet(f.execution);direct.owner=f.owner;const restarted=new OwnerAgent(f.dir,direct,f.execution,f.owner);await restarted.load();assert.ok(restarted.state.pending.transaction);await restarted.tick(f.feed());await restarted.tick(f.feed());assert.equal(restarted.state.positions.length,1);assert.equal(restarted.state.trades.length,1);assert.equal(f.sends,1);assert.equal(restarted.state.recoveryRequired,true);
 }finally{await f.cleanup();}
});
test('Railway ephemeral storage does not block BUY, confirmed receipts or subsequent position management',async()=>{
 const f=await fixture();try{
  const agent=new OwnerAgent(f.dir,f.direct,f.execution,f.owner,{storageMode:'ephemeral'});agent.vault.keypair=f.kp;
  await agent.enable();assert.equal(agent.state.running,true);await agent.tick(f.feed());assert.equal(agent.state.pending.intent.side,'BUY');assert.equal(f.sends,1);
  await agent.tick(f.feed());assert.equal(agent.state.positions.length,1);assert.equal(agent.state.trades.length,1);assert.equal(agent.state.pending,null);assert.equal(agent.state.storageBlockedReason,null);
  const status=await agent.status();assert.equal(status.storageMode,'ephemeral');assert.notEqual(status.entryStatus.phase,'ledger-review');
 }finally{await f.cleanup();}
});
test('full-wallet inventory failure does not block enable or BUY, while a per-token balance failure cannot sign',async()=>{
 const f=await fixture();try{
  f.execution.holdings=async(_owner,mint)=>{if(!mint)throw Error('full inventory RPC unavailable');return [];};
  await f.agent.enable();await f.agent.inventoryTask;assert.equal(f.agent.state.running,true);assert.ok(f.agent.inventoryError);await f.agent.tick(f.feed());assert.equal(f.sends,1);assert.equal(f.agent.state.pending.intent.side,'BUY');
  const status=await f.agent.status();assert.ok(status.wallet.inventoryError);assert.notEqual(status.entryStatus.phase,'ledger-review');assert.equal(status.error,null);
 }finally{await f.cleanup();}
 const f2=await fixture();try{f2.execution.holdings=async()=>{throw Error('RPC unavailable');};await f2.agent.enable();await f2.agent.tick(f2.feed());assert.equal(f2.sends,0);assert.equal(f2.agent.state.pending,null);}finally{await f2.cleanup();}
});
test('a stalled full-wallet inventory is independent of owner enable and a valid trade',async()=>{
 const f=await fixture();let release;const wait=new Promise(r=>release=r);try{
  f.execution.holdings=async(_owner,mint)=>{if(!mint)await wait;return [];};
  await f.agent.enable();assert.equal(f.agent.state.running,true);assert.ok(f.agent.inventoryTask);
  await f.agent.tick(f.feed());assert.equal(f.sends,1);assert.ok(f.agent.inventoryTask);
 }finally{release();await f.agent.inventoryTask;await f.cleanup();}
});
test('legacy recovery and storage BUY locks do not survive explicit enable; incomplete profit remains protected',async()=>{
 const f=await fixture();try{
  await f.agent.enable();await f.agent.pause();Object.assign(f.agent.state,{recoveryRequired:true,buyPaused:true,storageBlockedReason:'legacy-volume-lock',entryStatus:{phase:'ledger-review',message:'old lock'}});
  const before=f.agent.state.cashSol;await f.agent.enable();assert.equal(f.agent.state.buyPaused,false);assert.equal(f.agent.state.storageBlockedReason,null);assert.equal(f.agent.state.recoveryRequired,true);assert.equal(f.agent.state.cashSol,before);assert.equal(f.agent.state.entryStatus,undefined);
  await f.agent.tick(f.feed());assert.equal(f.sends,1);assert.equal(f.agent.state.pending.intent.side,'BUY');
 }finally{await f.cleanup();}
});

test('restarting or restoring more than five positions preserves them and migrates the old count cap',async()=>{
 const f=await fixture();try{
  const {recordBuy}=await import('../src/engine.js');await f.agent.enable();await f.agent.pause();
  for(let i=0;i<7;i++){const mint=Keypair.generate().publicKey.toBase58(),m=verifiedMarket({mint,priceUsd:1});recordBuy(f.agent.state,m,100,{quantity:2,costSol:.0201,priceUsd:1,rawQuantity:'2000000',decimals:6,signature:'restore-many-'+i},Date.now(),'fixture','live');}
  f.agent.state.settings.maxPositions=2;const cash=f.agent.state.cashSol;await f.agent.save();
  const restarted=new OwnerAgent(f.dir,f.direct,f.execution,f.owner);await restarted.load();assert.equal(restarted.state.positions.length,7);assert.equal(restarted.state.trades.length,7);assert.equal(restarted.state.cashSol,cash);assert.equal(restarted.state.settings.maxPositions,null);assert.equal(restarted.state.running,false);
  await restarted.restore(JSON.parse(await readFile(f.agent.file,'utf8')));assert.equal(restarted.state.positions.length,7);assert.equal(restarted.state.cashSol,cash);
 }finally{await f.cleanup();}
});
