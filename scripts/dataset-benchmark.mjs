// Synthetic sizing only. Never reads account configuration or sends a request.
import {gzipSync} from 'node:zlib';
import {performance} from 'node:perf_hooks';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatasetCollector} from '../src/dataset.js';
let seed=137;const rand=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
const now=Date.now(),candidates=Array.from({length:60},(_,i)=>({mint:'synthetic-mint-'+i,pool:'synthetic-pool-'+i,priceSol:rand()/100,liquidityUsd:rand()*50000,marketCapUsd:rand()*100000,ageMs:rand()*86400000,m5Pct:rand()*30,h1Pct:rand()*100,volume5mUsd:rand()*50000,volume1hUsd:rand()*200000,buys5m:100,sells5m:80,closedM1:Array.from({length:16},(_,n)=>[now-n*60000,...Array.from({length:5},()=>rand()*100)]),flow:{complete:true,lastTenBuys:6,uniqueBuyers:45,uniqueSellers:25},mintSafety:{status:'verified',facts:{decimals:6,mintRevoked:true,freezeRevoked:true}}}));
const context={candidates,positions:[],wallet:{cashSol:1,running:true},limits:{maxOrderSol:.9}},row={requestedAt:now,respondedAt:now+1000,latencyMs:1000,model:'fixture',context,rawOutput:'{"decisions":[{"action":"HOLD"}]}',validate:{ok:true},executorResults:[]};
const streams={model_calls:[row],candidate_snapshots:candidates.map((features,i)=>({sampleId:'s'+i,mint:features.mint,features,bought:false,selectedForBuy:false})),forward_labels:candidates.flatMap((c,i)=>[60,180,300,600,900,1800].map(h=>({sampleId:'s'+i,mint:c.mint,horizonSeconds:h,entryPrice:c.priceSol,price:c.priceSol*(.8+rand()*.5),mfePct:rand()*30,maePct:-rand()*15,coverage:{complete:true,samples:h,maxGapMs:1000},tripleBarrier:[{slPct:10,tpPct:15,label:'TIMEOUT'},{slPct:15,tpPct:30,label:'TIMEOUT'},{slPct:20,tpPct:40,label:'TIMEOUT'}],quoteVsMid:{entryCostPct:null,exitCostPct:null,status:'not_quoted'}})))};
const sizes=Object.fromEntries(Object.entries(streams).map(([k,v])=>{const raw=Buffer.from(v.map(r=>JSON.stringify(r)).join('\n')+'\n');return [k,{rows:v.length,rawBytes:raw.length,gzipBytes:gzipSync(raw).length}];}));
const dir=await mkdtemp(path.join(tmpdir(),'dataset-bench-'));let collector;const times=[];
try{collector=new DatasetCollector(dir,{env:{DATASET_ENABLED:'true',DATASET_MIN_FREE_MIB:'1',DATASET_MAX_QUEUED_MESSAGES:'128'}});for(let i=0;i<20;i++){const t=performance.now();collector.record('model_start',{callId:'bench'+i,requestedAt:now,context});times.push(performance.now()-t);}await collector.close();}finally{await rm(dir,{recursive:true,force:true});}
times.sort((a,b)=>a-b);const perCycle=Object.values(sizes).reduce((n,s)=>n+s.gzipBytes,0);
console.log(JSON.stringify({synthetic:true,assumptions:{candidatesPerCall:60,callIntervalSeconds:5,horizons:6,excludes:'fills/errors/path events; real compression and traffic vary'},streams:sizes,enqueueMs:{mean:times.reduce((a,b)=>a+b,0)/times.length,p95:times[Math.ceil(times.length*.95)-1],max:times.at(-1)},estimatedMiBPerDay:perCycle*(86400/5)/1048576,retentionDaysAt500MiB:500/(perCycle*(86400/5)/1048576)},null,2));
