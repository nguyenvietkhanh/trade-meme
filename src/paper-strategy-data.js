import {backoffFetch} from './provider-fetch.js';
import {withRpcPriority} from './rpc-priority.js';
import {validMinuteBars} from './paper-ten-strategies.js';

export class StrategyDataFeed{
 constructor(market,{selectTargets=(rows)=>rows,fetcher=(...args)=>fetch(...args),clock=Date.now}={}){this.market=market;this.select=selectTargets;this.clock=clock;this.fetcher=backoffFetch(fetcher,{provider:'M1 OHLCV',clock,minBackoffMs:30000});this.cache=new Map();this.jobs=new Map();this.cursor=0;this.nextCandleAt=0;}
 applyCached(markets){return markets.map(m=>{const key=m.mint+':'+m.pairAddress,c=this.cache.get(key);return {...m,strategyData:{mint:m.mint,pairAddress:m.pairAddress,...(c?.candles??{}),...(c?.flow?{flow:c.flow}:{}),status:c?.status??{candles:'missing',flow:'missing'}}};});}
 async enrichCached(markets,now=this.clock()){
  const targets=this.select(this.applyCached(markets),now,this.cursor);let candles=false,flow=false;
  for(const m of targets){const key=m.mint+':'+m.pairAddress,c=this.cache.get(key)??{status:{}},minute=Math.floor(now/60000)*60000;this.cache.set(key,c);
   if(['orin','vela','kade','rune','nyx','sage'].includes(m.labQuoteAgentId)&&!candles&&now>=this.nextCandleAt&&!this.jobs.has('candles:'+key)&&![...this.jobs.keys()].some(k=>k.startsWith('candles:'))&&(c.candleMinute!==minute||!c.candles)&&now-(c.candleAttemptAt??-Infinity)>=10000){
    candles=true;c.candleAttemptAt=now;this.nextCandleAt=now+2000;const u=new URL('https://api.geckoterminal.com/api/v2/networks/solana/pools/'+encodeURIComponent(m.pairAddress)+'/ohlcv/minute');for(const [k,v]of Object.entries({aggregate:1,limit:35,currency:'usd',token:'base'}))u.searchParams.set(k,v);
    const job=Promise.resolve().then(()=>this.fetcher(u,{signal:AbortSignal.timeout(4000)})).then(async r=>{if(!r.ok)throw Error('OHLCV HTTP '+r.status);const json=await r.json();if(json.meta?.base?.address!==m.mint||!Array.isArray(json.data?.attributes?.ohlcv_list))throw Error('OHLCV mint mismatch');c.candles={bars:json.data.attributes.ohlcv_list,candleFetchedAt:now,candleProvider:'GeckoTerminal'};const valid=validMinuteBars({mint:m.mint,pairAddress:m.pairAddress,...c.candles},m,now);c.candleMinute=valid?minute:minute-60000;c.status.candles=valid?'observed':'partial';}).catch(()=>{c.status.candles='unavailable';}).finally(()=>this.jobs.delete('candles:'+key));this.jobs.set('candles:'+key,job);
   }
   const needFlow=['nova','echo'].includes(m.labQuoteAgentId);
   if(needFlow&&!flow&&!this.jobs.has('flow:'+key)&&![...this.jobs.keys()].some(k=>k.startsWith('flow:'))&&now-(c.flowAttemptAt??-Infinity)>=3000&&typeof this.market.readStrategyFlow==='function'){
    flow=true;c.flowAttemptAt=now;const job=Promise.resolve().then(()=>withRpcPriority('research',()=>this.market.readStrategyFlow(m))).then(value=>{if(value.mint!==m.mint||value.pairAddress!==m.pairAddress)throw Error('Flow identity mismatch');c.flow=value;c.status.flow=value.windowComplete?'complete':'partial';}).catch(()=>{c.status.flow='unavailable';}).finally(()=>this.jobs.delete('flow:'+key));this.jobs.set('flow:'+key,job);
   }
   if(candles&&flow)break;
  }
  this.cursor=(this.cursor+1)%10;for(const [key,c]of this.cache)if(now-Math.max(c.candleAttemptAt??0,c.flowAttemptAt??0)>600000)this.cache.delete(key);while(this.cache.size>100)this.cache.delete(this.cache.keys().next().value);return this.applyCached(markets);
 }
 status(){const counts={};for(const c of this.cache.values())for(const [kind,state]of Object.entries(c.status))counts[kind+':'+state]=(counts[kind+':'+state]??0)+1;return {jobs:[...this.jobs.keys()],provider:this.fetcher.diagnostics(),cachedPools:this.cache.size,counts,source:'Real closed M1 bars and confirmed PumpSwap events; no synthetic candles or wallet counts'};}
}
