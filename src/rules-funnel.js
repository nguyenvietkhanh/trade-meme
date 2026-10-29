const HOUR = 3600000;
const STAGES = ['discovery_seen','seen','pre_filter','safety','signal','quote','sent'];
const TIERS = ['STANDARD','PROBE','QUICK'];
const empty = () => ({...Object.fromEntries(STAGES.map(k=>[k,0])), signalByTier:{STANDARD:0,PROBE:0,QUICK:0}, reasons:{}});
const hourKey = at => new Date(at).toISOString().slice(0,13);
const top = reasons => Object.entries(reasons??{}).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,10).map(([reason,count])=>({reason,count}));
// Observability only: never grants an order or changes a trading threshold.
export class RulesFunnel {
 constructor({clock=Date.now}={}) { this.clock=clock;this.hours=new Map();this.days=new Map();this.observedSince=clock();this.sessionStartedAt=this.observedSince;this.unique=new Map(); }
 restore(data) {
  for(const [name,max] of [['hours',48],['days',14]]) this[name]=new Map(Object.entries(data?.[name]??{}).sort(([a],[b])=>a.localeCompare(b)).slice(-max));
  this.observedSince=Number.isFinite(data?.observedSince)?Math.min(data.observedSince,this.observedSince):this.observedSince;
  // Legacy counters contain no tier or continuous-coverage evidence: do not invent it.
 }
 add(stage,at=this.clock(),reason=null,{tier=null,count=1}={}) {
  if(!Number.isFinite(at)||!Number.isSafeInteger(count)||count<1)return;
  for(const [map,key,max] of [[this.hours,hourKey(at),48],[this.days,new Date(at).toISOString().slice(0,10),14]]) {
   const row=map.get(key)??{...empty(),schemaVersion:2,firstObservedAt:at,lastObservedAt:at,tierCoverage:'complete'};
   if(STAGES.includes(stage))row[stage]=(row[stage]??0)+count;
   if(stage==='signal'&&TIERS.includes(tier)){row.signalByTier??={STANDARD:0,PROBE:0,QUICK:0};row.signalByTier[tier]+=count;}
   if(reason){const code=/^[a-zA-Z0-9_.:-]{1,100}$/.test(reason)?reason:'OTHER';const keys=Object.keys(row.reasons??{});row.reasons??={};const bounded=keys.length>=64&&!(code in row.reasons)?'OTHER':code;row.reasons[bounded]=(row.reasons[bounded]??0)+count;}
   row.lastObservedAt=Math.max(row.lastObservedAt??at,at);map.set(key,row);while(map.size>max)map.delete(map.keys().next().value);
  }
  this.onChange?.(this.snapshot());
 }
 discovery(markets,at=this.clock()) {
  const mints=[...new Set(markets.map(m=>m.mint).filter(m=>typeof m==='string'&&m.length<=64))];
  if(mints.length)this.add('discovery_seen',at,null,{count:mints.length});else this.add('none',at);
  const key=hourKey(at),u=this.unique.get(key)??{mints:new Set(),truncated:false};
  for(const mint of mints){if(u.mints.size<4096)u.mints.add(mint);else if(!u.mints.has(mint))u.truncated=true;}
  this.unique.set(key,u);while(this.unique.size>2)this.unique.delete(this.unique.keys().next().value);
 }
 hourReport(start,now=this.clock()) {
  const key=hourKey(start),row=this.hours.get(key),u=this.unique.get(key);
  return {start:new Date(start).toISOString(),end:new Date(start+HOUR).toISOString(),status:row?'observed':'unavailable',
   coverage:row?{firstObservedAt:row.firstObservedAt??null,lastObservedAt:row.lastObservedAt??null,sessionStartedAt:this.sessionStartedAt,continuousHourVerified:false,tierCoverage:row.schemaVersion===2?(row.tierCoverage??'complete'):'legacy_unavailable'}:null,
   counts:row?Object.fromEntries(STAGES.map(k=>[k,Number.isFinite(row[k])?row[k]:null])):null,
   signalByTier:row?.signalByTier??null,uniqueDiscovered:u?{count:u.mints.size,scope:'this_process_session',truncated:u.truncated}:null,
   topSkips:row?top(row.reasons):null,complete:now>=start+HOUR};
 }
 report(now=this.clock()) {
  const current=Math.floor(now/HOUR)*HOUR;
  return {schemaVersion:2,generatedAt:new Date(now).toISOString(),currentHour:this.hourReport(current,now),lastCompletedHour:this.hourReport(current-HOUR,now),
   units:'Stage counts are token observations/evaluations, not unique tokens. discovery_seen covers feed rows; seen covers candidates submitted to rules. A token can have multiple SKIP reasons. uniqueDiscovered is bounded and session-only.',
   collection:'No historical reconstruction. Missing buckets, tier data and coverage remain explicitly unavailable. Calendar hours are UTC, not a rolling 60-minute window.'};
 }
 snapshot(){return {schemaVersion:2,observedSince:this.observedSince,hours:Object.fromEntries(this.hours),days:Object.fromEntries(this.days),hourlyReport:this.report(),note:'Checkpointed with existing live ledger. Reporting only; no trading thresholds changed.'};}
}
