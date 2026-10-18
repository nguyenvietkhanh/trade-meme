const validMint=m=>typeof m==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m);
/** Bounded discovery memory, never a source of executable prices or safety evidence. */
export class DiscoveryQueue{
 constructor(saved=[],now=Date.now()){
  this.entries=new Map();this.discoveryResults=null;this.discoveryJob=null;this.discoveryStartedAt=0;
  for(const r of Array.isArray(saved)?saved.slice(-600):[])if(validMint(r?.mint)&&Number.isFinite(r.firstSeenAt)&&r.firstSeenAt<=now)this.entries.set(r.mint,{mint:r.mint,firstSeenAt:r.firstSeenAt,lastSeenAt:Math.min(now,Number(r.lastSeenAt)||r.firstSeenAt),pairCreatedAt:Number.isFinite(r.pairCreatedAt)&&r.pairCreatedAt>0?r.pairCreatedAt:null,lastQueriedAt:Math.min(now,Number(r.lastQueriedAt)||0)});
  this.prune();
 }
 remember(rows,now=Date.now()){
  for(const row of rows){
   if(!validMint(row?.mint))continue;
   const old=this.entries.get(row.mint),created=Number.isFinite(row.pairCreatedAt)&&row.pairCreatedAt>0&&row.pairCreatedAt<=now?row.pairCreatedAt:null;
   this.entries.set(row.mint,{mint:row.mint,firstSeenAt:old?.firstSeenAt??now,lastSeenAt:now,pairCreatedAt:created??old?.pairCreatedAt??null,lastQueriedAt:old?.lastQueriedAt??0});
  }
  this.prune();
 }
 prune(){
  // Bound memory by capacity, never by the pool's birth date.
  if(this.entries.size>600){const ordered=[...this.entries.values()].sort((a,b)=>b.lastSeenAt-a.lastSeenAt);for(const r of ordered.slice(600))this.entries.delete(r.mint);}
 }
 nextBatch(exclude=[]){
  this.prune();const skip=new Set(exclude);
  return [...this.entries.values()].filter(r=>!skip.has(r.mint)).sort((a,b)=>a.lastQueriedAt-b.lastQueriedAt||a.firstSeenAt-b.firstSeenAt).slice(0,30).map(r=>r.mint);
 }
 queried(mints,now=Date.now()){for(const mint of mints){const r=this.entries.get(mint);if(r)r.lastQueriedAt=now;}}
 snapshot(){return [...this.entries.values()].map(r=>({...r}));}
 async discover(loader,now=Date.now()){
  if(!this.discoveryJob&&(!this.discoveryResults||now-this.discoveryStartedAt>=30000)){
   this.discoveryStartedAt=now;
   this.discoveryJob=loader().then(results=>{this.discoveryResults=results;return results;}).finally(()=>{this.discoveryJob=null;});
  }
  // Only bootstrap waits for discovery. Subsequent price scans never wait on optional sources.
  return this.discoveryResults??await this.discoveryJob;
 }
}
