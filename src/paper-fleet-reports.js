import path from 'node:path';
import {mkdir,readFile,readdir} from 'node:fs/promises';
import {writeDurable} from './persistence.js';
import {PaperReports} from './paper-reports.js';
import {nextPaperReportEnd} from './paper-schedule.js';
import {independenceMetrics} from './paper-independence-metrics.js';
export class FleetReports extends PaperReports{
 constructor(dir,research){super(dir,research);this.fleetDir=dir;}
 async records(end,from=end-86400000){
  const rows=[];for(let t=Math.floor(from/86400000)*86400000;t<end;t+=86400000){const dir=path.join(this.fleetDir,'fills',new Date(t).toISOString().slice(0,10));let names;try{names=await readdir(dir);}catch(e){if(e.code==='ENOENT')continue;throw e;}
   for(const name of names.filter(n=>/^[a-z]+\.jsonl$/.test(n))){const lines=(await readFile(path.join(dir,name),'utf8')).trim().split('\n');for(const line of lines){if(!line)continue;const f=JSON.parse(line);if(f.at>=from&&f.at<end)rows.push(f);}}
  }
  return [...new Map(rows.map(f=>[f.id,f])).values()].sort((a,b)=>a.at-b.at);
 }
 async tick(fleet,now=Date.now()){
  if(this.busy||fleet.migrationError)return;this.busy=true;
  try{await fleet.reportSerial(async()=>{
   const meta=fleet.meta,from=meta.reportLastEnd,end=nextPaperReportEnd(from);if(end>now)return;
   const fills=await this.records(end,from),agents=fleet.snapshot(now).agents,table=agents.map(a=>{const own=fills.filter(f=>f.agentId===a.id),closed=own.filter(f=>f.side==='SELL'&&f.closed&&Number.isFinite(f.positionPnlSol)),pnl=closed.reduce((n,f)=>n+f.positionPnlSol,0);return {bot:a.id,decisionEngine:a.decisionEngine,modelName:a.ai?.modelName??null,modelActivatedAt:a.ai?.activatedAt??null,aiFills:own.filter(f=>f.decisionEngine?.startsWith('model')).length,closed:closed.length,open:a.openPositions,winRate:closed.length?closed.filter(f=>f.positionPnlSol>0).length/closed.length:null,netPnlSol:own.filter(f=>f.side==='SELL').reduce((n,f)=>n+(f.pnlSol??0),0),expectancySol:closed.length?pnl/closed.length:null,gapLoss:own.filter(f=>f.gapLoss).length,maxDrawdownPct:a.maxDrawdownPct,drawdownScope:'since wallet migration; hourly curve attached for period analysis',uptimeMs:a.uptimeMs,restarts:a.restarts,scoreDistribution:a.scoreDistribution,quoteFills:own.filter(f=>f.quoteSource==='quote').length,modelFills:own.filter(f=>f.quoteSource==='model').length};});
   const pairs=independenceMetrics(fills,agents.map(a=>a.id),from,end),provider=fleet.marketData.status();
   const doc={mode:'paper',reportEnd:end,part:1,parts:1,from,to:end,timezone:'Asia/Ho_Chi_Minh',version:fleet.agentVersion,model:fleet.modelClient?.status()??null,initialVirtualSol:20,initialSolPerBot:2,sharedCapital:false,table,pairs,provider,fills,curveByBot:Object.fromEntries([...fleet.states].map(([id,s])=>[id,s.curve.filter(p=>p.at>=from&&p.at<end)])),assumptions:'Estimated fills, not real execution or profit evidence. Null metrics mean insufficient data. Jaccard≤0.25 and HTTP429<1% are measured targets, not enforced trade allocation.'};
   await mkdir(path.join(this.dir,'reports'),{recursive:true,mode:0o700});await writeDurable(this.file({end,part:1}),doc);
   const lines=table.map(r=>`${r.bot.toUpperCase()} ${r.decisionEngine==='model'?'AI':'RULES'}: PnL ${r.netPnlSol.toFixed(6)} | ${r.closed} đóng | WR ${r.winRate===null?'—':(r.winRate*100).toFixed(1)+'%'} | E ${r.expectancySol===null?'—':r.expectancySol.toFixed(5)} | gap ${r.gapLoss} | DD ${r.maxDrawdownPct?.toFixed(1)??'—'}% | uptime ${(r.uptimeMs/3600000).toFixed(1)}h / restart ${r.restarts}`);
   const id=`isolated-daily:${meta.session}:${end}`;if(!meta.telegramOutbox.some(m=>m.id===id))meta.telegramOutbox.push({id,createdAt:now,attempts:0,nextAttemptAt:0,status:'queued',text:['Meme Pilot · 10 VÍ PAPER RIÊNG · 23:59 VN',...lines,`45 cặp: ${pairs.filter(p=>p.warning).length} cảnh báo Jaccard>0,5 / corr>0,7. Chi tiết trong JSON.`,`Jupiter HTTP429: ${provider.jupiter?.http429??'—'}/${provider.jupiter?.requests??'—'} request trong tiến trình hiện tại. Dưới 100 vị thế/bot chưa kết luận hiệu quả.`].join('\n')});
   const attachment=id+':json';if(!meta.telegramOutbox.some(m=>m.id===attachment))meta.telegramOutbox.push({id:attachment,createdAt:now,attempts:0,nextAttemptAt:0,status:'queued',report:{end,part:1},text:'Paper độc lập: PnL từng bot, 45 cặp trùng token/tương quan, fills quote/model và dữ liệu nguồn.'});
   meta.reportLastEnd=end;await fleet.save();
  });this.error=null;}catch(error){this.error=error.message;fleet.error(error);}finally{this.busy=false;}
 }
}
