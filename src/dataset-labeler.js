export const HORIZONS=[60,180,300,600,900,1800];
const barriers=[[10,15],[15,30],[20,40]];
export class ForwardLabeler{
 constructor(emit,{maxActive=30000,toleranceMs=2000}={}){this.emit=emit;this.maxActive=maxActive;this.toleranceMs=toleranceMs;this.active=new Map();this.count=0;}
 add(row){
  if(this.count>=this.maxActive){for(const horizonSeconds of HORIZONS)this.emit({...row,horizonSeconds,price:null,mfePct:null,maePct:null,coverage:{status:'capacity_dropped',complete:false},tripleBarrier:null});return;}
  const r={...row,entryAt:row.decisionAt+2000,entryPrice:null,lastPriceAt:null,maxGapMs:0,seen:0,high:null,low:null,hits:barriers.map(([sl,tp])=>({sl,tp,hit:null,hitAt:null})),windows:Object.fromEntries(HORIZONS.map(h=>[h,{high:null,low:null,lastAt:null,seen:0,gap:0}])),done:new Set()};
  const list=this.active.get(row.mint)??[];list.push(r);this.active.set(row.mint,list);this.count++;
 }
 quote(callId,mint,value){for(const row of this.active.get(mint)??[])if(row.callId===callId)row.quoteVsMid=value;}
 prices(prices,now){
  const map=new Map(prices.map(p=>[p.mint,p]));
  for(const [mint,rows]of this.active){const p=map.get(mint),valid=p&&Number.isFinite(p.spotPriceSol)&&p.spotPriceSol>0&&Number.isFinite(p.priceAt)&&p.priceAt<=now&&now-p.priceAt<=1500;
   for(const r of rows){
    if(valid&&p.priceAt>=r.entryAt&&(r.lastPriceAt===null||p.priceAt>r.lastPriceAt)){
     if(!r.entryPrice&&p.priceAt<=r.entryAt+this.toleranceMs)r.entryPrice=p.spotPriceSol;
     if(r.lastPriceAt!==null)r.maxGapMs=Math.max(r.maxGapMs,p.priceAt-r.lastPriceAt);
     for(const seconds of HORIZONS){const w=r.windows[seconds];if(p.priceAt<=r.entryAt+seconds*1000){w.high=Math.max(w.high??-Infinity,p.spotPriceSol);w.low=Math.min(w.low??Infinity,p.spotPriceSol);if(w.lastAt!==null)w.gap=Math.max(w.gap,p.priceAt-w.lastAt);w.lastAt=p.priceAt;w.seen++;}}
     r.lastPriceAt=p.priceAt;r.seen++;r.high=Math.max(r.high??-Infinity,p.spotPriceSol);r.low=Math.min(r.low??Infinity,p.spotPriceSol);
     if(r.entryPrice)for(const b of r.hits)if(!b.hit){const stop=p.spotPriceSol<=r.entryPrice*(1-b.sl/100),take=p.spotPriceSol>=r.entryPrice*(1+b.tp/100);if(stop||take){b.hit=stop?'SL':'TP';b.hitAt=p.priceAt;}}
    }
    for(const seconds of HORIZONS){if(r.done.has(seconds))continue;const target=r.entryAt+seconds*1000;
     if(now<target)continue;
     const endpoint=valid&&p.priceAt>=target&&p.priceAt<=target+this.toleranceMs;
     if(!endpoint&&now<=target+this.toleranceMs)continue;
     this.finish(r,seconds,endpoint?p:null,now);
    }
   }
   const keep=rows.filter(r=>r.done.size<HORIZONS.length);this.count-=rows.length-keep.length;if(keep.length)this.active.set(mint,keep);else this.active.delete(mint);
  }
 }
 finish(r,seconds,p,now,interrupted=false){
  r.done.add(seconds);const target=r.entryAt+seconds*1000,w=r.windows[seconds],tail=Math.max(0,target-(w.lastAt??r.entryAt)),gap=Math.max(w.gap,tail),complete=!!r.entryPrice&&!!p&&gap<=this.toleranceMs&&!interrupted;
  this.emit({sampleId:r.sampleId,callId:r.callId,snapshotId:r.snapshotId,mint:r.mint,decisionAt:r.decisionAt,entryAt:r.entryAt,entryPrice:r.entryPrice,horizonSeconds:seconds,targetAt:target,observedAt:p?.priceAt??null,price:p?.spotPriceSol??null,returnPct:r.entryPrice&&p?100*(p.spotPriceSol/r.entryPrice-1):null,mfePct:complete&&r.entryPrice&&w.high!==null?100*(w.high/r.entryPrice-1):null,maePct:complete&&r.entryPrice&&w.low!==null?100*(w.low/r.entryPrice-1):null,observedMfePct:r.entryPrice&&w.high!==null?100*(w.high/r.entryPrice-1):null,observedMaePct:r.entryPrice&&w.low!==null?100*(w.low/r.entryPrice-1):null,coverage:{status:interrupted?'interrupted':complete?'complete':!r.entryPrice?'entry_missing':!p?'endpoint_missing':'gapped',complete,samples:w.seen,maxGapMs:gap,extremaScope:'observed-only'},tripleBarrier:r.hits.map(b=>({slPct:b.sl,tpPct:b.tp,label:complete?(b.hit&&b.hitAt<=target?b.hit:'TIMEOUT'):null,observedHit:b.hitAt<=target?b.hit:null,hitAt:b.hitAt<=target?b.hitAt:null})),quoteVsMid:r.quoteVsMid??{entryCostPct:null,exitCostPct:null,status:'not_quoted'}});
 }
 async closeAsync(flush){let count=0;for(const rows of this.active.values())for(const r of rows)for(const h of HORIZONS)if(!r.done.has(h)){this.finish(r,h,null,Date.now(),true);if(++count%512===0)await flush();}this.active.clear();this.count=0;}
 close(){for(const rows of this.active.values())for(const r of rows)for(const h of HORIZONS)if(!r.done.has(h))this.finish(r,h,null,Date.now(),true);this.active.clear();this.count=0;}
}
