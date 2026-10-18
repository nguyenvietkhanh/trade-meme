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
 const dir=await mkdtemp('/tmp/meme-owner-agent-'),kp=Keypair.generate(),owner=kp.publicKey.toBase58(),mint=Keypair.generate().publicKey.toBase58();let sends=0;
 const market=()=>verifiedMarket({mint,priceUsd:1,pairAddress:'11111111111111111111111111111112'});
 const feed=()=>({markets:[market()],solUsd:100,updatedAt:Date.now()});
 const transaction=(to,lamports)=>new VersionedTransaction(new TransactionMessage({payerKey:kp.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:kp.publicKey,toPubkey:to,lamports})]}).compileToV0Message());
 const execution={provider:'Fixture RPC',network:async()=>{},balance:async()=>.3,holdings:async()=>[],mintCheck:async()=>{},height:async()=>100,prepare:async r=>{assert.equal(r.amount,'30000000');return {bytes:transaction(Keypair.generate().publicKey,30000000).serialize(),lastValidBlockHeight:200};},prepareProfit:async(_owner,amount)=>({bytes:transaction(new PublicKey(PROFIT_RECIPIENT),amount).serialize(),lastValidBlockHeight:200}),send:async bytes=>{const signed=verifyOwnerTransaction(Buffer.from(bytes).toString('base64'),owner),stored=JSON.parse(await readFile(path.join(dir,'owner-agent-state.json'),'utf8'));assert.equal(stored.pending.signature,signed.signature);assert.equal(stored.pending.transaction,Buffer.from(bytes).toString('base64'));sends++;return signed.signature;},status:async()=>({confirmationStatus:'confirmed'}),receipt:async()=>({slot:100,solDelta:-.0301,tokenDelta:3000000n,decimals:6,feeSol:.00002}),profitReceipt:async(_sig,_owner,amount)=>({slot:100,amountLamports:amount,recipient:PROFIT_RECIPIENT,solDelta:-Number(amount)/1e9-.000005,feeSol:.000005})};
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
  await restarted.tick(f.feed());assert.equal(restarted.state.pending,null);assert.equal(restarted.state.trades.length,1);assert.equal(restarted.state.positions[0].rawQuantity,'3000000');assert.equal(f.sends,1);
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
  f.agent.state.positions=[];const market=f.feed().markets[0];await f.agent.reviewRisk({markets:[market],solUsd:100,updatedAt:Date.now()});assert.equal(f.agent.state.running,false);assert.equal(f.agent.state.haltKind,'daily');assert.equal(f.agent.state.pending,null);
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
