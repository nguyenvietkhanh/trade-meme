import {Connection} from '@solana/web3.js';

export const PUBLIC_RPC_ENDPOINTS=Object.freeze(['https://api.mainnet-beta.solana.com','https://solana-rpc.publicnode.com']);
const GENESIS='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const WRITES=new Set(['sendTransaction','requestAirdrop']);

// Fail over reads only. An uncertain broadcast must be reconciled, never retried on another RPC.
export function keylessConnection(endpoints=PUBLIC_RPC_ENDPOINTS){
 if(!endpoints.length||endpoints.some(url=>new URL(url).protocol!=='https:'))throw Error('RPC cần HTTPS.');
 let active=0;const verified=new Map();
 const request=(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(10000)});
 const check=async url=>{
  if(Date.now()-(verified.get(url)??0)<60000)return;
  const res=await request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'network-check',method:'getGenesisHash',params:[]})});
  if(!res.ok||(await res.json()).result!==GENESIS)throw Error('RPC mainnet chưa khả dụng.');
  verified.set(url,Date.now());
 };
 const transport=async(_url,options)=>{
  const message=JSON.parse(options.body),write=WRITES.has(message.method),tries=write?1:endpoints.length,start=active;
  for(let n=0;n<tries;n++){
   const index=(start+n)%endpoints.length,url=endpoints[index];
   try{
    await check(url);const response=await request(url,options);
    if(!response.ok)throw Error('RPC từ chối yêu cầu.');
    const data=await response.clone().json();
    if([-32005,-32429,-32004].includes(data.error?.code)||data.error?.code===429)throw Error('RPC quá tải.');
    active=index;return response;
   }catch{verified.delete(url);if(write)throw Error('Chưa rõ kết quả gửi giao dịch. Giữ signature để đối soát.');}
  }
  throw Error('Các RPC công khai đang lỗi hoặc giới hạn lượt gọi. Không cần API key; thử kết nối lại sau.');
 };
 return new Connection(endpoints[0],{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:transport});
}
