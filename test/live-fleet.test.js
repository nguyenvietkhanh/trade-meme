import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
import {LiveFleet} from '../src/live-fleet.js';
import {FleetReports} from '../src/paper-fleet-reports.js';
import {paperReportEnd,nextPaperReportEnd} from '../src/paper-schedule.js';
import {tenMarket} from './fixtures/ten-market.js';
import {createPaperAssets} from '../src/paper-assets.js';
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await delay(30);}throw Error('live workers timeout');}
test('three live AI workers have independent contexts, dynamic shared actual balance, and restart locked without any paper funds',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'live-fleet-'));let fleet; t.after(async()=>{await fleet?.stop();await rm(dir,{recursive:true,force:true});});
 const kp=Keypair.generate(),owner=kp.publicKey.toBase58(),contexts=new Map(),password='fixture-only-live-password';let balance=7.5,sends=0;
 const execution={network:async()=>{},balance:async()=>balance,send:async()=>{sends++;throw Error('No transaction allowed in HOLD test');}};
 const data={snapshot:()=>{const now=Date.now();return {snapshotId:'live-fixture',timestamp:now,solUsd:100,markets:[tenMarket('kade',now)]};},status:()=>({jupiter:{requests:0,http429:0}})};
 const client={settings:()=>({enabled:true,configured:true,name:'fixture-model',pollMs:15000,timeoutMs:1000}),status:()=>({enabled:true,configured:true}),cancel:()=>{},decide:async(id,ctx)=>{contexts.set(id,ctx);return {decision:{action:'HOLD',mint:null,order_sol:null,sell_percent:null,confidence:.5,reason:'Chờ cơ hội'},expiresAt:Date.now()+30000};}};
 const options={modelClient:client,execution,owner,legacyDir:dir,storageMode:'local-disk'};fleet=new LiveFleet(path.join(dir,'live'),data,options);await fleet.load();await fleet.treasury.sync();assert.equal(fleet.state.cashSol,7.5);assert.equal(fleet.state.initialRealSol,7.5);assert.equal(fleet.state.experiment.initialVirtualSol,null);assert.equal(fleet.state.running,false);assert.deepEqual([...fleet.states.keys()],['kade','nyx','sage']);
 await fleet.treasury.vault.importKey(bs58.encode(kp.secretKey),password);fleet.treasury.lock();for(const s of fleet.states.values()){s.nextAt=0;s.ai.nextAt=0;}fleet.start();await fleet.unlock(password);fleet.publish();await until(()=>contexts.size===3);
 for(const [id,ctx]of contexts){assert.equal(ctx.botId,id);assert.equal(ctx.mode,'live');assert.equal(ctx.wallet.initialSol,null);assert.equal(ctx.wallet.cashSol,7.5);assert.equal(ctx.limits.maxOrderSol,7.395);assert.equal(ctx.otherBots,undefined);assert.equal(ctx.privateKey,undefined);}
 assert.equal(fleet.supervisor.workers.size,3);assert.equal(fleet.snapshot().agents.length,3);assert.equal(fleet.snapshot().agents[0].maxDrawdownPct,null);assert.equal(fleet.state.cashSol,7.5,'shared balance must not be summed three times');assert.equal(sends,0);
 balance+=1;await fleet.pulse();assert.equal(fleet.state.netDepositsSol,1);assert.ok(Math.abs(fleet.valuation().pnlSol)<1e-9);await fleet.stop();fleet=new LiveFleet(path.join(dir,'live'),data,options);await fleet.load();assert.equal(fleet.state.running,false);assert.equal(fleet.state.live.signer.unlocked,false);assert.equal(fleet.state.live.balanceSol,null);assert.equal(fleet.state.trades.length,0);assert.equal(sends,0);
});
test('live assets and daily report truthfully show three shared-wallet bots, actual fees and no fabricated starting funds',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'live-report-'));t.after(()=>rm(dir,{recursive:true,force:true}));const at=Date.now(),from=paperReportEnd(at),end=nextPaperReportEnd(from),data={snapshot:()=>({markets:[],solUsd:100}),status:()=>({jupiter:{requests:0,http429:0}})},fleet=new LiveFleet(dir,data,{execution:{},legacyDir:dir});await fleet.load();fleet.meta.reportLastEnd=from;
 const reports=new FleetReports(dir);await reports.tick(fleet,end);assert.equal(reports.error,null);const doc=JSON.parse(await readFile(reports.file({end,part:1}),'utf8'));assert.equal(doc.mode,'live');assert.equal(doc.initialVirtualSol,null);assert.equal(doc.initialSolPerBot,null);assert.equal(doc.sharedCapital,true);assert.deepEqual(doc.table.map(r=>r.bot),['kade','nyx','sage']);assert.equal(doc.pairs.length,3);assert.ok(fleet.meta.telegramOutbox[0].text.includes('LIVE'));assert.equal((await reports.document({end,part:1})).filename,`meme-pilot-live-${end}-1.json`);
 const assets=await createPaperAssets(new URL('../public/',import.meta.url),{mode:'live'}),html=assets.get('/').content;assert.match(html,/LIVE · SOL THẬT/);assert.match(html,/LIVE_SIGNER_SECRET_KEY/);assert.match(html,/wallet-disconnect/);assert.match(html,/23:59/);assert.match(html,/Kết nối ví/);assert.ok(!html.includes('khớp giả định'));assert.ok(!html.includes('10 VÍ RIÊNG'));assert.ok(!html.includes('khởi tạo 20 SOL'));assert.ok(!html.includes('haircut 1,5%'));
});
