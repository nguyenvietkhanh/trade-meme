// PAPER-only bounded work queue. Active I/O is not preempted; queued D > C > A.
const rank={D:0,C:1,A:2};
export class ScalpQueue{
 constructor({concurrency=4,maxPending=128,clock=Date.now}={}){this.limit=concurrency;this.maxPending=maxPending;this.clock=clock;this.active=0;this.queue=[];this.sequence=0;this.completed=0;}
 run(stage,work,{exit=false}={}){
  if(!(stage in rank))return Promise.reject(Error('PAPER_QUEUE_STAGE_INVALID'));
  if(this.queue.length>=this.maxPending)return Promise.reject(Object.assign(Error('PAPER_QUOTE_QUEUE_BUSY'),{code:'QUOTE_QUEUE_BUSY'}));
  return new Promise((resolve,reject)=>{this.queue.push({stage,work,exit,resolve,reject,id:this.sequence++,queuedAt:this.clock()});queueMicrotask(()=>this.drain());});
 }
 drain(){
  this.queue.sort((a,b)=>rank[a.stage]-rank[b.stage]||Number(b.exit)-Number(a.exit)||a.id-b.id);
  while(this.active<this.limit&&this.queue.length){const job=this.queue.shift();this.active++;Promise.resolve().then(job.work).then(job.resolve,job.reject).finally(()=>{this.active--;this.completed++;this.drain();});}
 }
 status(){return {priority:['D','C','A'],active:this.active,queued:this.queue.length,concurrency:this.limit,completed:this.completed};}
}
export function jitterDelay(base,random=Math.random,pct=.2){return Math.round(base*(1-pct+2*pct*Math.max(0,Math.min(1,random()))));}
export function paperQuoteTransport({env=process.env,fetcher=globalThis.fetch,clock=Date.now,random=Math.random}={}){
 const key=typeof env.JUPITER_API_KEY==='string'?env.JUPITER_API_KEY.trim():'';let failures=0,retryAt=0,requests=0,http429=0,status=null;
 const failure=(s,header)=>{failures++;status=s;let advertised=0;if(header){const n=Number(header);advertised=Number.isFinite(n)?n*1000:Date.parse(header)-clock();}retryAt=clock()+Math.max(jitterDelay(Math.min(8000,1000*2**Math.min(failures-1,3)),random),Math.min(600000,Math.max(0,advertised)||0));};
 const transport=async(url,options={})=>{
  const u=new URL(url);if(String(options.method??'GET').toUpperCase()!=='GET'||!['lite-api.jup.ag','api.jup.ag'].includes(u.hostname)||u.pathname!=='/swap/v1/quote')throw Error('PAPER_QUOTE_READ_ONLY');
  if(clock()<retryAt)throw Object.assign(Error('PAPER_QUOTE_BACKOFF'),{code:'PROVIDER_BACKOFF',status,retryAt});
  const headers=new Headers(options.headers);if(key){u.hostname='api.jup.ag';headers.set('x-api-key',key);}
  let r;try{requests++;r=await fetcher(u,{...options,method:'GET',headers,redirect:'error'});}catch(error){failure(null,null);if(error&&typeof error==='object')error.retryAt=retryAt;throw error;}
  if([403,408,429,500,502,503,504].includes(r.status)){if(r.status===429)http429++;failure(r.status,r.headers.get('retry-after'));await r.body?.cancel();throw Object.assign(Error('PAPER_QUOTE_HTTP_'+r.status),{code:r.status===429?'HTTP_429':'PROVIDER_BACKOFF',status:r.status,retryAt});}
  failures=0;retryAt=0;status=r.status;return r;
 };
 transport.diagnostics=()=>({keyConfigured:!!key,failures,retryAt,status,requests,http429});return transport;
}
