import {PublicKey} from '@solana/web3.js';
import {SolanaExecution} from './solana.js';
import {paperMarketQuote} from './sell-quote.js';
import {paperOrderSol} from './paper-sizing.js';
import {UiActivity} from './ui-activity.js';
import {createSwapFlowReader} from './paper-swap-flow.js';
import {PaperPoolReader} from './paper-amm-model.js';
/** Capability boundary: only these read methods enter the paper engine. No prepare/send/sign. */
export function createPaperMarket(cash,execution=new SolanaExecution(),{includeCurves=false}={}){
 const activity=new UiActivity(),readFlow=createSwapFlowReader(execution.rpc,{rolling:true}),pools=new PaperPoolReader(execution.rpc,{bootstrapIntervalMs:includeCurves?5000:0}),decimals=new Map();
 return Object.freeze({get activity(){return activity.snapshot();},rpcMode:execution.rpcMode,heliusConfigured:execution.heliusConfigured,provider:execution.provider,
  readStrategyFlow:market=>activity.track('flow',market.mint,()=>readFlow(market)),
  readPoolPrices:async markets=>{const curves=includeCurves?markets.filter(m=>m.dexId==='pumpfun'||m.executionVenue==='pumpfun'):[],direct=await pools.refresh(markets.filter(m=>!curves.includes(m)));if(!curves.length)return direct;const read=await execution.curveMarketData(curves.map(m=>m.mint),1);const rows=read.map(m=>({mint:m.mint,pairAddress:m.pairAddress,spotPriceSol:m.priceUsd,priceAt:m.updatedAt,priceSource:'RPC bonding curve reserves'}));for(const c of curves.filter(c=>!read.some(r=>r.mint===c.mint)))try{const route=await execution.curveRoute(c.mint,'SELL',c.pairAddress);if(route.venue==='pumpswap'){const prices=await pools.refresh([{...c,dexId:'pumpswap',pairAddress:route.poolAddress}]);for(const price of prices)rows.push({...price,pairAddress:c.pairAddress,priceSource:'RPC migrated PumpSwap reserves'});}}catch{}return [...direct,...rows];},
  modelQuote:(input,m)=>pools.quote(input,m),
  providerStats:()=>execution.quoteFetch.diagnostics?.()??{},
  readDecimals:async mint=>{const old=decimals.get(mint);if(old&&Date.now()-old.at<600000)return old.value;const value=(await execution.rpc.getTokenSupply(new PublicKey(mint),'confirmed')).value.decimals;if(!Number.isInteger(value)||value<0||value>18)throw Error('Missing token decimals');decimals.delete(mint);decimals.set(mint,{at:Date.now(),value});while(decimals.size>256)decimals.delete(decimals.keys().next().value);return value;},
  inspectLabExecution:market=>activity.track('roundtrip',market.mint,async()=>{const amount=paperOrderSol(cash());if(!amount)throw Error('Insufficient virtual cash');const supply=await execution.rpc.getTokenSupply(new PublicKey(market.mint),'confirmed');const decimals=supply.value?.decimals;if(!Number.isInteger(decimals)||decimals<0||decimals>18)throw Error('Missing decimals');const factsAt=Date.now(),q=await execution.roundTripQuote(market.mint,String(Math.round(amount*1e9)));return {...q,mint:market.mint,pairAddress:market.pairAddress,decimals,checkedAt:factsAt,certificationMode:'bypassed-paper'};}),
  inspectMarketFacts:market=>activity.track('facts',market.mint,()=>execution.inspectMarketFacts(market)),
  get currentProbeSol(){return paperOrderSol(cash());},
  inspectMarketQuote:market=>{const size=paperOrderSol(cash());if(!size)throw Error('Không đủ SOL mô phỏng sau dự phòng.');return activity.track('roundtrip',market.mint,()=>execution.roundTripQuote(market.mint,String(Math.round(size*1e9))));},
  quote:input=>activity.track(input.side,input.mint,async()=>{const q=await paperMarketQuote(input,execution.quoteFetch),slot=await execution.rpc.getSlot('confirmed');if(Math.abs(q.contextSlot-slot)>20)throw Error('RPC quote slot đã cũ.');return q;})
 });
}
