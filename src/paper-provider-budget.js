export class ProviderBudget{
 constructor({clock=Date.now,random=Math.random}={}){this.clock=clock;this.random=random;this.cache=new Map();this.inflight=new Map();this.stats={calls:0,errors:0,http429:0,modelFallbacks:0};this.breakers=new Map();}
 async read(key,work,{ttlMs=0,provider='read'}={}){
  const now=this.clock(),cached=this.cache.get(key);if(cached&&now>=cached.at&&now-cached.at<ttlMs)return structuredClone(cached.value);
  if(this.inflight.has(key))return structuredClone(await this.inflight.get(key));
  const breaker=this.breakers.get(provider);if(breaker&&now<breaker.until)throw Object.assign(Error('Provider backoff '+provider),{code:'PROVIDER_BACKOFF'});
  const task=(async()=>{try{this.stats.calls++;const value=await work();this.cache.set(key,{at:this.clock(),value});while(this.cache.size>256)this.cache.delete(this.cache.keys().next().value);this.breakers.delete(provider);return value;}catch(error){this.stats.errors++;if(/429/.test(error.message)){this.stats.http429++;const n=(breaker?.n??0)+1;this.breakers.set(provider,{n,until:this.clock()+Math.min(60000,1000*2**n)*(1+this.random()*.2)});}throw error;}})();
  this.inflight.set(key,task);try{return structuredClone(await task);}finally{this.inflight.delete(key);for(const [k,v]of this.cache)if(this.clock()-v.at>600000)this.cache.delete(k);}
 }
}
