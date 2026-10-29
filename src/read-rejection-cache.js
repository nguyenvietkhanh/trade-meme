// Negative cache for deterministic READ validation failures. Never approves data or queues transactions.
export class ReadRejectionCache {
 constructor({clock=Date.now,ttlMs=600000,maxEntries=512}={}){this.clock=clock;this.ttlMs=ttlMs;this.maxEntries=maxEntries;this.rows=new Map();}
 get(key){const r=this.rows.get(key);if(!r)return null;if(this.clock()>=r.retryAt){this.rows.delete(key);return null;}return Object.assign(Error(r.message),{code:r.code,retryAt:r.retryAt,cachedReadRejection:true});}
 remember(key,error){
  const text=String(error?.message??'');let code;
  if(/requires supported SPL token programs/i.test(text))code='READ_UNSUPPORTED_TOKEN_PROGRAM';
  else if(/(?:pool|flow) (?:mint|program|identity)|pool\/fee ownership|Unsupported model pool identity\/version/i.test(text))code='READ_POOL_IDENTITY_REJECTED';
  else return false;
  this.rows.set(key,{code,message:text,retryAt:this.clock()+this.ttlMs});
  for(const [k,r]of this.rows)if(this.clock()>=r.retryAt)this.rows.delete(k);
  while(this.rows.size>this.maxEntries)this.rows.delete(this.rows.keys().next().value);return true;
 }
}
