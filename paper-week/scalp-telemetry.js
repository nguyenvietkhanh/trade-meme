import path from 'node:path';
import {readFile,lstat} from 'node:fs/promises';
import {writePaperFile} from './persistence.js';
import {dayFor} from './store.js';
const stages=['A','B','C','D','BUY'];
const blank=()=>Object.fromEntries(stages.map(s=>[s,{reached:[],passed:[]}]));
export class ScalpTelemetry{
 constructor(dir,{clock=Date.now,maxMints=20000}={}){Object.assign(this,{dir,clock,maxMints});this.days=new Map();this.dirty=new Set();}
 async load(day=dayFor(this.clock())){
  if(this.days.has(day))return this.days.get(day);let data={day,trackingFrom:this.clock(),stages:blank(),hours:{},overflow:false};
  try{const file=path.join(this.dir,'funnel-'+day+'.json'),stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1048576)throw Error('FUNNEL_STORAGE_UNSAFE');data=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const hydrate=x=>Object.fromEntries(stages.map(s=>[s,{reached:new Set((x?.[s]?.reached??[]).map(v=>typeof v==='number'?data.mints[v]:v)),passed:new Set((x?.[s]?.passed??[]).map(v=>typeof v==='number'?data.mints[v]:v))}]));
  data.stages=hydrate(data.stages);data.hours=Object.fromEntries(Object.entries(data.hours??{}).map(([k,v])=>[k,hydrate(v)]));this.days.set(day,data);return data;
 }
 startHour(from){this.hourFrom=from;}
 record(stage,mint,pass=false){
  if(!stages.includes(stage)||typeof mint!=='string')return;const day=dayFor(this.clock()),data=this.days.get(day);if(!data)return;
  const hour=String(this.hourFrom??Math.floor(this.clock()/3600000)*3600000);data.hours[hour]??=Object.fromEntries(stages.map(s=>[s,{reached:new Set(),passed:new Set()}]));
  for(const scope of [data.stages,data.hours[hour]])for(const field of pass?['reached','passed']:['reached']){const set=scope[stage][field];if(set.has(mint))continue;if(set.size>=this.maxMints){data.overflow=true;this.dirty.add(day);continue;}set.add(mint);this.dirty.add(day);}
 }
 snapshot(day=dayFor(this.clock()),hour=null){
  const data=this.days.get(day);let scope=data?.stages;if(hour!==null){scope=Object.fromEntries(stages.map(s=>[s,{reached:new Set(),passed:new Set()}]));for(const d of this.days.values())for(const stage of stages)for(const f of ['reached','passed'])for(const mint of d.hours?.[String(hour)]?.[stage]?.[f]??[])scope[stage][f].add(mint);}
  const counts=Object.fromEntries(stages.map(s=>[s,{uniqueMints:scope?.[s]?.reached.size??0,uniquePassed:scope?.[s]?.passed.size??0}]));
  const conversions={};for(const [a,b]of [['A','B'],['B','C'],['C','D'],['D','BUY']]){const left=scope?.[a]?.reached??new Set(),right=scope?.[b]?.reached??new Set(),converted=[...left].filter(m=>right.has(m)).length;conversions[a+'→'+b]={entered:left.size,converted,rate:left.size?converted/left.size:null,nextStageOnly:right.size-converted};}
  return {day,hour,conversions,trackingFrom:data?.trackingFrom??null,exact:!!data&&!data.overflow&&(hour===null||[...this.days.values()].every(d=>!d.overflow)),stages:counts,scope:'unique mint addresses observed in this report day/hour; repeats count once',loaded:!!data};
 }
 async flush(){
  for(const day of [...this.dirty]){const d=this.days.get(day),mints=[],ids=new Map();const id=m=>{if(!ids.has(m)){ids.set(m,mints.length);mints.push(m);}return ids.get(m);};
   const serial=x=>Object.fromEntries(stages.map(s=>[s,{reached:[...x[s].reached].map(id),passed:[...x[s].passed].map(id)}]));
   const stagesData=serial(d.stages),hours=Object.fromEntries(Object.entries(d.hours).map(([k,v])=>[k,serial(v)]));
   await writePaperFile(path.join(this.dir,'funnel-'+day+'.json'),{day,trackingFrom:d.trackingFrom,overflow:d.overflow,mints,stages:stagesData,hours});this.dirty.delete(day);
  }
  for(const day of [...this.days.keys()].sort().slice(0,-3))if(!this.dirty.has(day))this.days.delete(day);
 }
}
