import {createHash} from 'node:crypto';
import path from 'node:path';
import {mkdir,readFile,appendFile,open} from 'node:fs/promises';
import {writeDurable} from './persistence.js';
import {INDEPENDENT_VERSION} from './paper-bot-config.js';
export const lamports=x=>{const n=Math.round(x*1e9);if(!Number.isSafeInteger(n))throw Error('Invalid lamports');return n;};
export const sol=x=>Math.round(x*1e9)/1e9;
export function initialBotState(config,now=Date.now()){
 const seed=parseInt(createHash('sha256').update(config.id).digest('hex').slice(0,8),16)||1;
 return {schema:1,version:INDEPENDENT_VERSION,id:config.id,initialSol:2,cashSol:2,rentLockedSol:0,positions:[],pending:null,cooldowns:{},anchors:{},nextAt:now+seed%config.scanIntervalMs,seed,sequence:0,cycle:0,evaluations:0,scoreHistogram:Array(101).fill(0),trades:[],decisions:[],outbox:[],curve:[],peakEquity:2,maxDrawdownPct:0,startedAt:now,heartbeatAt:now,restarts:0,failures:0,breakerUntil:0,running:true,realizedPnlSol:0,signal:null};
}
export function validateBotState(s,id){
 if(s?.schema!==1||s.id!==id||s.initialSol!==2||!Number.isFinite(s.cashSol)||s.cashSol<0||!Number.isFinite(s.rentLockedSol)||s.rentLockedSol<0||!Array.isArray(s.positions)||!Array.isArray(s.trades)||!Array.isArray(s.outbox))throw Error('Invalid bot state: '+id);
 for(const p of s.positions)if(p.agentId!==id||!(p.quantity>0)||!(p.costSol>=0)||!/^\d+$/.test(p.rawQuantity??''))throw Error('Invalid isolated position: '+id);
 return s;
}
const checksum=payload=>createHash('sha256').update(JSON.stringify(payload)).digest('hex');
export class BotStateStore{
 constructor(dir,id){this.dir=dir;this.id=id;this.file=path.join(dir,'state',id+'.json');}
 async load(){const doc=JSON.parse(await readFile(this.file,'utf8'));if(doc.checksum!==checksum(doc.payload))throw Error('Bot checksum mismatch: '+this.id);return validateBotState(doc.payload,this.id);}
 async save(s){validateBotState(s,this.id);await mkdir(path.dirname(this.file),{recursive:true,mode:0o700});await writeDurable(this.file,{checksum:checksum(s),payload:s});}
 async flush(s){
  // Save the outbox before append. Crash recovery may append again; consumers dedupe IDs.
  if(!s.outbox.length)return;
  for(const type of ['decision','fill','error']){
   const rows=s.outbox.filter(r=>r.type===type),byDay=new Map();for(const r of rows){const day=new Date(r.ts??r.at).toISOString().slice(0,10);if(!byDay.has(day))byDay.set(day,[]);byDay.get(day).push(r);}
   for(const [day,records]of byDay){const dir=path.join(this.dir,type+'s',day);await mkdir(dir,{recursive:true,mode:0o700});const file=path.join(dir,this.id+'.jsonl');await appendFile(file,records.map(r=>JSON.stringify(r)).join('\n')+'\n',{mode:0o600});const f=await open(file,'r');try{await f.sync();}finally{await f.close();}}
  }
  s.outbox=[];await this.save(s);
 }
}
