import {initTierDay,recordTierTrade,tierReport,formatTierReport} from './scalp-report.js';
import {tierConfig,activeTiers} from './scalp-tier.js';
import {jitterDelay} from './scalp-queue.js';
import {ScalpTelemetry} from './scalp-telemetry.js';
import {recordMintOutcome,entryGuard,quoteFailure,mintIsLocked} from './scalp-risk.js';
import {dayFor} from './store.js';
import {PaperWeek} from './engine.js';
import {paperLedgerCheck} from './momentum.js';
import {ScalpLog} from './scalp-log.js';
import {stageA,stageB,stageC,stageD,stageE,plannedSize,scalpExit,scalpExitPolicy} from './scalp-stages.js';
const key=m=>m.mint+':'+m.pairAddress;
export class ScalpWeek extends PaperWeek{
 constructor(store,adapter,opts){super(store,adapter,opts);this.safety=new Map();this.samples=new Map();this.reads=new Map();this.nextScan=0;this.cycle=0;this.audit=[];this.ready=new Set();this.sampleTimings=new Map();this.random=opts.random??Math.random;}
 async load(){await super.load();this.state.scalp??={consumed:{},startedAt:this.clock(),hourStartedAt:this.clock(),lastAdjustAt:this.clock(),relaxLevel:0,funnel:{},reasons:{},infra:0,forward:[]};for(const t of [...this.state.trades].sort((a,b)=>a.at-b.at))if(t.side==='BUY'||t.closed){const prior=this.state.scalp.consumed[t.mint];if(t.mint&&(!prior||t.at>prior.at))this.state.scalp.consumed[t.mint]={signalId:'legacy:'+t.id,orderId:t.id,at:t.at};}if(this.state.scalp.algorithmRevision!==this.policy.algorithmRevision)await this.store.checkpointPolicy(this.state,this.policy.algorithmRevision);
  this.state.scalp.mintRisk??={};
  for(const t of [...this.state.trades].sort((a,b)=>a.at-b.at))recordMintOutcome(this.state,t,this.policy);
  for(const mint of Object.keys(this.state.scalp.mintRisk))mintIsLocked(this.state,mint,this.policy,this.clock());
  if(this.state.scalp.algorithmRevision!==this.policy.algorithmRevision){
   this.state.scalp.revisions=[...(this.state.scalp.revisions??[]),{at:this.clock(),from:this.state.scalp.algorithmRevision??'sampling-v2-or-earlier',to:this.policy.algorithmRevision}].slice(-12);
   if(this.state.pending?.side==='BUY')this.state.pending=null;this.state.scalp.algorithmRevision=this.policy.algorithmRevision;this.state.scalp.revisionClosed=0;
  }
  for(const d of Object.values(this.state.daily??{}))initTierDay(d,this.clock());
  this.telemetry=new ScalpTelemetry(this.store.dir,{clock:this.clock});await this.telemetry.load();this.telemetry.startHour(this.state.scalp.hourStartedAt);this.logs=new ScalpLog(this.store.dir,this.policy);await this.logs.init();await this.store.save(this.state);}
 isMintBlocked(mint){return mintIsLocked(this.state,mint,this.policy,this.clock());}
 async seen(rows,source='feed'){for(const m of rows??[]){if(typeof m.mint!=='string'||this.candidates.has(m.mint))continue;this.candidates.set(m.mint,{mint:m.mint,pool:m.pairAddress??null,source,firstSeenAt:this.clock()});this.state.counts.seen++;while(this.candidates.size>this.policy.cacheLimit)this.candidates.delete(this.candidates.keys().next().value);}}
 async observe(markets){await this.seen(markets);this.updatePrices(markets);}
 assumptions(){return {...super.assumptions(),entry:'MEME-SCALP A -> B -> C -> D -> E; missing on-chain safety is B_UNVERIFIED',algorithmRevision:this.policy.algorithmRevision,emergencySlippageAssumptionBps:this.policy.emergencySlippageBps,exit:this.entryExitPolicy(),riskNote:this.policy.stopPct+'% price stop is a trigger, not a guaranteed exit price; executable quotes and modeled friction determine virtual PnL',ai:false};}
 entryExitPolicy(){return this.policy.scalpEntry?scalpExitPolicy(this.policy):super.entryExitPolicy();}
 exitPlan(p,price){return p.exitPolicy?.version===this.policy.version?scalpExit(p,price,this.clock()):super.exitPlan(p,price);}
 spawn(id,work,done){if(this.reads.has(id)||this.reads.size>=128)return;const task=Promise.resolve().then(work).then(done).catch(()=>done(null)).finally(()=>this.reads.delete(id));this.reads.set(id,task);}
 safetyRead(m){const now=this.clock(),prior=this.safety.get(m.mint);if(prior&&prior.pool===m.pairAddress&&now<prior.until)return prior.facts;
  this.spawn('B:'+m.mint,()=>this.adapter.scalpSafety(m),facts=>{const unknown=!facts||stageB(facts,m,this.policy,this.clock()).reason_code==='B_UNVERIFIED';this.safety.delete(m.mint);this.safety.set(m.mint,{pool:m.pairAddress,until:this.clock()+(unknown?this.policy.safetyRetryMs:this.policy.safetyTtlMs),facts});while(this.safety.size>this.policy.cacheLimit)this.safety.delete(this.safety.keys().next().value);});return null;
 }
 sampleRead(m,c=this.policy){const k=key(m),rows=this.samples.get(k)??[],last=rows.at(-1);
  if(!last||this.clock()-last.at>=c.cReadEveryMs)this.spawn('C:'+k,async()=>{const startedAt=this.clock();try{return await this.adapter.refreshCandidate(m);}finally{this.sampleTimings.set(k,{startedAt,completedAt:this.clock(),callLatencyMs:this.clock()-startedAt});while(this.sampleTimings.size>c.cacheLimit)this.sampleTimings.delete(this.sampleTimings.keys().next().value);}},row=>{if(row?.migratedPool&&row.migratedPool!==m.pairAddress){this.safety.delete(m.mint);return;}if(!row||!Number.isFinite(row.priceAt)||row.priceAt>this.clock()||this.clock()-row.priceAt>c.priceTtlMs||!(row.spotPriceSol>0)||!(row.liquidityQuoteSol>=0))return;const old=(this.samples.get(k)??[]).filter(p=>this.clock()-p.at<=c.cSpanMaxMs);if(old.length&&row.priceAt<=old.at(-1).at)return;old.push({at:row.priceAt,price:row.spotPriceSol,liquiditySol:row.liquidityQuoteSol,source:row.priceSource??'RPC curve reserves',callLatencyMs:this.sampleTimings.get(k)?.callLatencyMs??null});this.samples.delete(k);this.samples.set(k,old.slice(-c.cMaxStoredSamples));this.ready.add(k);while(this.samples.size>c.cacheLimit)this.samples.delete(this.samples.keys().next().value);});
  const result=stageC(rows,c,this.clock());result.metrics.callTiming=this.sampleTimings.get(k)??null;this.telemetry.record('C',m.mint,result.pass);return result;
 }
 context(m,signalId,entryTier='strict'){return {entryTier,ts:this.clock(),runId:this.state.sessionId,cycle_id:this.cycle,signal_id:signalId,mint:m.mint,pool:m.pairAddress??null,source:m.sources??[m.dexId],metrics:{A:null,B:null,C:null,D:null,E:null},context:{h1:m.change1hPct??null,h4:m.change4hPct??null,h4Label:m.change4hPct===undefined?'unverified / no source':'observed'},ai_context:null,model_output:null};}
 trackForward(m){const s=this.state.scalp;if(s.forward.some(f=>f.mint===m.mint&&f.pool===m.pairAddress))return;const price=m.spotPriceSol;if(!(price>0))return;if(s.forward.length>=this.policy.cacheLimit){s.forwardOverflow=(s.forwardOverflow??0)+1;return;}s.forward.push({mint:m.mint,pool:m.pairAddress,venue:m.dexId,at:this.clock(),base:price,high:price,low:price,done:[],samples:1,baselineSource:'public snapshot; not a fill'});}
 async evaluate(m){
  const signalId=m.mint+':'+this.cycle;let last;
  for(const entryTier of activeTiers(this.policy,this.state,this.clock())){
   const c=tierConfig(this.policy,entryTier),row=this.context(m,signalId,entryTier);
   const finish=r=>{row.stage_reached=r.stage_reached;row.reason_code=r.reason_code;row.hardBlock=this.policy.tierPolicy.hardBlocks.includes(r.reason_code);row.quality_rejection=!r.reason_code.startsWith('E_')&&!['B_UNVERIFIED','D_INFRA','D_QUOTE_PENDING','C_READY_BUSY','C_SPAN','C_STALE','LOG_CAPACITY','A_STALE'].includes(r.reason_code);this.audit.push(row);last=r;return r;};
   const a=m.noPool?{stage_reached:'A',reason_code:'NO_POOL',pass:false,metrics:{}}:stageA(m,c,this.clock());row.metrics.A=a.metrics;this.telemetry.record('A',m.mint,a.pass);
   if(!a.pass){finish(a);if(row.hardBlock)return a;continue;}
   const gate=entryGuard(m,this.state,c,this.clock(),signalId);if(!gate.pass){row.metrics.E=gate.metrics;return finish({...gate,stage_reached:'A'});}
   const facts=this.safetyRead(m),b=stageB(facts,m,c,this.clock());row.metrics.B=b.metrics;this.telemetry.record('B',m.mint,b.pass);this.trackForward(m);
   if(!b.pass){finish(b);if(row.hardBlock)return b;continue;}
   const micro=this.sampleRead(m,c);row.metrics.C=micro.metrics;if(!micro.pass){finish(micro);if(row.hardBlock)return micro;continue;}
   // The first A/B/C-passing tier is fixed for this intent, including all D retries.
   if(this.state.pending)return finish({stage_reached:'C',reason_code:'C_READY_BUSY'});
   if(this.logs.blocked)return finish({stage_reached:'C',reason_code:'LOG_CAPACITY'});
   const size=plannedSize({...m,liquidityQuoteSol:micro.metrics.samples.at(-1).liquiditySol},this.state,c);if(size<c.minOrderSol)return finish({stage_reached:'D',reason_code:'D_SIZE_UNAVAILABLE'});
   const amount=String(Math.floor(size*1e9));this.state.pending={id:'paper:'+this.state.sessionId+':'+ ++this.state.sequence,side:'BUY',entryTier,entryTierSnapshot:this.policy.tiers[entryTier],mint:m.mint,pool:m.pairAddress,amount,decidedAt:this.clock(),readyAt:this.clock()+c.fillDelayMs,strategyVersion:c.version,signalId,referencePriceSol:micro.metrics.samples.at(-1).price,scalpContext:row,sizeBase:size,sizeIndex:0,infraRetries:0};
   this.telemetry.record('D',m.mint);return finish({stage_reached:'D',reason_code:'D_QUOTE_PENDING'});
  }
  return last;
 }
 async decision(m){const o=this.state.pending,c=tierConfig(this.policy,o?.entryTier??'strict',o?.entryTierSnapshot),s=this.state;const facts=this.safety.get(m.mint)?.facts,a=stageA(m,c,this.clock()),b=stageB(facts,m,c,this.clock()),micro=stageC(this.samples.get(key(m))??[],c,this.clock());
  const view={...s,scalp:{...s.scalp,consumed:{...s.scalp.consumed}}};if(view.scalp.consumed[m.mint]?.orderId===o?.id)delete view.scalp.consumed[m.mint];
  const e=stageE({...m,liquidityQuoteSol:micro.metrics.samples?.at(-1)?.liquiditySol??m.liquidityQuoteSol},view,c,this.clock(),Number(o?.amount??0)/1e9,o?.signalId),valid=a.pass&&b.pass&&micro.pass&&e.pass;
  return {evidence:{source:'MEME-SCALP verified staged inputs'},inputs:{token:m.mint,pool:m.pairAddress,top10_pct:facts?.top10Pct??null,dev_wallet_pct:facts?.devPct??null,change_5m_pct:m.change5mPct,volume_5m_sol:m.volume5mUsd/m.solUsd,buys_5m:m.buys5m,sells_5m:m.sells5m,entry_confirmation:micro.metrics,scalp_metrics:{A:a.metrics,B:b.metrics,C:micro.metrics,E:e.metrics}},result:{verdict:valid?'VALID_SETUP':'SKIP',R1_detail:{proposed_size_sol:valid?Number(o.amount)/1e9:0},reason_code:!a.pass?a.reason_code:!b.pass?b.reason_code:!micro.pass?micro.reason_code:e.reason_code}};
 }
 async executionLog(o,code,metrics={},quality=true){if(code.startsWith('E_'))quality=false;this.state.scalp.reasons[code]=(this.state.scalp.reasons[code]??0)+1;if(code.startsWith('E_'))this.state.scalp.funnel.E=(this.state.scalp.funnel.E??0)+1;return this.logs.append([{...o.scalpContext,entryTier:o.entryTier??'legacy',ts:this.clock(),type:'execution',stage_reached:/^[ABCDE]_/.test(code)?code[0]:'D',reason_code:code,quality_rejection:quality,metrics:{...o.scalpContext.metrics,D:metrics}}]);}
 quoteWaitUntil(o){return Math.max(super.quoteWaitUntil(o),this.state.scalp.quoteBlockedUntil??0);}
 async onQuoteFailure(o,error,code){quoteFailure(this.state,o,error,code,this.policy,this.clock(),this.random);await this.store.save(this.state);}
 resizeOrder(o){const c=this.policy,sizes=[...c.dSizeFractions.map(f=>o.sizeBase*f),c.minOrderSol].filter((v,i,a)=>v>=c.minOrderSol&&a.indexOf(v)===i);const amount=Number(o.amount)/1e9,next=sizes.find(v=>v<amount-1e-9);if(next===undefined)return false;o.amount=String(Math.floor(next*1e9));o.sizeIndex=(o.sizeIndex??0)+1;o.infraRetries=0;o.nextAttemptAt=this.clock()+c.dBackoffMs[0];return true;}
 async fill(markets){const s=this.state,o=s.pending,c=tierConfig(this.policy,o?.entryTier??'strict',o?.entryTierSnapshot);if(!o||o.side!=='BUY')return super.fill(markets);if(this.clock()<o.readyAt||this.clock()<this.quoteWaitUntil(o))return;
  const m=markets.find(m=>m.mint===o.mint&&m.pairAddress===o.pool);if(!m||this.clock()-o.decidedAt>c.orderTimeoutMs){s.pending=null;return;}
  const gate=entryGuard(m,s,c,this.clock(),o.signalId);if(!gate.pass){await this.executionLog(o,gate.reason_code,gate.metrics,false);s.pending=null;return;}
  const initialChecks=[stageA(m,c,this.clock()),stageB(this.safety.get(m.mint)?.facts,m,c,this.clock())];for(const r of initialChecks)this.telemetry.record(r.stage_reached,m.mint,r.pass);
  for(const check of initialChecks)if(!check.pass){o.scalpContext.metrics[check.stage_reached]=check.metrics;await this.executionLog(o,check.reason_code,{},check.reason_code!=='B_UNVERIFIED');s.pending=null;return;}
  const confirmation=this.sampleRead(m,c);
  if(['C_STALE','C_SPAN'].includes(confirmation.reason_code)){
   // Keep the intent while RPC refreshes; freshness is still mandatory before BUY.
   if(!o.waitingForSample){o.scalpContext.metrics.C=confirmation.metrics;await this.executionLog(o,'C_REFRESH_PENDING',{},false);o.waitingForSample=true;}return;
  }
  o.waitingForSample=false;
  const prechecks=[confirmation];for(const check of prechecks){o.scalpContext.metrics[check.stage_reached]=check.metrics;if(!check.pass){await this.executionLog(o,check.reason_code,{},!['B_UNVERIFIED','C_STALE','C_SPAN'].includes(check.reason_code));s.pending=null;return;}}
  let job=this.quoteJobs.get(o.id);if(!job){if(this.quoteJobs.size>=c.maxBackground)return;job={done:false};job.task=Promise.resolve().then(()=>this.adapter.quote(o,m)).then(value=>{job.value=value;job.done=true;},error=>{job.error=error;job.done=true;});this.quoteJobs.set(o.id,job);return;}
  if(!job.done)return;this.quoteJobs.delete(o.id);
  if(job.error){const e=job.error,infra=e.status===429||e.name==='TimeoutError'||e.name==='AbortError'||/429|TIMEOUT|BACKOFF|RPC_UNAVAILABLE|QUOTE_QUEUE_BUSY/.test(String(e.code??'')+String(e.message??''));
   if(infra){await this.onQuoteFailure(o,e,e.status===429||/429|RATE_LIMITED/.test(String(e.code??'')+String(e.message??''))?'HTTP_429':/BACKOFF/.test(String(e.code??'')+String(e.message??''))?'BACKOFF':'D_INFRA');s.scalp.infra++;await this.executionLog(o,'D_INFRA',{attempt:o.infraRetries+1},false);if(o.infraRetries<c.dInfraRetries){o.nextAttemptAt=this.clock()+jitterDelay(c.dBackoffMs[o.infraRetries],this.random,c.retryJitterPct);o.infraRetries++;return;}s.pending=null;return;}
   if(this.resizeOrder(o))return;await this.executionLog(o,'D_COST',{detail:'NO_EXECUTABLE_ROUTE'});s.pending=null;return;
  }
  const d=stageD(job.value,o,c,this.clock());this.telemetry.record('D',m.mint,d.pass);if(!d.pass){
   if(d.detail==='STALE'&&o.infraRetries<c.dInfraRetries){await this.executionLog(o,'D_INFRA',{...d.metrics,detail:'QUOTE_EXPIRED_DURING_REFRESH'},false);s.scalp.infra++;o.nextAttemptAt=this.clock()+jitterDelay(c.dBackoffMs[o.infraRetries++],this.random,c.retryJitterPct);return;}
   if(d.detail==='FRICTION'&&this.resizeOrder(o)){await this.executionLog(o,'D_RESIZE_PENDING',{...d.metrics,detail:d.detail,nextSizeSol:Number(o.amount)/1e9},false);return;}
   await this.executionLog(o,'D_COST',{...d.metrics,detail:d.detail});s.pending=null;return;}
  const view=await this.decision(m);o.scalpContext.metrics.E=view.inputs.scalp_metrics.E;if(view.result.verdict!=='VALID_SETUP'){const code=view.result.reason_code;await this.executionLog(o,code,d.metrics);s.pending=null;return;}
  // Consumption is durable before submitting the virtual BUY, including subsequent failure.
  if(Object.keys(s.scalp.consumed).length>=c.cacheLimit&&!s.scalp.consumed[m.mint]){await this.executionLog(o,'E_REGISTRY_FULL',d.metrics);s.pending=null;return;}
  s.scalp.consumed[m.mint]={signalId:o.signalId,orderId:o.id,at:this.clock()};await this.store.save(s);if(!await this.executionLog(o,'E_PASS',d.metrics,false)){s.pending=null;return;}this.quoteJobs.set(o.id,{done:true,value:job.value,task:Promise.resolve()});await super.fill(markets);
 }
 async forwardTick(markets){const c=this.policy,s=this.state.scalp;for(const f of s.forward){const m=markets.find(m=>m.mint===f.mint&&m.pairAddress===f.pool),price=m?.spotPriceSol,at=m?.priceAt??m?.updatedAt;if(price>0&&at<=this.clock()&&this.clock()-at<=c.priceTtlMs&&at>(f.lastAt??f.at)){f.high=Math.max(f.high,price);f.low=Math.min(f.low,price);f.samples++;f.lastAt=at;f.lastPrice=price;}
   for(const minute of c.forwardMinutes){if(f.done.includes(minute)||this.clock()<f.at+minute*60000)continue;const row=m&&at>=f.at+minute*60000&&this.clock()-at<=c.priceTtlMs?{price,at}:null;if(!row&&this.clock()<f.at+minute*60000+c.forwardGraceMs){this.spawn('F:'+key({mint:f.mint,pairAddress:f.pool}),()=>this.adapter.refreshHeld([{mint:f.mint,pool:f.pool,venue:f.venue}],markets,m?.solUsd??this.lastSolUsd,{priority:'A'}),rows=>{const x=rows?.[0];if(x){f.lastAt=x.priceAt;f.lastPrice=x.spotPriceSol;f.high=Math.max(f.high,x.spotPriceSol);f.low=Math.min(f.low,x.spotPriceSol);f.samples++;}});if(f.lastAt>=f.at+minute*60000&&this.clock()-f.lastAt<=c.priceTtlMs){f.done.push(minute);await this.logForward(f,minute,f.lastPrice,f.lastAt);}continue;}
    f.done.push(minute);await this.logForward(f,minute,row?.price??null,row?.at??null);
   }
  }s.forward=s.forward.filter(f=>f.done.length<c.forwardMinutes.length);
 }
 async logForward(f,minute,price,at){await this.logs.append([{ts:this.clock(),type:'forward_outcome',mint:f.mint,pool:f.pool,minute,anchorAt:f.at,observedAt:at,returnPct:price>0?(price/f.base-1)*100:null,maxDrawupPct:(f.high/f.base-1)*100,maxDrawdownPct:(f.low/f.base-1)*100,samples:f.samples,coverage:'sampled only; gaps and continuous extrema unverified',baselineSource:f.baselineSource}]);}
 async addTrade(t){t.entryTier??=this.state.pending?.entryTier??'legacy';if(t.side==='BUY'){await this.telemetry.load(dayFor(t.at));this.telemetry.record('BUY',t.mint,true);}recordMintOutcome(this.state,t,this.policy);if(t.side==='SELL'){const p=this.state.positions.find(p=>p.id===t.positionId);if(p?.memory)delete p.memory.sellRetry;}t.algorithmRevision??=this.policy.algorithmRevision;t.strategyVersion??=this.state.pending?.strategyVersion??this.policy.version;if(t.closed&&t.algorithmRevision===this.policy.algorithmRevision)this.state.scalp.revisionClosed=(this.state.scalp.revisionClosed??0)+1;if(t.strategyVersion===this.policy.version){if(t.closed){this.state.scalp.consumed[t.mint]={signalId:this.state.scalp.consumed[t.mint]?.signalId??'exit:'+t.id,orderId:this.state.scalp.consumed[t.mint]?.orderId??t.id,at:t.at};}if(t.closed)this.state.scalp.sampleClosed=(this.state.scalp.sampleClosed??0)+1;if(t.side==='BUY')this.state.scalp.entryTimes=[...(this.state.scalp.entryTimes??[]).filter(at=>at>=this.clock()-this.policy.dayMs),t.at].slice(-this.policy.cacheLimit);}if(t.closed&&t.strategyVersion!==this.policy.version)this.state.scalp.consumed[t.mint]={signalId:'legacy-exit:'+t.id,orderId:t.id,at:t.at};await super.addTrade(t);await this.logs.append([{ts:t.at,type:'virtual_fill',...t}]);}
 async hourly(){await this.telemetry.load();const s=this.state.scalp,c=this.policy;if(this.clock()-s.hourStartedAt<c.hourMs)return;await this.logs.init();const report={ts:this.clock(),type:'hourly_funnel',uniqueMints:this.telemetry.snapshot(dayFor(this.clock()),s.hourStartedAt),from:s.hourStartedAt,funnel:s.funnel,topReasons:Object.entries(s.reasons).sort((a,b)=>b[1]-a[1]),infra:s.infra};console.info('SCALP FUNNEL '+JSON.stringify(report));await this.logs.append([report]);s.lastHour=report;s.hourStartedAt=this.clock();this.telemetry.startHour(s.hourStartedAt);s.funnel={};s.reasons={};
  const orders24h=(s.entryTimes??[]).filter(at=>at>=this.clock()-c.dayMs).length;
  s.adjustment={observedAt:this.clock(),eligible:c.autoRelax&&orders24h<c.minDailyOrders,orders24h,targetOrders24h:c.minDailyOrders,activeTiers:activeTiers(c,this.state,this.clock()),policy:'fixed tier fallback; never mutates shared D/exits or protected guards'};s.lastAdjustAt=this.clock();

 }
 async step(markets){if(this.busy)return;this.busy=true;try{await this.telemetry.load();for(const [id,job]of this.quoteJobs)if(job.done&&id!==this.state.pending?.id)this.quoteJobs.delete(id);this.state.scalp.fundSol=this.equity()===null?null:this.equity()/1e9;this.state.scalp.peakSol=Math.max(this.state.scalp.peakSol??0,this.state.scalp.fundSol??0);const day=Math.floor(this.clock()/this.policy.dayMs);if(this.state.scalp.day!==day){this.state.scalp.day=day;this.state.scalp.dayStartSol=this.state.scalp.fundSol;this.state.scalp.dayRealized=this.state.realized;}this.lastSolUsd=markets.find(m=>m.solUsd>0)?.solUsd??this.lastSolUsd;await this.observe(markets);this.state.scalp.fundSol=this.equity()===null?null:this.equity()/1e9;if(!paperLedgerCheck(this.state).verified)return;await this.monitor();if(this.state.pending?.side==='BUY'){const active=markets.find(m=>m.mint===this.state.pending.mint&&m.pairAddress===this.state.pending.pool);if(active)this.sampleRead(active,tierConfig(this.policy,this.state.pending.entryTier??'strict',this.state.pending.entryTierSnapshot));}await this.fill(markets);await this.monitor();if(!this.state.positions.some(p=>p.memory?.sellRetry||p.memory?.stopTriggered)&&this.state.pending?.side!=='SELL')await this.forwardTick(markets);if(this.logs.used+this.policy.sourceMaxBytes>this.policy.logQuotaMiB*1048576)this.logs.blocked=true;
  if(!this.logs.blocked&&!this.state.pending&&this.clock()<this.state.endsAt)for(const k of this.ready){this.ready.delete(k);const m=markets.find(m=>key(m)===k);if(!m)continue;this.audit=[];await this.evaluate(m);await this.logs.append(this.audit.map(r=>({...r,type:'candidate_progress'})));if(this.state.pending){this.state.scalp.funnel.D=(this.state.scalp.funnel.D??0)+1;break;}}
  if(this.logs.used+this.policy.sourceMaxBytes>this.policy.logQuotaMiB*1048576)this.logs.blocked=true;
  if(!this.logs.blocked&&this.clock()>=this.nextScan&&this.clock()<this.state.endsAt){this.nextScan=this.clock()+this.policy.scanMs;this.cycle=Math.floor(this.clock()/this.policy.scanMs);this.audit=[];for(const m of markets.slice(0,this.policy.maxCandidates))await this.evaluate(m);for(const r of this.audit){const s=this.state.scalp;s.reasons[r.reason_code]=(s.reasons[r.reason_code]??0)+1;for(const stage of ['A','B','C','D','E']){if(stage<=r.stage_reached)s.funnel[stage]=(s.funnel[stage]??0)+1;}}
   if(!await this.logs.append(this.audit)){if(this.state.pending?.side==='BUY')this.state.pending=null;}this.state.counts.evaluated+=this.audit.length;
  }await this.hourly();await this.telemetry.flush();await this.store.save(this.state);
 }catch(error){this.state.errors=[{at:this.clock(),code:'SCALP_CYCLE_UNAVAILABLE',errorType:error?.name},...this.state.errors].slice(0,20);}finally{this.busy=false;}}
 recordDailyTrade(day,t){recordTierTrade(day,t);}
 async reportExtras(day,{from=this.state.reportFrom,to=this.clock()}={}){await this.telemetry.load(day);const funnel=this.telemetry.snapshot(day);return {tierReport:tierReport(this.state.daily?.[day]),funnelReport:{...funnel,reportFrom:from,reportTo:to,coverageComplete:funnel.exact&&funnel.trackingFrom!==null&&funnel.trackingFrom<=from}};}
 reportTable(summary){return formatTierReport(summary);}
 async reportPreview(){
  await this.logs.chain;const s=this.state,now=this.clock(),day=dayFor(now);
  const training=await this.store.training(day);
  const summary={...await this.reportExtras(day),mode:'PAPER_WEEK',simulation:true,timezone:'Asia/Ho_Chi_Minh',day,from:s.reportFrom,to:now,currentStatus:this.status(),configuration:this.policy,warning:'SIMULATION ONLY; current reporting period, not a live fill record. Repetitive candidate scans are grouped; audit coverage is at the end.'};
  const text='MEME PILOT · PAPER / SOL ẢO · TRAINING EXPORT\n'+JSON.stringify(summary,null,2)+'\n\n'+this.reportTable(summary)+'\nRECORDS (JSONL; simulation=true; no real fills)\n'+training;
  return this.store.previewReport(text,{from:s.reportFrom,to:now,runId:s.sessionId});
 }
 status(){return {...super.status(),scalp:{version:this.policy.version,activeTiers:activeTiers(this.policy,this.state,this.clock()),uniqueMints:this.telemetry.snapshot(),funnel:this.state.scalp.funnel,reasons:this.state.scalp.reasons,lastHour:this.state.scalp.lastHour??null,adjustment:this.state.scalp.adjustment??null,safetyCached:this.safety.size,background:this.reads.size,forwardJobs:this.state.scalp.forward.length,storage:this.logs.status(),riskSourceRequired:!!this.policy.rugRequired,algorithmRevision:this.policy.algorithmRevision,mintLossLocks:Object.entries(this.state.scalp.mintRisk??{}).filter(([,r])=>r.blockedUntil>this.clock()).map(([mint,r])=>({mint,...r})),quoteBlockedUntil:this.state.scalp.quoteBlockedUntil??0,lastQuoteFailure:this.state.scalp.lastQuoteFailure??null,closedInThisStrategy:this.state.scalp.sampleClosed??0,closedInThisRevision:this.state.scalp.revisionClosed??0,evaluationEligible:(this.state.scalp.revisionClosed??0)>=this.policy.minEvaluateTrades},topSkips:Object.entries(this.state.scalp.reasons).sort((a,b)=>b[1]-a[1]).slice(0,12)};}
}
