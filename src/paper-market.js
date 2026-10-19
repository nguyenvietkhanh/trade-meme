import {SolanaExecution} from './solana.js';
import {paperMarketQuote} from './sell-quote.js';
import {walletOrderSol} from './desk-rules.js';
/** Capability boundary: only these read methods enter the paper engine. No prepare/send/sign. */
export function createPaperMarket(cash,execution=new SolanaExecution()){
 return Object.freeze({rpcMode:execution.rpcMode,heliusConfigured:execution.heliusConfigured,provider:execution.provider,
  inspectMarketFacts:market=>execution.inspectMarketFacts(market),
  inspectMarketQuote:market=>{const size=walletOrderSol(cash());if(!size)throw Error('Không đủ SOL mô phỏng sau dự phòng.');return execution.roundTripQuote(market.mint,String(Math.round(size*1e9)));},
  quote:async input=>{const q=await paperMarketQuote(input,execution.quoteFetch),slot=await execution.rpc.getSlot('confirmed');if(Math.abs(q.contextSlot-slot)>20)throw Error('RPC quote slot đã cũ.');return q;}
 });
}
