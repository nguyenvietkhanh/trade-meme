import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {Keypair} from '@solana/web3.js';
import {TelegramReporter,enqueueTradeReport} from '../src/telegram.js';
import {createOwnerLedger} from '../src/owner-ledger.js';
const token='123456789:fixture_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789',chatId='123456789';
async function setup(fn){const dir=await mkdtemp('/tmp/meme-telegram-'),kp=Keypair.generate();try{await fn(dir,kp);}finally{await rm(dir,{recursive:true,force:true});}}
const response=()=>new Response(JSON.stringify({ok:true,result:{message_id:42}}));
const state=()=>{const s=createOwnerLedger('owner',.3);s.realizedNetSol=.005;s.cashSol=.305;s.trades=[{signature:'confirmed-fixture',side:'SELL',symbol:'TEST',at:Date.now(),sol:.035,pnlSol:.005,positionPnlSol:.005,closed:true,networkFeeSol:.00002}];return s;};
const pending={intent:{side:'SELL',mint:'fixture-mint',reason:'stop-loss'}},receipt={status:'confirmed',signature:'confirmed-fixture'};

test('Telegram token/chat are encrypted on disk, never returned in status, and decrypt only with the owner key',async()=>setup(async(dir,kp)=>{
 const r=new TelegramReporter(dir,kp.publicKey.toBase58());await r.configure(token,chatId,kp);
 const contents=await readFile(r.file,'utf8');assert.ok(!contents.includes(token));assert.ok(!contents.includes(chatId));assert.equal((await stat(r.file)).mode&0o777,0o600);assert.ok(!JSON.stringify(r.status()).includes(token));
 const restart=new TelegramReporter(dir,kp.publicKey.toBase58());await restart.load();assert.equal(restart.status().unlocked,false);await restart.unlock(Keypair.generate());assert.equal(restart.status().unlocked,false);await restart.unlock(kp);assert.equal(restart.status().unlocked,true);
 await assert.rejects(r.configure(undefined,chatId,kp),/không hợp lệ/);await assert.rejects(r.configure(token,chatId,Keypair.generate()),/ví chủ/);
}));

test('only confirmed app BUY/SELL receipts enqueue reports; sale PnL and totals use actual ledger accounting',()=>{
 const s=state();assert.equal(enqueueTradeReport(s,pending,{...receipt,status:'pending'}),false);assert.equal(enqueueTradeReport(s,{intent:{side:'PROFIT'}},receipt),false);
 assert.equal(enqueueTradeReport(s,pending,receipt),true);assert.equal(enqueueTradeReport(s,pending,receipt),false);
 const text=s.telegramOutbox[0].text;assert.ok(text.includes('PnL lần bán sau phí: +0.005000 SOL'));assert.ok(text.includes('Tổng PnL đã chốt sau phí: +0.005000 SOL'));assert.ok(text.includes('0.000020 SOL'));assert.ok(text.includes('confirmed-fixture'));assert.ok(text.includes('theo vốn khả dụng'));assert.ok(!text.includes('/null'));
});

test('notification attempt is saved before sending; successful events do not send again on restart',async()=>setup(async(dir,kp)=>{
 const r=new TelegramReporter(dir,kp.publicKey.toBase58()),s=state();enqueueTradeReport(s,pending,receipt);let calls=0,saved;
 const agent={state:s,vault:{keypair:kp},serial:fn=>fn(),save:async()=>{saved=structuredClone(s);}};
 r.fetcher=async(url,options)=>{calls++;assert.equal(saved.telegramOutbox[0].attempts,1);assert.ok(String(url).startsWith('https://api.telegram.org/bot'));const body=JSON.parse(options.body);assert.equal(body.chat_id,chatId);assert.equal(body.parse_mode,undefined);return response();};
 await r.configure(token,chatId,kp);await r.tick(agent);assert.equal(calls,1);assert.equal(s.telegramOutbox[0].status,'sent');await r.tick(agent);assert.equal(calls,1);
 const restarted=new TelegramReporter(dir,kp.publicKey.toBase58(),r.fetcher);await restarted.load();await restarted.tick(agent);assert.equal(calls,1);
}));

test('Telegram errors are redacted, retried with a limit and never modify positions or transaction state',async()=>setup(async(dir,kp)=>{
 const r=new TelegramReporter(dir,kp.publicKey.toBase58(),async()=>{throw Error('https://api.telegram.org/bot'+token+'/sendMessage');}),s=state();enqueueTradeReport(s,pending,receipt);
 const agent={state:s,vault:{keypair:kp},serial:fn=>fn(),save:async()=>{}},before=structuredClone(s);delete before.telegramOutbox;
 await r.configure(token,chatId,kp);await r.tick(agent);assert.ok(!r.error.includes(token));assert.equal(s.telegramOutbox[0].status,'queued');
 for(let n=1;n<6;n++){s.telegramOutbox[0].nextAttemptAt=0;await r.tick(agent);}assert.equal(s.telegramOutbox[0].attempts,6);assert.equal(s.telegramOutbox[0].status,'failed');
 const after=structuredClone(s);delete after.telegramOutbox;assert.deepEqual(after,before);
}));

test('an in-flight Telegram HTTP request does not hold the trading serial queue',async()=>setup(async(dir,kp)=>{
 let release,started;const wait=new Promise(r=>release=r),ready=new Promise(r=>started=r),r=new TelegramReporter(dir,kp.publicKey.toBase58(),async()=>{started();await wait;return response();});
 const s=state();enqueueTradeReport(s,pending,receipt);let chain=Promise.resolve();const agent={state:s,vault:{keypair:kp},serial:fn=>{const task=chain.then(fn);chain=task.catch(()=>{});return task;},save:async()=>{}};
 await r.configure(token,chatId,kp);const sending=r.tick(agent);await ready;let tradingContinued=false;await agent.serial(async()=>{tradingContinued=true;});assert.equal(tradingContinued,true);release();await sending;
}));
