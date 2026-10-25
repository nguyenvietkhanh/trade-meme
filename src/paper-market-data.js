import {ProviderBudget} from './paper-provider-budget.js';
import {withRpcPriority} from './rpc-priority.js';
function freeze(x){if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.freeze(x);for(const v of Object.values(x))freeze(v);}return x;}
export class MarketData{
 constructor(market,{clock=Date.now}={}){this.market=market;this.clock=clock;this.sequence=0;this.feed={markets:[],solUsd:null,updatedAt:null,error:null};this.budget=new ProviderBudget({clock});this.prices=new Map();this.featureRevision=0;}
 setFeed(feed){this.feed=structuredClone(feed);this.sequence++;}
 snapshot(){const timestamp=this.clock(),markets=this.feed.markets.map(m=>{const p=this.prices.get(m.mint+':'+m.pairAddress),conversionFresh=this.feed.solUsd>0&&timestamp-this.feed.updatedAt>=0&&timestamp-this.feed.updatedAt<=5000,priceFresh=p&&timestamp-p.priceAt>=0&&timestamp-p.priceAt<=1500;return {...m,...p,marketObservedAt:m.updatedAt,...(conversionFresh&&priceFresh?{priceUsd:p.spotPriceSol*this.feed.solUsd,updatedAt:p.priceAt}:{})};});return freeze(structuredClone({snapshotId:this.sequence+':'+this.featureRevision+':'+[...this.prices.values()].reduce((n,p)=>Math.max(n,p.priceAt??0),0),timestamp,...this.feed,markets}));}
 async pricesFor(markets){if(!markets.length)return;const rows=await withRpcPriority('exit',()=>this.budget.read('prices:'+markets.map(m=>m.mint+':'+m.pairAddress).sort().join(','),()=>this.market.readPoolPrices(markets),{ttlMs:500,provider:'pool-rpc'}));for(const r of rows)this.prices.set(r.mint+':'+r.pairAddress,r);}
 async execute(input,m){
  const emergency=input.reason==='emergency-risk',slippageBps=emergency?1000:input.side==='BUY'?400:300,key=[m.mint,m.pairAddress,input.side,input.amount,slippageBps,input.minObservedAt].join(':');
  const result=await this.budget.read(key,async()=>{
   try{
    const quote=await withRpcPriority(input.side==='SELL'?'exit':'interactive',()=>this.market.quote({...input,slippageBps}));
    const decimals=await this.market.readDecimals(m.mint);let loss=null;
    if(input.side==='BUY'){const reverse=await withRpcPriority('interactive',()=>this.market.quote({mint:m.mint,side:'SELL',amount:quote.outAmount,slippageBps:300,minObservedAt:input.minObservedAt}));loss=Math.max(0,1-(Number(reverse.outAmount)-50000)/Number(input.amount))*100;}
    return {quote,decimals,roundTripLossPct:loss,quoteSource:'quote',observedNow:this.clock()};
   }catch(error){this.budget.stats.modelFallbacks++;const result=await withRpcPriority(input.side==='SELL'?'exit':'background',()=>this.market.modelQuote(input,m));return {...result,fallbackReason:/429/.test(error.message)?'HTTP_429':error.code??'QUOTE_UNAVAILABLE'};}
  },{ttlMs:500,provider:'execution'});this.onExecution?.({input,market:m,result});return result;
 }
 status(){return {...this.budget.stats,jupiter:this.market.providerStats?.()??null,pricePools:this.prices.size,warning:'Shared API budgets can delay freshness; cached data retain their source timestamps.'};}
}
