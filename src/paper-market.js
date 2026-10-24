import {PublicKey} from '@solana/web3.js';
import {SolanaExecution} from './solana.js';
import {paperMarketQuote} from './sell-quote.js';
import {paperOrderSol} from './paper-sizing.js';
import {UiActivity} from './ui-activity.js';
import {createSwapFlowReader} from './paper-swap-flow.js';
/** Capability boundary: only these read methods enter the paper engine. No prepare/send/sign. */
export function createPaperMarket(cash,execution=new SolanaExecution()){
 const activity=new UiActivity(),readFlow=createSwapFlowReader(execution.rpc);
 return Object.freeze({get activity(){return activity.snapshot();},rpcMode:execution.rpcMode,heliusConfigured:execution.heliusConfigured,provider:execution.provider,
  readStrategyFlow:market=>activity.track('flow',market.mint,()=>readFlow(market)),
  inspectLabExecution:market=>activity.track('roundtrip',market.mint,async()=>{const amount=paperOrderSol(cash());if(!amount)throw Error('Insufficient virtual cash');const supply=await execution.rpc.getTokenSupply(new PublicKey(market.mint),'confirmed');const decimals=supply.value?.decimals;if(!Number.isInteger(decimals)||decimals<0||decimals>18)throw Error('Missing decimals');const factsAt=Date.now(),q=await execution.roundTripQuote(market.mint,String(Math.round(amount*1e9)));return {...q,mint:market.mint,pairAddress:market.pairAddress,decimals,checkedAt:factsAt,certificationMode:'bypassed-paper'};}),
  inspectMarketFacts:market=>activity.track('facts',market.mint,()=>execution.inspectMarketFacts(market)),
  get currentProbeSol(){return paperOrderSol(cash());},
  inspectMarketQuote:market=>{const size=paperOrderSol(cash());if(!size)throw Error('Không đủ SOL mô phỏng sau dự phòng.');return activity.track('roundtrip',market.mint,()=>execution.roundTripQuote(market.mint,String(Math.round(size*1e9))));},
  quote:input=>activity.track(input.side,input.mint,async()=>{const q=await paperMarketQuote(input,execution.quoteFetch),slot=await execution.rpc.getSlot('confirmed');if(Math.abs(q.contextSlot-slot)>20)throw Error('RPC quote slot đã cũ.');return q;})
 });
}
