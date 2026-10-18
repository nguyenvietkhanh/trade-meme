import {Connection} from '@solana/web3.js';
import {retryAfterMs} from './provider-fetch.js';

export const PUBLIC_RPC_ENDPOINTS=Object.freeze(['https://api.mainnet-beta.solana.com','https://solana-rpc.publicnode.com']);
// Full 32-byte genesis hash; the 32-character CAIP chain identifier is NOT a genesis hash.
export const MAINNET_GENESIS_HASH='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
class RpcFailure extends Error{constructor(message,extra={}){super(message);Object.assign(this,extra);}}
const WRITES=new Set(['sendTransaction','requestAirdrop']);

// Reads may fail over/coalesce. Signed broadcasts are never replayed or coalesced.
export function keylessConnection(endpoints=PUBLIC_RPC_ENDPOINTS,{clock=Date.now,random=Math.random}={}){
 if(!endpoints.length||endpoints.some(url=>new URL(url).protocol!=='https:'))throw Error('RPC cần HTTPS.');
 let active=0,lastFailures=[];const verified=new Map(),checking=new Map(),pending=new Map(),methods=new Map();
 const health=endpoints.map(()=>({failures:0,retryAt:0,epoch:0}));
 const request=(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(10000)});
 const httpError=response=>new RpcFailure('HTTP '+response.status,{status:response.status,retryAfter:retryAfterMs(response.headers.get('retry-after'),clock())});
 const check=async url=>{
  if(verified.has(url)&&clock()-verified.get(url)<60000)return;
  if(checking.has(url))return checking.get(url);
  const task=(async()=>{
   const res=await request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'network-check',method:'getGenesisHash',params:[]})});
   if(!res.ok)throw httpError(res);
   const data=await res.json();if(data.result!==MAINNET_GENESIS_HASH)throw new RpcFailure(data.error?'RPC '+String(data.error.code):'Genesis không đúng Solana mainnet',{wrongChain:!data.error});
   verified.set(url,clock());
  })();checking.set(url,task);
  try{await task;}finally{if(checking.get(url)===task)checking.delete(url);}
 };
 const run=async(message,options)=>{
  const write=WRITES.has(message.method),tries=write?1:endpoints.length,start=active,failures=[];
  for(let n=0;n<tries;n++){
   const index=(start+n)%endpoints.length,url=endpoints[index],h=health[index],methodKey=index+':'+message.method;
   try{
    if(h.retryAt>clock())throw new RpcFailure('RPC tạm chờ hồi phục',{waiting:true});
    if(!write&&(methods.get(methodKey)??0)>clock())throw new RpcFailure('RPC tạm không hỗ trợ phương thức này',{waiting:true});
    const startedEpoch=h.epoch;await check(url);
    if(message.method==='getGenesisHash'){active=index;lastFailures=[];if(h.epoch===startedEpoch){h.failures=0;h.retryAt=0;}return {jsonrpc:'2.0',id:message.id,result:MAINNET_GENESIS_HASH};}
    const response=await request(url,options);if(!response.ok)throw httpError(response);
    const data=await response.json();if(!data||typeof data!=='object'||Array.isArray(data)||data.jsonrpc!=='2.0'||String(data.id)!==String(message.id))throw new RpcFailure('RPC trả phản hồi không khớp yêu cầu');
    if(!write&&[-32010,-32601].includes(data.error?.code))throw new RpcFailure('RPC không hỗ trợ truy vấn/chỉ mục ('+data.error.code+')',{unsupported:true});
    if([-32005,-32429,-32004,429].includes(data.error?.code))throw new RpcFailure('RPC quá tải ('+data.error.code+')');
    active=index;lastFailures=[];if(h.epoch===startedEpoch){h.failures=0;h.retryAt=0;}methods.delete(methodKey);return data;
   }catch(e){
    if(!e.waiting){
     if(e.unsupported)methods.set(methodKey,clock()+60000);
     else{h.epoch++;h.failures++;const delay=Math.max(e.wrongChain?300000:e.status===403?30000:0,e.retryAfter??0,Math.min(60000,5000*2**Math.min(h.failures-1,4)*(1+Math.max(0,Math.min(1,random()))*.2)));h.retryAt=clock()+Math.min(600000,Math.ceil(delay));}
     if(e.wrongChain)verified.delete(url);
    }
    failures.push({host:new URL(url).hostname,reason:e instanceof RpcFailure?e.message:e.name==='TimeoutError'?'Hết thời gian chờ':'Không kết nối được HTTPS'});lastFailures=failures;
    if(write)throw Error('Chưa rõ kết quả gửi giao dịch. Giữ signature để đối soát.');
   }
  }
  throw Error('Các RPC công khai đang lỗi hoặc giới hạn lượt gọi. Không cần API key; thử kết nối lại sau.');
 };
 const transport=async(_url,options)=>{
  const message=JSON.parse(options.body);let data;
  if(WRITES.has(message.method))data=await run(message,options);
  else{
   const key=message.method+':'+JSON.stringify(message.params??[]);let task=pending.get(key);
   if(!task){task=run(message,options);pending.set(key,task);}
   try{data=await task;}finally{if(pending.get(key)===task)pending.delete(key);}
  }
  // Each coalesced caller keeps its own JSON-RPC id and response body.
  return new Response(JSON.stringify({...data,id:message.id}),{status:200,headers:{'Content-Type':'application/json'}});
 };
 const connection=new Connection(endpoints[0],{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:transport});
 connection.rpcDiagnostics=()=>({activeHost:new URL(endpoints[active]).hostname,failures:lastFailures.map(row=>({...row})),cooldowns:health.flatMap((h,i)=>h.retryAt>clock()?[{host:new URL(endpoints[i]).hostname,retryAt:h.retryAt}]:[])});
 return connection;
}
