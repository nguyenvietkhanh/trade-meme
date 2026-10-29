import {DatabaseSync} from 'node:sqlite';
import {createWriteStream,existsSync,statSync} from 'node:fs';
import path from 'node:path';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
export const METRICS=['priceUsd','marketCapUsd','liquidityUsd','buys5m','sells5m','uniqueBuyers5m','uniqueSellers5m','volume5mUsd','buyVolume5mUsd','sellVolume5mUsd','change5mPct','change1hPct','holderCount','top10Pct','devPct'];
export const median=a=>{if(!a.length)return null;const s=[...a].sort((a,b)=>a-b),i=Math.floor(s.length/2);return s.length%2?s[i]:(s[i-1]+s[i])/2;};
export function analyze(file){
 const db=new DatabaseSync(file,{readOnly:true}),counts={},groups={BUY:{n:0,wins:0},SKIP:{n:0,wins:0},NOT_EVALUATED:{n:0,wins:0}},values={},rows=db.prepare('SELECT c.mint,c.data,l.data AS label FROM candidates c LEFT JOIN labels l ON l.mint=c.mint');let total=0,labeled=0;
 try{for(const row of rows.iterate()){
  total++;const c=JSON.parse(row.data),l=JSON.parse(row.label??'null'),label=l?.label??'UNLABELED';counts[label]=(counts[label]??0)+1;
  if(!l?.label)continue;labeled++;const g=c.evaluationStatus!=='EVALUATED'?'NOT_EVALUATED':l.bot_would_have_bought?'BUY':'SKIP';groups[g].n++;groups[g].wins+=label==='WIN'?1:0;
  const comparison=label==='WIN'?'WIN':['RUG','LOSS'].includes(label)?'RUG_LOSS':null;if(!comparison)continue;
  for(const r of db.prepare('SELECT minute,data FROM snapshots WHERE mint=? AND minute IN(0,1,5)').all(row.mint)){const s=JSON.parse(r.data??'null');for(const field of METRICS){const key='T+'+r.minute+'m.'+field,bucket=values[key]??={WIN:[],RUG_LOSS:[]},v=s?.values?.[field];if(typeof v==='number'&&Number.isFinite(v)&&!s.dropped)bucket[comparison].push(v);}}
 }}finally{db.close();}
 return {total,labeled,counts,warning:labeled<200?'CHƯA ĐỦ 200 token có nhãn hợp lệ; chưa đủ kết luận.':null,groups:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,{...v,winRate:v.n?v.wins/v.n:null}])),medians:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{WIN:median(v.WIN),RUG_LOSS:median(v.RUG_LOSS),WIN_n:v.WIN.length,RUG_LOSS_n:v.RUG_LOSS.length}])),limitations:['Discrete sampled price extrema, not continuous highs/lows. Missing coverage remains unlabeled.','Comparison is observational, not a causal estimate or executable PnL; includes no hypothetical fill fees.','NOT_EVALUATED tokens are separate from evaluated SKIP; missing values are excluded per metric.']};
}
const csv=v=>'"'+String(v??'').replaceAll('"','""')+'"';
export async function exportCsv(file,destination){
 if(path.resolve(file)===path.resolve(destination)||(existsSync(destination)&&statSync(file).ino===statSync(destination).ino&&statSync(file).dev===statSync(destination).dev))throw Error('CSV_MUST_NOT_OVERWRITE_DATABASE');
 const db=new DatabaseSync(file,{readOnly:true}),out=createWriteStream(destination,{mode:0o600});let failure=null;out.on('error',e=>{failure=e;});
 const keys=['mint','pool','firstSeenUtc','poolAgeMs','source','decision','decisionPool','decisionPoolMatchesTracked','skipCode','evaluationStatus','filterPassed','bot_would_have_bought','label','is_rug','max_gain_pct','return_15m','return_60m','max_drawdown_pct','coverage',... [0,1,5,15,30,60].flatMap(m=>['capturedAt','observedAt','dropped','missing','provenance',...METRICS].map(k=>'t'+m+'_'+k))];
 const write=async line=>{if(failure)throw failure;if(!out.write(line+'\n'))await once(out,'drain');};
 try{await write(keys.map(csv).join(','));for(const row of db.prepare('SELECT c.mint,c.data,l.data AS label FROM candidates c LEFT JOIN labels l ON l.mint=c.mint').iterate()){
   const c=JSON.parse(row.data),l=JSON.parse(row.label??'{}'),flat={...c,...l};for(const r of db.prepare('SELECT minute,data FROM snapshots WHERE mint=?').all(c.mint)){const s=JSON.parse(r.data??'null');for(const k of ['capturedAt','observedAt','dropped','missing','provenance',...METRICS])flat['t'+r.minute+'_'+k]=s?.[k]??s?.values?.[k]??null;}await write(keys.map(k=>csv(typeof flat[k]==='object'&&flat[k]!==null?JSON.stringify(flat[k]):flat[k])).join(','));}
  out.end();await once(out,'finish');
 }finally{db.close();if(!out.writableFinished)out.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const args=process.argv.slice(2),file=args[0];if(!file)throw Error('Usage: node scripts/analyze-candidates.js /path/candidates.sqlite [--csv /path/output.csv]');console.log(JSON.stringify(analyze(file),null,2));const i=args.indexOf('--csv');if(i>=0){if(!args[i+1])throw Error('Missing CSV path');await exportCsv(file,args[i+1]);}}
 catch{console.error('CANDIDATE_ANALYSIS_FAILED: check database / CSV paths and permissions. Usage: node scripts/analyze-candidates.js candidates.sqlite [--csv output.csv]');process.exitCode=1;}
}
