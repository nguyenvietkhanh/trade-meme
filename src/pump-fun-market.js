import {backoffFetch} from './provider-fetch.js';
const ORIGIN='https://frontend-api-v3.pump.fun',MINT=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const number=v=>v!=null&&Number.isFinite(Number(v))?Number(v):null;
export function curveActivity(rows,mint,now=Date.now(),limit=200){
 if(!Array.isArray(rows)||rows.some(t=>t.mint!==mint||typeof t.signature!=='string'||!t.signature||t.signature.length>128||!Number.isSafeInteger(number(t.slot))||number(t.slot)<0||typeof t.is_buy!=='boolean'||!MINT.test(t.user)||!Number.isSafeInteger(number(t.sol_amount))||number(t.sol_amount)<=0||!Number.isSafeInteger(number(t.token_amount))||number(t.token_amount)<=0||!Number.isSafeInteger(number(t.timestamp))||number(t.timestamp)*1000>now))throw Error('Lịch sử pump.fun thiếu dữ liệu giao dịch thực.');
 const unique=new Map(rows.map(t=>[t.signature+':'+(t.tx_index??'')+':'+t.user+':'+t.is_buy,{...t,slot:Number(t.slot),at:Number(t.timestamp)*1000,priceSol:Number(t.sol_amount)/1e9/(Number(t.token_amount)/1e6)}]));
 const all=[...unique.values()].sort((a,b)=>a.at-b.at),historyComplete=rows.length<limit||all[0]?.at<=now-300000;
 const window=ms=>all.filter(t=>t.at>=now-ms),m1=window(60000),m5=window(300000),h1=window(3600000),volume=a=>a.reduce((n,t)=>n+Number(t.sol_amount)/1e9,0),buys=a=>a.filter(t=>t.is_buy).length;
 const anchor=ms=>[...all].reverse().find(t=>t.at<=now-ms)??all[0];
 const change=ms=>{const a=anchor(ms),last=all.at(-1);return a&&last&&a.priceSol>0?(last.priceSol/a.priceSol-1)*100:null;};
 return {historyComplete,activityCheckedAt:now,buys1m:buys(m1),sells1m:m1.length-buys(m1),buys5m:buys(m5),sells5m:m5.length-buys(m5),buys1h:buys(h1),sells1h:h1.length-buys(h1),volume1mSol:volume(m1),volume5mSol:volume(m5),volume1hSol:volume(h1),change1mPct:change(60000),change5mPct:change(300000),change1hPct:change(3600000),uniqueBuyers5m:new Set(m5.filter(t=>t.is_buy).map(t=>t.user)).size,lastTradeAt:all.at(-1)?.at??null,trades:all};
}
export class PumpFunMarkets{
 constructor(execution,fetcher=globalThis.fetch){this.execution=execution;this.fetcher=backoffFetch(fetcher,{provider:'pump.fun'});this.coins=new Map();this.activities=new Map();this.prices=new Map();this.lastDiscoveryAt=0;this.lastTrades=new Map();this.cursor=0;}
 async json(url){const r=await this.fetcher(url,{signal:AbortSignal.timeout(2500)});if(!r.ok)throw Error('pump.fun HTTP '+r.status);return r.json();}
 async activity(mint){
  const rows=[];let requested=0;for(let offset=0;offset<1000;offset+=200){const page=await this.json(ORIGIN+'/trades/all/'+mint+'?limit=200&offset='+offset+'&minimumSize=0');if(!Array.isArray(page))throw Error('Lịch sử curve không hợp lệ.');requested+=200;rows.push(...page);if(page.length<200||Math.min(...page.map(t=>Number(t.timestamp)*1000))<=Date.now()-300000)break;}
  return curveActivity(rows,mint,Date.now(),requested);
 }
 cachedMarkets(solUsd,tracked=[]){
  if(!this.job)this.job=this.markets(solUsd,tracked).then(value=>{this.latest=value;}).catch(()=>{this.latest={markets:[],warnings:['Nguồn curve chưa lấy được dữ liệu mới; PumpSwap vẫn hoạt động.']};}).finally(()=>{this.job=null;});
  return this.latest?{...this.latest,markets:this.latest.markets.filter(m=>Date.now()-m.updatedAt<=30000)}:{markets:[],warnings:['Đang kết nối nguồn pump.fun trước migrate.']};
 }
 async markets(solUsd,tracked=[]){
  const warnings=[],now=Date.now();
  if(now-this.lastDiscoveryAt>=30000){this.lastDiscoveryAt=now;try{const rows=await this.json(ORIGIN+'/coins?offset=0&limit=50&sort=last_trade_timestamp&order=DESC&includeNsfw=false');if(!Array.isArray(rows))throw Error('Không có danh sách pump.fun.');for(const c of rows)if(MINT.test(c.mint)&&c.complete===false)this.coins.set(c.mint,c);for(const mint of [...this.coins.keys()].slice(0,Math.max(0,this.coins.size-300)))this.coins.delete(mint);}catch{warnings.push('Nguồn pump.fun trước migrate chưa khả dụng; không dựng dữ liệu thay thế.');}}
  for(const mint of this.prices.keys())if(!this.coins.has(mint)){this.prices.delete(mint);this.activities.delete(mint);this.lastTrades.delete(mint);}
  const mints=[...this.coins.keys()];if(!mints.length)return {markets:[],warnings};
  const chosen=[...new Set([...tracked.filter(m=>this.coins.has(m)),...Array.from({length:Math.min(6,mints.length)},(_,i)=>mints[(this.cursor+i)%mints.length])])].slice(0,8);this.cursor=(this.cursor+6)%mints.length;
  const slots=await this.execution.curveMarketData(chosen,solUsd);
  for(const state of slots){const c=this.coins.get(state.mint);this.prices.set(state.mint,{...state,symbol:String(c.symbol??'?').slice(0,60),name:String(c.name??'').slice(0,120),pairCreatedAt:number(c.created_timestamp)>1e12?number(c.created_timestamp):number(c.created_timestamp)>1e9?number(c.created_timestamp)*1000:null,hasProfile:!!(c.website||c.twitter||c.telegram),boosted:false});}
  const targets=slots.filter(m=>m.liquidityQuoteSol>=20&&m.valuationUsd>=3000&&m.valuationUsd<=5000000).sort((a,b)=>(this.lastTrades.get(a.mint)??0)-(this.lastTrades.get(b.mint)??0)).slice(0,2);
  await Promise.all(targets.map(async m=>{if(now-(this.lastTrades.get(m.mint)??0)<10000)return;this.lastTrades.set(m.mint,now);try{this.activities.set(m.mint,await this.activity(m.mint));}catch{warnings.push('Chưa lấy được lịch sử giao dịch pump.fun cho một ứng viên; chưa xét BUY.');}}));
  const markets=[];
  for(const [mint,price]of this.prices){const a=this.activities.get(mint);if(now-price.updatedAt>30000||!a||now-a.activityCheckedAt>30000)continue;const creatorTrades=a.trades.filter(t=>t.user===price.creatorAddress),firstSlot=new Map();for(const t of a.trades.filter(t=>t.is_buy&&Number.isSafeInteger(t.slot))){const k=t.slot;firstSlot.set(k,(firstSlot.get(k)??[]).concat(t));}const suspectedBundle=[...firstSlot.values()].some(g=>new Set(g.map(t=>t.user)).size>=3&&g.reduce((n,t)=>n+Number(t.token_amount),0)>price.tokenSupplyRaw*.05);
   const {trades,...activity}=a;markets.push({...price,...activity,updatedAt:Math.min(price.updatedAt,a.activityCheckedAt),activityLastPriceSol:trades.at(-1)?.priceSol??null,creatorSoldRecently:creatorTrades.some(t=>!t.is_buy&&t.at>=now-300000),suspectedBundle,volume1mUsd:a.volume1mSol*solUsd,volume5mUsd:a.volume5mSol*solUsd,volume1hUsd:a.volume1hSol*solUsd,volume24hUsd:null});
  }
  return {markets,warnings};
 }
}
