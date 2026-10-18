import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {pumpFixture} from './fixtures/pump-rpc.js';
import {buildPumpSwap} from '../src/pump-swap.js';
import {SOL,exitPlan,DEFAULTS,recordSell,equity} from '../src/engine.js';
import {purchaseSignature,verifyPurchase,adoptPurchase,inventoryBalances} from '../src/recovery.js';
import {createOwnerLedger,nextOwnerOrder} from '../src/owner-ledger.js';
const signature=bs58.encode(Buffer.alloc(64,7));
async function fixture(amount='20000000'){
 const f=await pumpFixture(),owner=f.user.toBase58(),mint=f.mint.toBase58(),raw=13523538793n;
 const built=await buildPumpSwap(f.rpc,{owner:f.user,input:SOL,output:mint,amount,poolAddress:f.poolKey.toBase58()}),msg=built.tx.message;
 const accountKeys=msg.staticAccountKeys.map((pubkey,i)=>({pubkey,signer:msg.isAccountSigner(i),writable:msg.isAccountWritable(i)}));
 const balances=msg.staticAccountKeys.map(()=>0),preBalances=[...balances],postBalances=[...balances];preBalances[0]=300000000;postBalances[0]=300000000-Number(amount)-1346200;
 const row={accountIndex:msg.staticAccountKeys.findIndex(k=>k.equals(f.baseAta)),mint,owner,uiTokenAmount:{amount:raw.toString(),decimals:6,uiAmount:null,uiAmountString:'13523.538793'}};
 const tx={slot:100,blockTime:Math.floor(Date.now()/1000)-60,transaction:{signatures:[signature],message:{accountKeys,instructions:msg.compiledInstructions.map(ix=>({programId:msg.staticAccountKeys[ix.programIdIndex],accounts:[...ix.accountKeyIndexes].map(i=>msg.staticAccountKeys[i]),data:bs58.encode(ix.data)}))}},meta:{err:null,preBalances,postBalances,preTokenBalances:[],postTokenBalances:[row],fee:20000}};
 let holdings=[{pubkey:f.baseAta,account:f.token(new PublicKey(f.mint),f.user,raw)}],newer=[];const transactions=new Map([[signature,tx]]);
 const execution={rpc:{getParsedTransaction:async sig=>transactions.get(sig)??null,getSignaturesForAddress:async address=>{assert.equal(address.toBase58(),f.baseAta.toBase58());return newer;},getAccountInfo:async k=>f.map.get(k.toBase58())},network:async()=>{},holdings:async()=>holdings};
 return {...f,owner,mint,raw,tx,row,execution,transactions,input:{mint,signature},setHoldings:v=>holdings=v,setNewer:v=>newer=v};
}
test('purchase proof binds the owner, exact input, official pool, balances and original block time without signing',async()=>{
 const f=await fixture(),proof=await verifyPurchase(f.execution,f.owner,f.input);
 assert.equal(proof.rawQuantity,'13523538793');assert.equal(proof.costSol,.0213462);assert.equal(proof.networkFeeSol,.00002);assert.equal(proof.swapInputSol,.02);assert.equal(proof.openedAt,f.tx.blockTime*1000);assert.equal(proof.pairAddress,f.poolKey.toBase58());
 assert.equal(purchaseSignature('https://solscan.io/tx/'+signature),signature);assert.throws(()=>purchaseSignature('https://evil.example/tx/'+signature));assert.throws(()=>purchaseSignature('3c16…UpXN'));
});
test('new 0.2 SOL and historical 0.03 SOL purchases both recover with their own confirmed costs',async()=>{
 for(const amount of ['30000000','200000000']){
  const f=await fixture(amount),proof=await verifyPurchase(f.execution,f.owner,f.input);
  assert.equal(proof.swapInputSol,Number(amount)/1e9);assert.ok(Math.abs(proof.costSol-(Number(amount)+1346200)/1e9)<1e-12);assert.equal(proof.rawQuantity,f.raw.toString());
 }
});
test('purchase recovery rejects another owner, failed/missing receipts, wrong pool and changed account quantity',async()=>{
 let f=await fixture();await assert.rejects(verifyPurchase(f.execution,Keypair.generate().publicKey.toBase58(),f.input),/người trả phí/);
 f=await fixture();f.tx.meta.err={InstructionError:[0,'Custom']};await assert.rejects(verifyPurchase(f.execution,f.owner,f.input),/receipt/);
 f=await fixture();f.transactions.clear();await assert.rejects(verifyPurchase(f.execution,f.owner,f.input),/receipt/);
 f=await fixture();f.execution.rpc.getAccountInfo=async()=>({owner:PublicKey.default});await assert.rejects(verifyPurchase(f.execution,f.owner,f.input),/pool/);
 f=await fixture();f.setHoldings([{pubkey:f.baseAta,account:f.token(new PublicKey(f.mint),f.user,f.raw-1n)}]);await assert.rejects(verifyPurchase(f.execution,f.owner,f.input),/số dư token/);
});
test('recovery rejects preexisting tokens, swapped output account, wrong mint and subsequent sell/rebuy even at the same current balance',async()=>{
 let f=await fixture();f.tx.meta.preTokenBalances=[{...f.row,uiTokenAmount:{...f.row.uiTokenAmount,amount:'1'}}];await assert.rejects(verifyPurchase(f.execution,f.owner,f.input),/đã có token/);
 f=await fixture();f.row.accountIndex=0;await assert.rejects(verifyPurchase(f.execution,f.owner,f.input),/nhận không khớp/);
 f=await fixture();await assert.rejects(verifyPurchase(f.execution,f.owner,{...f.input,mint:Keypair.generate().publicKey.toBase58()}),/không khớp/);
 f=await fixture();const later=structuredClone(f.tx);later.meta.preTokenBalances=[{...f.row,uiTokenAmount:{...f.row.uiTokenAmount,amount:'1'}}];f.transactions.set('later',later);f.setNewer([{signature:'later',err:null}]);await assert.rejects(verifyPurchase(f.execution,f.owner,f.input),/giao dịch khác/);
 f=await fixture();f.setNewer(Array.from({length:51},()=>({signature:'later',err:null})));await assert.rejects(verifyPurchase(f.execution,f.owner,f.input),/quá nhiều/);
});
test('adopting a purchase never debits current SOL again, deduplicates and preserves unrelated ledger history and Telegram outbox',async()=>{
 const f=await fixture(),proof=await verifyPurchase(f.execution,f.owner,f.input),old=createOwnerLedger(f.owner,.27712);old.telegramOutbox=[{id:'keep'}];old.cooldowns.other=123;old.curve=[{at:1,equitySol:.27712}];
 const s=adoptPurchase(old,f.owner,proof,.27712);assert.equal(s.cashSol,.27712);assert.equal(old.positions.length,0);assert.equal(s.settings.initialSol,.27712);assert.equal(s.positions[0].costSol,.0213462);assert.equal(s.trades[0].sol,.0213462);assert.equal(s.positions[0].entryPriceUsd,null);assert.equal(s.positions[0].priceBasis,'sol');assert.equal(s.telegramOutbox[0].id,'keep');assert.equal(s.cooldowns.other,123);assert.deepEqual(s.curve,old.curve);assert.equal(s.recordedSignatures.length,1);
 const twice=adoptPurchase(s,f.owner,proof,.27712);assert.equal(twice.positions.length,1);assert.equal(twice.trades.length,1);assert.equal(twice.cashSol,.27712);assert.equal(s.running,false);assert.equal(s.recoveryRequired,true);assert.equal(s.buyPaused,true);
 s.buyPaused=false;s.running=true;const feed={solUsd:100,markets:[],updatedAt:Date.now()};assert.equal(nextOwnerOrder(s,feed,.4),null);assert.throws(()=>adoptPurchase(s,f.owner,proof,.3),/Dừng bot/);
});
test('native recovered exits use actual net SOL for stop and take profit, independent of changing SOL/USD',async()=>{
 const f=await fixture(),proof=await verifyPurchase(f.execution,f.owner,f.input),s=adoptPurchase(null,f.owner,proof,.27712),original=s.positions[0];
 const market=(p,netSol)=>({mint:p.mint,priceUsd:1000,updatedAt:Date.now(),exitQuote:{mint:p.mint,rawAmount:p.rawQuantity,checkedAt:Date.now(),netSol}});
 for(const solUsd of [1,50,200]){
  const p=structuredClone(original);assert.equal(exitPlan(p,market(p,p.costSol*.79),solUsd,{...DEFAULTS,requireExecutableQuote:true}).reason,'stop-loss');
  const p2=structuredClone(original);assert.equal(exitPlan(p2,market(p2,p2.initialCostSol*1.81),solUsd,{...DEFAULTS,requireExecutableQuote:true}).reason,'recover-capital');
 }
 const p=structuredClone(original),m=market(p,p.costSol);m.exitQuote.checkedAt=Date.now()-31000;m.priceUsd=999999;assert.equal(exitPlan(p,m,100,{...DEFAULTS,requireExecutableQuote:true}),null);
 const time=Date.now();p.openedAt=time-50*60000;assert.equal(exitPlan(p,market(p,p.costSol),100,DEFAULTS,time),null,'historical peak is unknown; do not invent an immediate 45-minute time stop');
 p.openedAt=time-7*3600000;assert.equal(exitPlan(p,market(p,p.costSol),100,DEFAULTS,time).reason,'max-hold');
});
test('native recovered partial fills advance runner milestones and retain actual SOL accounting',async()=>{
 const f=await fixture(),proof=await verifyPurchase(f.execution,f.owner,f.input),s=adoptPurchase(null,f.owner,proof,.27712),p=s.positions[0],q=p.quantity*.78;
 recordSell(s,{mint:p.mint,priceUsd:100},100,{quantity:q,proceedsSol:.03,priceUsd:100,closed:false},Date.now(),'recover-capital','live');
 assert.equal(p.phase,'runner');assert.ok(p.nextTakeProfitPriceSol>=p.entryPriceSol*2);assert.equal(p.nextTakeProfitPriceUsd,null);assert.ok(Math.abs(s.cashSol-.30712)<1e-12);assert.ok(p.costSol>0);assert.ok(Number.isFinite(p.costUsd));
 const m={mint:p.mint,exitQuote:{mint:p.mint,rawAmount:p.rawQuantity,checkedAt:Date.now(),netSol:.01}};assert.ok(Math.abs(equity(s,[m],100)-(.30712+.01))<1e-12);
});
test('inventory aggregates raw token accounts and rejects foreign-owner account data',async()=>{
 const f=await fixture();assert.equal(inventoryBalances(await f.execution.holdings(),f.owner).get(f.mint),f.raw);
 const foreign=[{account:f.token(new PublicKey(f.mint),Keypair.generate().publicKey,1n)}];assert.throws(()=>inventoryBalances(foreign,f.owner),/không thuộc/);
});

