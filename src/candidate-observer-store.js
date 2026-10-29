import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,statSync,chmodSync,statfsSync} from 'node:fs';
import path from 'node:path';
import {HORIZONS,outcome,validId} from './candidate-observer-data.js';
export class CandidateStore {
 constructor(config) {
  this.config=config;mkdirSync(config.dir,{recursive:true,mode:0o700});this.file=path.join(config.dir,'candidates.sqlite');this.db=new DatabaseSync(this.file);chmodSync(this.file,0o600);
  this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA auto_vacuum=INCREMENTAL; PRAGMA busy_timeout=1000; PRAGMA cache_size=-2048; PRAGMA temp_store=FILE;');
  const pageSize=this.db.prepare('PRAGMA page_size').get().page_size;const pages=Math.floor((config.maxBytes-2*1048576)/(pageSize*2));this.db.exec('PRAGMA max_page_count='+pages);
  this.db.exec(`CREATE TABLE IF NOT EXISTS candidates(mint TEXT PRIMARY KEY, pool TEXT, first_seen INTEGER NOT NULL, data TEXT NOT NULL, labeled INTEGER NOT NULL DEFAULT 0, next_poll INTEGER NOT NULL DEFAULT 0);
   CREATE INDEX IF NOT EXISTS candidate_due ON candidates(labeled,next_poll);
   CREATE INDEX IF NOT EXISTS candidate_age ON candidates(first_seen);
   CREATE TABLE IF NOT EXISTS snapshots(mint TEXT NOT NULL REFERENCES candidates(mint) ON DELETE CASCADE,minute INTEGER NOT NULL,target_at INTEGER NOT NULL,data TEXT,PRIMARY KEY(mint,minute));
   CREATE TABLE IF NOT EXISTS samples(mint TEXT NOT NULL REFERENCES candidates(mint) ON DELETE CASCADE,at INTEGER NOT NULL,price REAL,liquidity REAL,PRIMARY KEY(mint,at));
   CREATE TABLE IF NOT EXISTS labels(mint TEXT PRIMARY KEY REFERENCES candidates(mint) ON DELETE CASCADE,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value INTEGER NOT NULL);`);
  this.dropped=Number(this.db.prepare("SELECT value FROM metadata WHERE key='dropped'").get()?.value??0);this.pruned=Number(this.db.prepare("SELECT value FROM metadata WHERE key='pruned'").get()?.value??0);this.rawSamplesDeleted=Number(this.db.prepare("SELECT value FROM metadata WHERE key='raw_samples_deleted'").get()?.value??0);this.lastMaintain=0;this.maintain(Date.now());
 }
 transaction(fn){const counters={dropped:this.dropped,pruned:this.pruned,rawSamplesDeleted:this.rawSamplesDeleted};this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){Object.assign(this,counters);this.db.exec('ROLLBACK');throw e;}}
 get(mint){const row=this.db.prepare('SELECT * FROM candidates WHERE mint=?').get(mint);return row?{...row,record:JSON.parse(row.data)}:null;}
 write(c){this.db.prepare('UPDATE candidates SET pool=?,data=? WHERE mint=?').run(c.pool,JSON.stringify(c),c.mint);}
 seen(row,now=Date.now()) {
  if(!validId(row.mint))return;
  let old=this.get(row.mint),c=old?.record;
  if(!c){
   c={mint:row.mint,pool:row.pool,firstSeenAt:row.firstSeenAt,firstSeenUtc:new Date(row.firstSeenAt).toISOString(),poolAgeMs:row.poolCreatedAt&&row.poolCreatedAt<=row.firstSeenAt?row.firstSeenAt-row.poolCreatedAt:null,source:row.source,decision:'SKIP',skipCode:'NOT_EVALUATED',wouldBuy:false,filterPassed:null,evaluationStatus:'NOT_EVALUATED',decisionAt:null,executor:null,initialObservationDropped:row.missing?.all==='OBSERVATION_BUFFER_FULL'};
   this.db.prepare('INSERT INTO candidates(mint,pool,first_seen,data,next_poll) VALUES(?,?,?,?,?)').run(c.mint,c.pool,c.firstSeenAt,JSON.stringify(c),now);
   const full=this.db.prepare('SELECT count(*) AS n FROM candidates WHERE labeled=0').get().n>this.config.maxPending;
   for(const minute of HORIZONS)this.db.prepare('INSERT INTO snapshots(mint,minute,target_at,data) VALUES(?,?,?,?)').run(c.mint,minute,c.firstSeenAt+minute*60000,full?JSON.stringify(this.empty(minute,c.firstSeenAt+minute*60000,now,'QUEUE_FULL')):null);
   if(full){this.dropped+=HORIZONS.length;this.db.prepare('UPDATE candidates SET next_poll=? WHERE mint=?').run(c.firstSeenAt+3600000+this.config.graceMs,c.mint);return;}
  }
  if(old?.labeled)return;
  // Follow the first observed pool consistently; do not switch price series between pairs.
  if(c.pool&&row.pool&&c.pool!==row.pool)return;
  if(!c.pool&&row.pool){c.pool=row.pool;c.poolAgeMs=row.poolCreatedAt&&row.poolCreatedAt<=c.firstSeenAt?c.firstSeenAt-row.poolCreatedAt:null;this.write(c);}
  const at=row.observedAt;
  if(at!==null&&row.values.priceUsd>0)this.db.prepare('UPDATE candidates SET next_poll=MAX(next_poll,?) WHERE mint=?').run(at+this.config.sampleMs,c.mint);
  if(at!==null&&at>=c.firstSeenAt&&at<=c.firstSeenAt+3600000){
   const last=this.db.prepare('SELECT at FROM samples WHERE mint=? ORDER BY at DESC LIMIT 1').get(c.mint);
   if(!last||at-last.at>=this.config.sampleMs)this.db.prepare('INSERT OR IGNORE INTO samples VALUES(?,?,?,?)').run(c.mint,at,row.values.priceUsd??null,row.values.liquidityUsd??null);
  }
  for(const task of this.db.prepare('SELECT minute,target_at,data FROM snapshots WHERE mint=? AND data IS NOT NULL AND target_at BETWEEN ? AND ?').all(c.mint,now-this.config.graceMs,now)){
   const snapshot=JSON.parse(task.data);if(snapshot.dropped)continue;let changed=false;
   for(const [key,value]of Object.entries(row.values)){if(snapshot.values[key]===null&&value!==null){snapshot.values[key]=value;snapshot.provenance[key]=row.provenance[key];delete snapshot.missing[key];changed=true;}}
   if(changed)this.db.prepare('UPDATE snapshots SET data=? WHERE mint=? AND minute=?').run(JSON.stringify(snapshot),c.mint,task.minute);
  }
  for(const task of this.db.prepare('SELECT minute,target_at FROM snapshots WHERE mint=? AND data IS NULL AND target_at<=?').all(c.mint,now)){
   if(now-task.target_at>this.config.graceMs)continue;
   // Never stamp a pre-target cached observation as the scheduled future snapshot.
   if(at===null||at<task.target_at||at>task.target_at+this.config.graceMs)continue;
   if(at<=c.firstSeenAt+3600000)this.db.prepare('INSERT OR IGNORE INTO samples VALUES(?,?,?,?)').run(c.mint,at,row.values.priceUsd??null,row.values.liquidityUsd??null);
   const snapshot={minute:task.minute,targetAt:task.target_at,capturedAt:now,observedAt:at,source:row.source,dropped:false,values:row.values,provenance:row.provenance,missing:row.missing};
   this.db.prepare('UPDATE snapshots SET data=? WHERE mint=? AND minute=?').run(JSON.stringify(snapshot),c.mint,task.minute);
  }
 }
 empty(minute,targetAt,now,reason){return {minute,targetAt,capturedAt:now,observedAt:null,dropped:true,source:null,values:{priceUsd:null,marketCapUsd:null,liquidityUsd:null,buys5m:null,sells5m:null,uniqueBuyers5m:null,uniqueSellers5m:null,volume5mUsd:null,buyVolume5mUsd:null,sellVolume5mUsd:null,change5mPct:null,change1hPct:null,holderCount:null,top10Pct:null,devPct:null},missing:{all:reason}};}
 freeBytes(){const s=statfsSync(this.config.dir);return s.bavail*s.bsize;}
 hasSpace(){return this.freeBytes()>=this.config.minFreeBytes;}
 decision(row){let found=this.get(row.mint);if(!found){this.seen({mint:row.mint,pool:row.pool??null,firstSeenAt:row.at,poolCreatedAt:null,source:'decision_only',observedAt:null,values:{}},row.at);found=this.get(row.mint);}const c=found.record;
  const update={action:row.action,at:row.at,code:row.code,pool:row.pool??null};c.decisionPool=row.pool??null;c.decisionPoolMatchesTracked=row.pool&&c.pool?row.pool===c.pool:null;c.firstDecision??=update;c.lastDecision=update;
  // "would buy" means an actual executable BUY decision occurred within the first hour.
  if(row.at<=c.firstSeenAt+3600000){c.decision=row.wouldBuy?'BUY':c.wouldBuy?'BUY':'SKIP';c.wouldBuy=c.wouldBuy||row.wouldBuy;c.filterPassed=c.filterPassed===true||row.filterPassed===true;c.skipCode=c.wouldBuy?null:row.code;c.evaluationStatus='EVALUATED';c.decisionAt=row.at;this.write(c);
   const label=this.db.prepare('SELECT data FROM labels WHERE mint=?').get(c.mint);if(label){const d=JSON.parse(label.data);d.bot_would_have_bought=c.wouldBuy;d.evaluation_status=c.evaluationStatus;this.db.prepare('UPDATE labels SET data=? WHERE mint=?').run(JSON.stringify(d),c.mint);}}
 }
 execution(row){const found=this.get(row.mint);if(!found)return;const c=found.record;c.executor=row;this.write(c);}
 finish(mint,now){const found=this.get(mint);if(!found||found.labeled)return;const snaps=this.db.prepare('SELECT data FROM snapshots WHERE mint=? ORDER BY minute').all(mint).map(r=>JSON.parse(r.data??'null')).filter(Boolean),samples=this.db.prepare('SELECT at,price AS priceUsd,liquidity AS liquidityUsd FROM samples WHERE mint=? ORDER BY at').all(mint);
  const label={mint,computedAt:now,...outcome(found.record,samples,snaps,now,this.config.sampleMs)};this.db.prepare('INSERT OR REPLACE INTO labels VALUES(?,?)').run(mint,JSON.stringify(label));this.db.prepare('UPDATE candidates SET labeled=1 WHERE mint=?').run(mint);
  if(this.config.deleteRawAfterLabel)this.rawSamplesDeleted+=this.db.prepare('DELETE FROM samples WHERE mint=?').run(mint).changes;
 }
 expire(now=Date.now(),reason='MISSED_WINDOW') {
  for(const t of this.db.prepare('SELECT s.mint,s.minute,s.target_at FROM snapshots s JOIN candidates c ON c.mint=s.mint WHERE s.data IS NULL AND s.target_at<? LIMIT 1000').all(now-this.config.graceMs)){
   this.db.prepare('UPDATE snapshots SET data=? WHERE mint=? AND minute=?').run(JSON.stringify(this.empty(t.minute,t.target_at,now,reason)),t.mint,t.minute);this.dropped++;
  }
  for(const c of this.db.prepare('SELECT mint FROM candidates WHERE labeled=0 AND first_seen<=? AND NOT EXISTS(SELECT 1 FROM snapshots s WHERE s.mint=candidates.mint AND s.data IS NULL) LIMIT 1000').all(now-3600000))this.finish(c.mint,now);
 }
 due(now){return this.db.prepare('SELECT mint,pool,first_seen FROM candidates WHERE labeled=0 AND next_poll<=? AND first_seen>=? ORDER BY next_poll,first_seen LIMIT 30').all(now,now-3600000-this.config.graceMs);}
 polled(rows,now){for(const r of rows)this.db.prepare('UPDATE candidates SET next_poll=? WHERE mint=?').run(now+this.config.sampleMs,r.mint);}
 maintain(now=Date.now()){
  // Migration/restart cleanup also removes old completed raw paths, preserving labels/features.
  if(this.config.deleteRawAfterLabel)this.rawSamplesDeleted+=this.db.prepare('DELETE FROM samples WHERE mint IN(SELECT mint FROM candidates WHERE labeled=1)').run().changes;
  this.pruned+=this.db.prepare('DELETE FROM candidates WHERE first_seen<?').run(now-this.config.retentionDays*86400000).changes;
  // Leave journal headroom. Reclaim oldest research only; never open financial files.
  const pageSize=this.db.prepare('PRAGMA page_size').get().page_size;
  for(let i=0;i<256;i++) {const total=this.db.prepare('PRAGMA page_count').get().page_count,free=this.db.prepare('PRAGMA freelist_count').get().freelist_count;if((total-free)*pageSize<this.config.maxBytes*.35&&this.hasSpace())break;
   const n=this.db.prepare('DELETE FROM candidates WHERE mint IN(SELECT mint FROM candidates ORDER BY first_seen LIMIT 1000)').run().changes;this.pruned+=n;if(!n)break;if(!this.hasSpace())this.db.exec('PRAGMA incremental_vacuum');}
  this.db.exec('PRAGMA incremental_vacuum');this.persistCounters();this.lastMaintain=now;
 }
 persistCounters(){for(const [k,v]of [['dropped',this.dropped],['pruned',this.pruned],['raw_samples_deleted',this.rawSamplesDeleted]])this.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run(k,v);}
 status(){return {ready:true,candidates:this.db.prepare('SELECT count(*) AS n FROM candidates').get().n,labeled:this.db.prepare('SELECT count(*) AS n FROM labels').get().n,snapshots:this.db.prepare('SELECT count(*) AS n FROM snapshots WHERE data IS NOT NULL').get().n,pendingSnapshots:this.db.prepare('SELECT count(*) AS n FROM snapshots WHERE data IS NULL').get().n,droppedSnapshots:this.dropped,rawSamplesDeleted:this.rawSamplesDeleted,deleteRawAfterLabel:this.config.deleteRawAfterLabel,lastCleanupAt:this.lastMaintain,prunedCandidates:this.pruned,usedBytes:statSync(this.file).size,maxBytes:this.config.maxBytes,freeBytes:this.freeBytes(),minFreeBytes:this.config.minFreeBytes,retentionDays:this.config.retentionDays};}
 close(){this.persistCounters();this.db.close();}
}
