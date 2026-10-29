import {rulesConfig} from './rules-config.js';import {setTimeout as sleep} from 'node:timers/promises';
export function quoteFailure(error,q,amount,now,p=rulesConfig()){
 if(q){if(q.probeSol!==amount)return 'size_mismatch';if(!Number.isFinite(q.quoteCheckedAt)||now<q.quoteCheckedAt||now-q.quoteCheckedAt>p.quoteMaxAgeMs)return 'stale';if(!Number.isFinite(q.roundTripLossPct)||q.roundTripLossPct<0)return 'invalid_quote';if(q.roundTripLossPct>p.maxRoundTripLossPct)return 'loss_too_high';if(![q.buyImpactPct,q.sellImpactPct].every(x=>Number.isFinite(x)&&x>=0&&x<=p.maxImpactPct))return 'impact_too_high';if(q.roundTripQuoteOk!==true)return 'no_route';return null;}
 const message=String(error?.message??'');if(error?.status===429||error?.code===429||/429|RATE_LIMIT|QUEUE_BUSY|backoff/i.test(message+' '+(error?.code??'')))return 'rate_limited';if(/stale|quá.*giây|quá.*cũ|đã cũ/i.test(message))return 'stale';if(/impact|độ sâu|dự trữ/i.test(message))return 'impact_too_high';if(/hao hụt|vượt 6%|roundtrip.*limit|chi phí.*vượt/i.test(message))return 'loss_too_high';if(/route|đường|không.*pool/i.test(message))return 'no_route';return 'network_error';
}
export function quoteLadder(size,min){return [...new Set([size,size*.5,size*.25,min].map(x=>Math.floor(x*1e9)/1e9).filter(x=>x>=min&&x<=size))].sort((a,b)=>b-a);}
export class RulesQuoteBroker{
 constructor(execution,{policy=rulesConfig(),clock=Date.now,marketSnapshot=()=>({markets:[]}),wait=sleep}={}){this.execution=execution;this.policy=policy;this.clock=clock;this.snapshot=marketSnapshot;this.wait=wait;this.active=0;this.queue=[];this.cache=new Map();this.recent=[];}
 async slot(work){if(this.active>=this.policy.quoteConcurrency)await new Promise(resolve=>this.queue.push(resolve));else this.active++;try{return await work();}finally{if(this.queue.length)this.queue.shift()();else this.active--;}}
 async select(c,plan){return this.slot(async()=>{
  const p=this.policy,attempts=[],market=this.snapshot().markets.find(m=>m.mint===c.mint&&m.pairAddress===c.pool);if(!market)return {ok:false,reason:'no_route',attempts};
  for(const size of quoteLadder(plan.size,p.minOrderSol)){
   for(let attempt=1;attempt<=p.quoteRetries;attempt++){
    const started=this.clock(),key=c.mint+':'+c.pool+':'+Math.round(size*1e9),cached=this.cache.get(key);let q,error;
    try{q=cached&&started-cached.at<=p.quoteCacheTtlMs?cached.quote:await this.execution.roundTripQuote(c.mint,String(Math.round(size*1e9)),market);}catch(e){error=e;}
    const at=this.clock(),reason=quoteFailure(error,q,size,at,p),row={at,mint:c.mint,pool:c.pool,sizeSol:size,attempt,httpStatus:Number.isInteger(error?.status)?error.status:Number(String(error?.message??'').match(/HTTP\s*(\d{3})/i)?.[1])||(/\b429\b/.test(error?.message??'')?429:null),code:typeof error?.code==='string'?error.code:null,reason,quote_age_ms:Number.isFinite(q?.quoteCheckedAt)?at-q.quoteCheckedAt:null,price_impact_pct:[q?.buyImpactPct,q?.sellImpactPct].every(Number.isFinite)?Math.max(q.buyImpactPct,q.sellImpactPct):null,roundtrip_loss_pct:q?.roundTripLossPct??null,source:q?.roundTripProvider??(market.dexId==='pumpfun'?'pumpfun-sdk':'jupiter'),latencyMs:at-started};attempts.push(row);console.info('RULES QUOTE',JSON.stringify(row));this.recent=[row,...this.recent].slice(0,100);
    if(!reason){this.cache.set(key,{at,quote:q});while(this.cache.size>128)this.cache.delete(this.cache.keys().next().value);return {ok:true,size,quote:q,attempts};}
    if(['loss_too_high','impact_too_high'].includes(reason))break;
    if(attempt<p.quoteRetries)await this.wait(Math.min(2000,p.quoteBackoffMs*2**(attempt-1)));
   }
  }
  return {ok:false,reason:attempts.at(-1)?.reason??'no_route',attempts};
 });}
}
