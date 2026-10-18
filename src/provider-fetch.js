export function retryAfterMs(value,now=Date.now()){
 if(value==null||String(value).trim()==='')return 0;
 const seconds=Number(value);return Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(value)-now)||0;
}

// Public read providers only: no cached prices, no automatic replay and no credential-bearing diagnostics.
export function backoffFetch(fetcher=(...args)=>globalThis.fetch(...args),{provider='API',clock=Date.now,random=Math.random,minBackoffMs=5000}={}){
 let failures=0,retryAt=0,lastStatus=null,epoch=0;const pending=new Map();
 const blocked=()=>Object.assign(Error(`${provider}${lastStatus?' HTTP '+lastStatus:''}: tạm chờ dịch vụ hồi phục, chưa có dữ liệu mới.`),{code:'PROVIDER_BACKOFF',retryAt,status:lastStatus});
 const fail=(status,header)=>{epoch++;failures++;lastStatus=status;const base=Math.min(60000,minBackoffMs*2**Math.min(failures-1,4)),delay=Math.max(status===403?30000:0,retryAfterMs(header,clock()),Math.min(60000,base*(1+Math.max(0,Math.min(1,random()))*.2)));retryAt=clock()+Math.min(600000,Math.ceil(delay));};
 const run=async(url,options)=>{
  if(clock()<retryAt)throw blocked();
  const startedEpoch=epoch;let response;try{response=await fetcher(url,options);}catch(error){fail(null,null);throw error;}
  if([403,408,429,500,502,503,504].includes(response.status))fail(response.status,response.headers.get('retry-after'));
  else if(epoch===startedEpoch){failures=0;retryAt=0;lastStatus=null;}
  return response;
 };
 const fetchWithBackoff=async(url,options={})=>{
  if(String(options.method??'GET').toUpperCase()!=='GET')return run(url,options);
  const key=String(url)+':'+JSON.stringify(options.headers??{});
  let task=pending.get(key);if(!task){task=run(url,options);pending.set(key,task);}
  try{return (await task).clone();}finally{if(pending.get(key)===task)pending.delete(key);}
 };
 fetchWithBackoff.diagnostics=()=>({provider,failures,retryAt,status:lastStatus});return fetchWithBackoff;
}
