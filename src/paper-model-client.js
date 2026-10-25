import {modelMessages,validateModelDecision} from './paper-model-context.js';
import {retryAfterMs} from './provider-fetch.js';
const number=(x,f,min,max)=>{const n=Number(x);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):f;};
const failure=(code,extra={})=>Object.assign(Error(code),{code,...extra});
export function readModelConfiguration(env=process.env){
 const apiKey=typeof env.MODEL_API_KEY==='string'?env.MODEL_API_KEY.trim():'',enabled=env.MODEL_TRADING_ENABLED==='false'?false:env.MODEL_TRADING_ENABLED==='true'||!!apiKey;
 let endpoint=null,host=null,error=null;try{const url=new URL(env.MODEL_BASE_URL??'https://api.river.ai/v1');if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error();url.pathname=url.pathname.replace(/\/$/,'')+'/chat/completions';endpoint=url.toString();host=url.host;}catch{error='MODEL_INVALID_BASE_URL';}
 return {apiKey,endpoint,host,error,enabled,explicitRulesMode:env.MODEL_TRADING_ENABLED==='false',configured:!!apiKey&&!error,name:env.MODEL_NAME??'deepseek-ai/DeepSeek-V4.1-Flash',pollMs:number(env.MODEL_POLL_MS,5000,1000,600000),timeoutMs:number(env.MODEL_TIMEOUT_MS,15000,1000,20000),maxTokens:number(env.MODEL_MAX_TOKENS,500,128,2048),maxConcurrency:number(env.MODEL_MAX_CONCURRENCY,10,1,10),maxRequestsPerMinute:number(env.MODEL_REQUESTS_PER_MINUTE,30,1,120),maxCandidates:number(env.MODEL_MAX_CANDIDATES,60,1,100)};
}
export class PaperModelClient{
 #apiKey;
 #verificationTask=null;
 constructor({env=process.env,fetcher=(...args)=>fetch(...args),clock=Date.now}={}){const c=readModelConfiguration(env);this.#apiKey=c.apiKey;delete c.apiKey;this.config=c;this.fetcher=fetcher;this.clock=clock;this.inflight=new Map();this.times=[];this.retryAt=0;this.stats={requests:0,successes:0,errors:0,http429:0,inputTokens:0,outputTokens:0};this.lastError=null;this.lastSuccessAt=null;}
 settings(){const c={...this.config,endpoint:undefined};if(this.#apiKey)for(const field of ['name','host'])if(typeof c[field]==='string'&&c[field].includes(this.#apiKey))c[field]='[REDACTED]';return c;}
 status(){return {...this.settings(),verified:this.lastSuccessAt!==null,lastSuccessAt:this.lastSuccessAt,lastError:this.lastError,verification:this.verification??{status:'idle'},retryAt:this.retryAt,activeBots:[...this.inflight.keys()].filter(id=>id!=='__api_verify__'),...this.stats};}
 verify({reuseForMs=0}={}){
  if(this.#verificationTask)return this.#verificationTask;
  const now=this.clock();if(reuseForMs>0&&!this.lastError&&this.verification?.status==='verified'&&now>=this.verification.checkedAt&&now-this.verification.checkedAt<reuseForMs)return Promise.resolve(this.status());
  this.verification={status:'verifying',requestedAt:now};
  const context={schema:'model-api-verification-v1',botId:'__api_verify__',snapshotId:'verify-'+now,asOf:now,wallet:{running:false},positions:[],candidates:[],limits:{minOrderSol:.0025,maxOrderSol:0}};
  this.#verificationTask=Promise.resolve().then(()=>this.decide('__api_verify__',context)).then(()=>{this.verification={status:'verified',requestedAt:now,checkedAt:this.clock()};return this.status();},error=>{const code=typeof error.code==='string'&&error.code.startsWith('MODEL_')?error.code:'MODEL_VERIFICATION_FAILED';this.verification={status:'error',requestedAt:now,checkedAt:this.clock(),code};this.lastError={at:this.clock(),code};throw failure(code,{retryAt:error.retryAt??null});}).finally(()=>{this.#verificationTask=null;});
  return this.#verificationTask;
 }
 cancel(botId){this.inflight.get(botId)?.abort();}
 async decide(botId,context){
  const c=this.config,now=this.clock();if(!c.enabled||!c.configured)throw failure(c.error??'MODEL_NOT_CONFIGURED');if(context.botId!==botId)throw failure('MODEL_BOT_ID_MISMATCH');
  if(now<this.retryAt)throw failure('MODEL_BACKOFF',{retryAt:this.retryAt});this.times=this.times.filter(at=>now-at<60000);
  if(this.times.length>=c.maxRequestsPerMinute)throw failure('MODEL_RATE_BUDGET',{retryAt:this.times[0]+60000});
  if(this.inflight.has(botId)||this.inflight.size>=c.maxConcurrency)throw failure('MODEL_BUSY');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),c.timeoutMs);this.inflight.set(botId,controller);this.times.push(now);this.stats.requests++;
  try{
   const response=await this.fetcher(c.endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+this.#apiKey},signal:controller.signal,body:JSON.stringify({model:c.name,messages:modelMessages(context),temperature:.2,max_tokens:c.maxTokens})});
   if(!response.ok){if(response.status===429)this.stats.http429++;const delay=response.status===429?Math.max(10000,retryAfterMs(response.headers?.get('retry-after'),this.clock())):[401,403].includes(response.status)?60000:5000;this.retryAt=Math.max(this.retryAt,this.clock()+Math.min(600000,delay));throw failure('MODEL_HTTP_'+response.status,{retryAt:this.retryAt});}
   const text=await response.text();if(text.length>65536)throw failure('MODEL_RESPONSE_TOO_LARGE');if(this.#apiKey&&text.includes(this.#apiKey))throw failure('MODEL_SENSITIVE_RESPONSE');let json,decision;
   try{json=JSON.parse(text);const content=json.choices?.[0]?.message?.content;if(typeof content!=='string'||json.choices[0].finish_reason==='length')throw Error();decision=validateModelDecision(JSON.parse(content),context);}catch(error){throw failure(error.code==='MODEL_INVALID_DECISION'?error.code:'MODEL_INVALID_RESPONSE');}
   this.stats.successes++;this.lastSuccessAt=this.clock();this.lastError=null;this.stats.inputTokens+=Number.isSafeInteger(json.usage?.prompt_tokens)?json.usage.prompt_tokens:0;this.stats.outputTokens+=Number.isSafeInteger(json.usage?.completion_tokens)?json.usage.completion_tokens:0;
   return {decision,...(context.aiOnly&&decision.action==='BUY'?{riskEvidence:{mint:decision.mint,asOf:context.asOf,mintSafety:context.candidates.find(c=>c.mint===decision.mint)?.mintSafety??{status:'unknown',facts:null},otherSecurity:context.candidates.find(c=>c.mint===decision.mint)?.otherSecurity??null}}:{}),modelName:this.settings().name,requestSnapshotId:context.snapshotId,requestedAt:now,respondedAt:this.clock(),expiresAt:context.asOf+30000};
  }catch(error){this.stats.errors++;const code=typeof error?.code==='string'&&error.code.startsWith('MODEL_')?error.code:controller.signal.aborted?'MODEL_TIMEOUT':'MODEL_NETWORK_ERROR';this.lastError={at:this.clock(),code};throw failure(code,{retryAt:error?.retryAt??null});}
  finally{clearTimeout(timer);if(this.inflight.get(botId)===controller)this.inflight.delete(botId);}
 }
}
