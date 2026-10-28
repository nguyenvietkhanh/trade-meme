import {createReadStream} from 'node:fs';
import {mkdir,readdir,readFile,writeFile,lstat} from 'node:fs/promises';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {redactor} from '../src/dataset-redaction.js';
const [liveRoot,outputDir,limitArg='250']=process.argv.slice(2),limit=Number(limitArg);
if(!liveRoot||!outputDir||!Number.isInteger(limit)||limit<1||limit>10000)throw Error('Usage: export_redacted.sh LIVE_ROOT OUTPUT_DIR [rows_per_stream=250]');
const root=path.resolve(liveRoot,'dataset'),dest=path.resolve(outputDir);if(dest===root||dest.startsWith(root+path.sep))throw Error('Export outside dataset storage');
if(!(await lstat(root)).isDirectory()||(await lstat(root)).isSymbolicLink())throw Error('Unsafe dataset path');
const saltStat=await lstat(path.join(root,'.redaction-salt'));if(!saltStat.isFile()||saltStat.isSymbolicLink())throw Error('Unsafe pseudonym seed');
const salt=await readFile(path.join(root,'.redaction-salt'),'utf8'),clean=redactor(salt),streams=['model_calls','candidate_snapshots','forward_labels','fills_enriched','executor_results','errors'],manifest={at:new Date().toISOString(),limit,redacted:true,streams:{},warnings:[]};
await mkdir(dest,{recursive:true,mode:0o700});const files=[];
for(const day of (await readdir(root)).filter(n=>/^\d{4}-\d{2}-\d{2}$/.test(n)).sort().reverse()){
 const dir=path.join(root,day),st=await lstat(dir);if(!st.isDirectory()||st.isSymbolicLink())continue;
 for(const name of (await readdir(dir)).sort().reverse()){if(!/^(model_calls|candidate_snapshots|forward_labels|fills_enriched|executor_results|errors)-[a-f0-9]{16}-\d+\.jsonl\.gz$/.test(name))continue;const file=path.join(dir,name),s=await lstat(file);if(s.isFile()&&!s.isSymbolicLink())files.push({file,stream:streams.find(k=>name.startsWith(k+'-'))});}
}
for(const stream of streams){const rows=[];let bytes=0;
 for(const {file}of files.filter(f=>f.stream===stream)){
  if(rows.length>=limit||bytes>=64*1048576)break;
  const input=createReadStream(file),gunzip=createGunzip(),lines=createInterface({input:input.pipe(gunzip),crlfDelay:Infinity});input.on('error',e=>gunzip.destroy(e));
  try{for await(const line of lines){bytes+=Buffer.byteLength(line);if(!line.trim())continue;const row=JSON.parse(line),mints=new Set();const visit=v=>{if(!v||typeof v!=='object')return;for(const [k,x]of Object.entries(v)){if(['mint','pool','pairAddress'].includes(k)&&typeof x==='string')mints.add(x);if(x&&typeof x==='object')visit(x);}};visit(row);rows.push(clean(row,[...mints]));if(rows.length>=limit||bytes>=64*1048576)break;}}
  catch{manifest.warnings.push({stream,code:'TRUNCATED_OR_INVALID_GZIP_OR_JSON'});}finally{lines.close();input.destroy();gunzip.destroy();}
 }
 await writeFile(path.join(dest,stream+'.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+(rows.length?'\n':''),{mode:0o600});manifest.streams[stream]={rows:rows.length,scannedUncompressedBytes:bytes};
}
manifest.warnings.push({code:'MODEL_CALLS_EXECUTOR_RESULTS_JOIN_BY_CALL_ID_AND_INTENT_ID; late fills may be outside sample. No synthetic missing data.'});
await writeFile(path.join(dest,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({exported:true,rows:Object.fromEntries(Object.entries(manifest.streams).map(([k,v])=>[k,v.rows])),warnings:manifest.warnings.length}));
