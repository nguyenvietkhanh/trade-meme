import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,truncate,stat} from 'node:fs/promises';
import {liveResources,cleanDisabledResearch} from '../src/live-resources.js';
import {ResearchJournal} from '../src/research-journal.js';
import {FleetReports} from '../src/paper-fleet-reports.js';
import {SolanaExecution} from '../src/solana.js';
import {createPaperMarket} from '../src/paper-market.js';
import {PublicKey} from '@solana/web3.js';

test('LIVE defaults to lean even with old collector env enabled; paper retains research',()=>{
 assert.deepEqual(liveResources(true,{DATASET_ENABLED:'true',DORMANT_ENABLED:'true',CANDIDATE_OBSERVER_ENABLED:'true'}),{mode:'lean',research:false,observer:false,dataset:false});
 assert.equal(liveResources(false,{}).research,true);
 assert.equal(liveResources(true,{LIVE_RESEARCH_ENABLED:'true'}).research,true);
});
test('disabled journal never serializes or retains snapshots and makes no directories',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'lean-journal-'));try{const journal=new ResearchJournal(dir,{enabled:false});const cyclic={};cyclic.self=cyclic;
 for(let i=0;i<10000;i++){assert.equal(journal.enqueue(cyclic),false);assert.equal(journal.scan(null),false);}await journal.flush();await journal.maintain();
 assert.equal(journal.bytes,0);assert.equal(journal.rows.length,0);assert.deepEqual(await journal.files(),[]);await assert.rejects(stat(path.join(dir,'research')),{code:'ENOENT'});
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('cleanup deletes only disposable observation files, preserves ledger and rejects symlink traversal',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'lean-clean-')),outside=await mkdtemp(path.join(tmpdir(),'lean-out-'));
 try{const journal=path.join(root,'research','journal','2026-10-29'),dataset=path.join(root,'dataset','2026-10-29'),candidates=path.join(root,'candidate-observer');for(const dir of [journal,dataset,candidates])await mkdir(dir,{recursive:true});
 const disposable=[path.join(journal,'01-0123456789abcdef.jsonl.gz'),path.join(dataset,'candidate_snapshots-0123456789abcdef-000001.jsonl.gz'),path.join(candidates,'candidates.sqlite'),path.join(root,'dormant-state.json')];
 const financial=[path.join(root,'live-state.json'),path.join(root,'wallets.txt'),path.join(journal,'ledger.json'),path.join(dataset,'fills.jsonl'),path.join(candidates,'owner-agent-state.json')];
 for(const file of [...disposable,...financial])await writeFile(file,'keep-or-delete');
 await mkdir(path.join(outside,'2026-10-28'));const externalFile=path.join(outside,'2026-10-28','02-0123456789abcdef.jsonl.gz');await writeFile(externalFile,'external');await symlink(path.join(outside,'2026-10-28'),path.join(root,'research','journal','2026-10-28'));
 const result=await cleanDisabledResearch([root,root]);assert.equal(result.files,4);assert.equal(result.errors,0);assert.ok(result.bytes>0);
 for(const file of disposable)await assert.rejects(stat(file),{code:'ENOENT'});for(const file of financial)assert.equal(await readFile(file,'utf8'),'keep-or-delete');assert.equal(await readFile(externalFile,'utf8'),'external');
 assert.equal((await cleanDisabledResearch([root])).files,0);
 }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
test('oversized daily report is rejected before allocating its file, financial archive remains',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'lean-report-'));try{const end=Date.parse('2026-10-30T00:00:00Z'),folder=path.join(dir,'fills','2026-10-29');await mkdir(folder,{recursive:true});const file=path.join(folder,'kade.jsonl');await writeFile(file,'');await truncate(file,9*1024*1024);
 await assert.rejects(new FleetReports(dir).records(end),/REPORT_MEMORY_BUDGET_EXCEEDED/);assert.equal((await stat(file)).size,9*1024*1024);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('long-running mint safety caches have a shared cap and expire without weakening checks',async()=>{
 const e=new SolanaExecution('https://api.mainnet-beta.solana.com');let reads=0;e.rpc={getParsedAccountInfo:async()=>{reads++;return {value:{owner:new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),data:{parsed:{type:'mint',info:{mintAuthority:null,freezeAuthority:null,decimals:6,supply:'1000000000'}}}}};}};
 const mint=n=>{const b=Buffer.alloc(32);b.writeUInt32LE(n);return new PublicKey(b).toBase58();};
 for(let i=0;i<700;i++)await e.mintCheck(mint(i));assert.equal(e.mintFacts.size,512);assert.equal(e.mintFactsAt.size,512);
 await e.mintCheck(mint(0));assert.equal(reads,701,'evicted facts require a new RPC verification');e.mintFactsAt.set(mint(0),Date.now()-600001);await e.mintCheck(mint(0));assert.equal(reads,702);
 const market=createPaperMarket(()=>({cashSol:0}),{rpc:{getTokenSupply:async()=>{reads++;return {value:{decimals:6}};}}});
 for(let i=0;i<300;i++)await market.readDecimals(mint(i));const before=reads;await market.readDecimals(mint(0));assert.equal(reads,before+1,'old decimal cache entries are released too');
});
