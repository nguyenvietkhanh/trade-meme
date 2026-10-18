import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {writeDurable} from './persistence.js';
import {enqueueTrainingRecord} from './training-records.js';

const DAY=86400000,OFFSET=7*3600000,HOUR=23*3600000,MAX_PART_BYTES=8*1024*1024;
export const REPORT_TIMEZONE='Asia/Ho_Chi_Minh';
export function reportEnd(now){return Math.floor((now+OFFSET-HOUR)/DAY)*DAY+HOUR-OFFSET;}
export function validReportRef(ref){return !!ref&&Number.isSafeInteger(ref.end)&&ref.end>0&&reportEnd(ref.end)===ref.end&&Number.isSafeInteger(ref.part)&&ref.part>=1&&ref.part<=10000;}
const date=end=>new Date(end+OFFSET).toISOString().slice(0,10);
export function reportSummary(records,end){
 const closed=records.filter(r=>r.side==='SELL'&&r.closed),known=closed.filter(r=>Number.isFinite(r.positionPnlSol));
 const winners=known.filter(r=>r.positionPnlSol>0),losses=known.filter(r=>r.positionPnlSol<0);
 return {timezone:REPORT_TIMEZONE,from:new Date(end-DAY).toISOString(),to:new Date(end).toISOString(),interval:'[from,to)',confirmedFills:records.length,closedPositions:closed.length,winners:winners.length,losers:losses.length,breakeven:known.length-winners.length-losses.length,unknownPnl:closed.length-known.length,netClosedPnlSol:known.reduce((s,r)=>s+r.positionPnlSol,0),realizedSalePnlSol:records.filter(r=>r.side==='SELL'&&Number.isFinite(r.pnlSol)).reduce((s,r)=>s+r.pnlSol,0),winRate:known.length?winners.length/known.length:null};
}
export class TrainingArchive{
 constructor(dir,owner){this.dir=path.join(dir,'training');this.owner=owner;this.busy=false;this.error=null;this.backfilled=false;this.archived=0;}
 status(state){return {timezone:REPORT_TIMEZONE,sendAt:'23:00',pending:state?.trainingOutbox?.length??0,archivedThisProcess:this.archived,lastQueuedEnd:state?.dailyTrainingReports?.lastEnd??null,error:this.error};}
 recordFile(record){if(record.owner!==this.owner||typeof record.id!=='string'||!Number.isFinite(record.at)||!['BUY','SELL'].includes(record.side))throw Error('Bản ghi training không hợp lệ.');return path.join(this.dir,'fills',new Date(record.at).toISOString().slice(0,10),createHash('sha256').update(record.id).digest('hex')+'.json');}
 async archive(record){const file=this.recordFile(record);await mkdir(path.dirname(file),{recursive:true,mode:0o700});try{const old=JSON.parse(await readFile(file,'utf8'));if(old.owner!==this.owner||old.id!==record.id)throw Error('Kho log không khớp.');return;}catch(e){if(e.code!=='ENOENT')throw e;}await writeDurable(file,record);this.archived++;}
 async records(end){
  const records=[];for(const day of new Set([new Date(end-DAY).toISOString().slice(0,10),new Date(end-1).toISOString().slice(0,10)])){
   const dir=path.join(this.dir,'fills',day);let files;try{files=await readdir(dir);}catch(e){if(e.code==='ENOENT')continue;throw e;}
   for(const name of files.filter(f=>/^[a-f0-9]{64}\.json$/.test(f))){const r=JSON.parse(await readFile(path.join(dir,name),'utf8'));if(r.owner!==this.owner)throw Error('Chủ kho log không khớp.');if(r.at>=end-DAY&&r.at<end)records.push(r);}
  }return records.sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
 }
 reportFile(ref){if(!validReportRef(ref))throw Error('Kỳ báo cáo không hợp lệ.');return path.join(this.dir,'reports',`${ref.end}-${ref.part}.json`);}
 async document(ref){const content=await readFile(this.reportFile(ref));if(content.length>MAX_PART_BYTES+65536)throw Error('Tệp báo cáo quá lớn.');const doc=JSON.parse(content);if(doc.owner!==this.owner||doc.reportEnd!==ref.end||doc.part!==ref.part)throw Error('Báo cáo không khớp chủ ví.');return {filename:`meme-pilot-winners-${date(ref.end)}-${ref.part}.json`,content};}
 async build(end){
  const records=await this.records(end),summary=reportSummary(records,end),winners=records.filter(r=>r.side==='SELL'&&r.closed&&Number.isFinite(r.positionPnlSol)&&r.positionPnlSol>0);
  const groups=[[]];let bytes=0;for(const winner of winners){const n=Buffer.byteLength(JSON.stringify(winner))+1;if(n>MAX_PART_BYTES)throw Error('Bản ghi training quá lớn.');if(bytes+n>MAX_PART_BYTES){groups.push([]);bytes=0;}groups.at(-1).push(winner);bytes+=n;}
  await mkdir(path.join(this.dir,'reports'),{recursive:true,mode:0o700});
  for(let i=0;i<groups.length;i++)await writeDurable(this.reportFile({end,part:i+1}),{schemaVersion:1,owner:this.owner,reportEnd:end,part:i+1,parts:groups.length,summary,winnerDefinition:'Fully closed position with positionPnlSol > 0, using confirmed receipts including allocated trading costs. Excludes wallet deposits and unrealized PnL.',trainingNote:'Winner-only exports are selection-biased; use the full fills archive including losing positions for training. Missing historical entry features remain null.',winners:groups[i]});
  return {summary,parts:groups.length};
 }
 async tick(agent,now=Date.now()){
  if(this.busy)return;this.busy=true;
  try{
   let batch=[],lastEnd;
   await agent.serial(async()=>{const s=agent.state;if(!s)return;
    if(!this.backfilled){for(const t of s.trades)enqueueTrainingRecord(s,t,{},s.positions.find(p=>p.mint===t.mint&&p.openedAt<=t.at));this.backfilled=true;}
    s.dailyTrainingReports??={lastEnd:reportEnd(now)};
    batch=(s.trainingOutbox??[]).slice(0,100);lastEnd=s.dailyTrainingReports.lastEnd;
    if(batch.length||!this.initialized){await agent.save();this.initialized=true;}
   });
   if(lastEnd===undefined)return;
   for(const r of batch)await this.archive(r);
   if(batch.length)await agent.serial(async()=>{const s=agent.state;if(!s)return;const done=new Set(batch.map(r=>r.id));s.trainingOutbox=(s.trainingOutbox??[]).filter(r=>!done.has(r.id));await agent.save();});
   this.error=null;
   if(agent.state?.trainingOutbox?.length||!agent.telegram.enabled||lastEnd>=reportEnd(now))return;
   const end=lastEnd+DAY,{summary,parts}=await this.build(end);
   await agent.serial(async()=>{const s=agent.state;if(!s||s.dailyTrainingReports.lastEnd!==lastEnd||s.trainingOutbox?.length)return;
    s.telegramOutbox??=[];for(let part=1;part<=parts;part++){
     const id=`daily-training:${end}:${part}`;if(s.telegramOutbox.some(m=>m.id===id))continue;
     const pnl=summary.netClosedPnlSol;
     const text=[`Meme Pilot · Tổng kết 23:00 ${date(end)} (giờ Việt Nam)`,`Kỳ: 23h hôm trước → 23h hôm nay · phần ${part}/${parts}`,`Đã đóng: ${summary.closedPositions} · Thắng: ${summary.winners} · Thua: ${summary.losers} · Hòa: ${summary.breakeven}`,`PnL vị thế đóng, sau phí: ${pnl>=0?'+':''}${pnl.toFixed(6)} SOL`,`Win rate: ${summary.winRate===null?'chưa có':(summary.winRate*100).toFixed(1)+'%'}`,`Tệp JSON: lệnh thắng đã đóng + dữ liệu đầu vào lúc mua; dữ liệu cũ thiếu ghi null.`].join('\n');
     s.telegramOutbox.push({id,text,report:{end,part},createdAt:now,attempts:0,nextAttemptAt:0,status:'queued'});
    }s.dailyTrainingReports.lastEnd=end;await agent.save();
   });this.error=null;
  }catch{this.error='Chưa lưu/xuất được log training; sẽ thử lại, không đổi lệnh giao dịch.';}finally{this.busy=false;}
 }
}
