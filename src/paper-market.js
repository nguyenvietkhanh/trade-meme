import {SolanaExecution} from './solana.js';
import {paperMarketQuote} from './sell-quote.js';
import {paperOrderSol} from './paper-sizing.js';
import {UiActivity} from './ui-activity.js';
/** Capability boundary: only these read methods enter the paper engine. No prepare/send/sign. */
export function createPaperMarket(cash,execution=new SolanaExecution()){
 const activity=new UiActivity();
 return Object.freeze({get activity(){return activity.snapshot();},rpcMode:execution.rpcMode,heliusConfigured:execution.heliusConfigured,provider:execution.provider,
  inspectMarketFacts:market=>activity.track('facts',market.mint,()=>execution.inspectMarketFacts(market)),
  get currentProbeSol(){return paperOrderSol(cash());},
  inspectMarketQuote:market=>{const size=paperOrderSol(cash());if(!size)throw Error('Không đủ SOL mô phỏng sau dự phòng.');return activity.track('roundtrip',market.mint,()=>execution.roundTripQuote(market.mint,String(Math.round(size*1e9))));},
  quote:input=>activity.track(input.side,input.mint,async()=>{const q=await paperMarketQuote(input,execution.quoteFetch),slot=await execution.rpc.getSlot('confirmed');if(Math.abs(q.contextSlot-slot)>20)throw Error('RPC quote slot đã cũ.');return q;})
 });
}
