import path from 'node:path';
import {createReadStream} from 'node:fs';
import {open,readdir,lstat,rename,unlink} from 'node:fs/promises';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {SCALP_LOG_NAME} from './scalp-log.js';

const compactB=b=>b?{top10Pct:b.top10Pct,devPct:b.devPct,holderCount:b.holderCount,tokenProgram:b.tokenProgram,mintRevoked:b.mintRevoked,freezeRevoked:b.freezeRevoked,extensionsSafe:b.extensionsSafe,rugDanger:b.rugDanger,rugRequired:b.rugRequired,rugSource:b.rugSource,creatorAddress:b.creatorAddress,creatorSource:b.creatorSource,coverage:b.coverage,missing:b.missing,rejected:b.rejected,reason_code:b.reason_code}:null;
const compactC=c=>c?{rise:c.rise,steps:c.steps,drawdown:c.drawdown,sampleTimestamps:c.sampleTimestamps,evaluatedAt:c.evaluatedAt,lastSampleAgeMs:c.lastSampleAgeMs,callLatencyMs:c.callLatencyMs,callTiming:c.callTiming,samples:c.samples?.map(({at,price,liquiditySol,callLatencyMs})=>({at,price,liquiditySol,callLatencyMs})),sampleSources:[...new Set((c.samples??[]).map(r=>r.source).filter(Boolean))],observedWindowSamples:c.observedWindow?.length}:null;
const compact=r=>({simulation:true,type:'candidate_summary',entryTier:r.entryTier??'legacy',runId:r.runId,mint:r.mint,pool:r.pool,source:r.source,stage_reached:r.stage_reached,reason_code:r.reason_code,quality_rejection:r.quality_rejection,
 latestMetrics:{A:r.metrics?.A,B:compactB(r.metrics?.B),C:compactC(r.metrics?.C),E:r.metrics?.E},context:r.context});
const execution=r=>({...r,metrics:{...r.metrics,B:compactB(r.metrics?.B),C:compactC(r.metrics?.C)},detailFormat:'compact-execution-v2; full holder wallets/raw sample window retained in local gzip'});
const orderRow=r=>/^(virtual_fill|execution|quote_|order_)/.test(r?.type??'')?{...r,entryTier:r.entryTier??r.order?.entryTier??'legacy'}:r;
// A single plain TXT: fold repetitive candidate scans, retain execution/fill rows.
// Stream gzip members and writes; never inflate an entire hour/day into RAM.
export async function writeReportBundle(dir,name,header,{from,to,runId,maxBytes=24*1048576}={}){
 if(!/^(report-\d{4}-\d{2}-\d{2}|paper-week-report)\.txt$/.test(name)||!Number.isFinite(from)||!Number.isFinite(to)||to<from)throw Error('INVALID_REPORT_RANGE');
 if(Buffer.byteLength(header)>6*1048576)throw Error('REPORT_TOO_LARGE');
 header=header.split('\n').map(line=>{try{const r=JSON.parse(line);return r?.type?JSON.stringify(orderRow(r)):line;}catch{return line;}}).join('\n');
 const target=path.join(dir,name),temp=path.join(dir,'.paper-report-'+randomUUID()+'.tmp'),h=await open(temp,'wx',0o600);
 let used=0,omitted=0,observations=0,exported=0,minute=null,duplicateFillsSuppressed=0;const fillIds=new Set(),omittedByType={};
 for(const line of header.split("\n"))try{const row=JSON.parse(line);if(row.type==='virtual_fill'&&row.id)fillIds.add(row.id);}catch{}const groups=new Map(),reasons={},errors=[];
 const write=async text=>{await h.writeFile(text);used+=Buffer.byteLength(text);};
 const emit=async(row,candidate=false)=>{const line=JSON.stringify(orderRow(row))+'\n';if(used+Buffer.byteLength(line)>maxBytes-(candidate?2*1048576:65536)){omitted+=row.observationCount??1;omittedByType[row.type??'unknown']=(omittedByType[row.type??'unknown']??0)+(row.observationCount??1);return;}await write(line);exported++;};
 const flush=async()=>{for(const group of groups.values())await emit(group,true);groups.clear();};
 try{
  await write(header+'\nSCALP AUDIT (JSONL; candidate observations grouped per mint/reason/5min; not fills)\n');
  for(const file of (await readdir(dir)).filter(n=>SCALP_LOG_NAME.test(n)).sort()){
   const hour=Date.parse(file.slice(6,16)+'T'+file.slice(17,19)+':00:00Z');if(hour+3600000<=from||hour>=to)continue;
   const full=path.join(dir,file),stat=await lstat(full);if(!stat.isFile()||stat.isSymbolicLink()){errors.push({file,code:'UNSAFE_LOG'});continue;}if(!stat.size)continue;
   const input=createReadStream(full,{start:0,end:stat.size-1}),gunzip=createGunzip();input.on('error',e=>gunzip.destroy(e));input.pipe(gunzip);const lines=createInterface({input:gunzip,crlfDelay:Infinity});
   try{for await(const line of lines){
    if(line.length>1048576){omitted++;continue;}let r;try{r=JSON.parse(line);}catch{omitted++;continue;}
    if(!Number.isFinite(r.ts)||r.ts<from||r.ts>=to||(r.runId&&runId&&r.runId!==runId))continue;
    observations++;if(r.reason_code)reasons[r.reason_code]=(reasons[r.reason_code]??0)+1;
    if(!r.type||r.type==='candidate_progress'){
     const bucket=Math.floor(r.ts/300000);if(bucket!==minute||groups.size>=1000){await flush();minute=bucket;}
     const key=[r.runId,r.mint,r.pool,r.reason_code].join(':');const prior=groups.get(key);
     groups.set(key,{...compact(r),firstAt:prior?.firstAt??r.ts,lastAt:r.ts,observationCount:(prior?.observationCount??0)+1,firstSignalId:prior?.firstSignalId??r.signal_id,lastSignalId:r.signal_id});
    }else if(r.type==='virtual_fill'&&r.id&&fillIds.has(r.id))duplicateFillsSuppressed++;
    else{await emit(r.type==='execution'?execution(r):r);if(r.type==='virtual_fill'&&r.id)fillIds.add(r.id);}
   }}catch{errors.push({file,code:'LOG_READ_INCOMPLETE'});}finally{lines.close();input.destroy();gunzip.destroy();}
  }
  await flush();await write('\nEXPORT COVERAGE\n'+JSON.stringify({simulation:true,from,to,runId,auditObservations:observations,exportedAuditRows:exported,omittedObservations:omitted,omittedByType,duplicateFillsSuppressed,uniqueFillIds:fillIds.size,executionFormat:'compact-execution-v2; numeric A/B/C/D/E retained, repeated wallet lists/raw windows stay in gzip',sourceErrors:errors,reasons,grouping:'candidate scans grouped per mint/pool/reason/5min; first/last times and latest metrics; no inference of fills',fullAudit:'original hourly gzip logs retained locally; retention/quota apply'},null,2)+'\n');
  await h.sync();await h.close();await rename(temp,target);return name;
 }catch(e){await h.close().catch(()=>{});await unlink(temp).catch(()=>{});throw e;}
}