test('owner recovery re-verifies at commit, persists paused native positions and never signs, broadcasts or queues a new-trade report',async()=>{
 const {mkdtemp,readFile,rm}=await import('node:fs/promises'),{OwnerAgent}=await import('../src/owner-agent.js');
 const f=await fixture(),dir=await mkdtemp('/tmp/meme-recovery-agent-');
 try{
  f.execution.balance=async()=>.27712;f.execution.send=async()=>{throw Error('Recovery must not send funds');};
  const direct={configure:()=>({})},agent=new OwnerAgent(dir,direct,f.execution,f.owner,{storageMode:'persistent-volume'});
  const preview=await agent.previewRecovery(f.input);assert.equal(agent.state,null);assert.equal(preview.quantity,13523.538793);
  f.setHoldings([]);await assert.rejects(agent.recoverPurchase(f.input),/số dư token/);assert.equal(agent.state,null);
  f.setHoldings([{pubkey:f.baseAta,account:f.token(new PublicKey(f.mint),f.user,f.raw)}]);await agent.recoverPurchase(f.input);await agent.recoverPurchase(f.input);
  const disk=JSON.parse(await readFile(agent.file,'utf8'));assert.equal(disk.positions.length,1);assert.equal(disk.trades.length,1);assert.equal(disk.pending,null);assert.equal(disk.running,false);assert.equal(disk.telegramOutbox,undefined);assert.equal(await readFile(agent.file,'utf8'),await readFile(agent.backupFile,'utf8'));
  const restarted=new OwnerAgent(dir,direct,f.execution,f.owner);await restarted.load();assert.equal(restarted.state.positions[0].costSol,.0213462);assert.equal(restarted.state.recoveryRequired,true);assert.equal(restarted.vault.keypair,null);
  const ephemeral=new OwnerAgent(dir,direct,f.execution,f.owner,{storageMode:'ephemeral'});await ephemeral.recoverPurchase(f.input);assert.equal(ephemeral.state.positions.length,1);assert.equal(ephemeral.state.running,false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
