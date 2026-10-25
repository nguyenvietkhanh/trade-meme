import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,mkdir,appendFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {FleetReports} from '../src/paper-fleet-reports.js';
import {PaperFleet} from '../src/paper-fleet.js';
import {MarketData} from '../src/paper-market-data.js';
import {paperReportEnd,nextPaperReportEnd} from '../src/paper-schedule.js';
test('daily 23:59 report deduplicates crash-replayed fills, keeps 45 pairs and queues one summary/attachment',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'isolated-report-'));try{
  const fleet=new PaperFleet(dir,new MarketData({providerStats:()=>({requests:1,http429:0})}));await fleet.load();const from=paperReportEnd(Date.parse('2026-10-25T00:00:00Z')),end=nextPaperReportEnd(from);fleet.meta.reportLastEnd=from;
  const at=from+1000,fill={type:'fill',id:'unique-buy',agentId:'nova',at,side:'BUY',mint:'token',sol:.05,quoteSource:'model'},day=new Date(at).toISOString().slice(0,10),folder=path.join(dir,'fills',day);await mkdir(folder,{recursive:true});await appendFile(path.join(folder,'nova.jsonl'),JSON.stringify(fill)+'\n'+JSON.stringify(fill)+'\n');
  const reports=new FleetReports(dir);await reports.tick(fleet,end);await reports.tick(fleet,end+1);assert.equal(fleet.meta.telegramOutbox.length,2);assert.equal(fleet.meta.reportLastEnd,end);
  const doc=JSON.parse(await readFile(reports.file({end,part:1}),'utf8'));assert.equal(doc.fills.length,1);assert.equal(doc.pairs.length,45);assert.equal(doc.sharedCapital,false);assert.equal(doc.table.length,10);assert.equal(doc.table.find(r=>r.bot==='nova').modelFills,1);assert.equal(doc.table.find(r=>r.bot==='echo').winRate,null);
 }finally{await rm(dir,{recursive:true,force:true});}
});
