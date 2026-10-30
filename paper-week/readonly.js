import path from 'node:path';
import {PublicKey} from '@solana/web3.js';
import {PUMP_AMM_SDK,PUMP_AMM_PROGRAM_ID} from '@pump-fun/pump-swap-sdk';
import {SolanaExecution} from '../src/solana.js';
import {RulesEvidence} from '../src/rules-evidence.js';
import {paperMarketQuote} from '../src/sell-quote.js';
import {withRpcPriority} from '../src/rpc-priority.js';
import {projectRulesConfig} from '../src/project-risk.js';
const SOL='So11111111111111111111111111111111111111112';
const TOKENS=new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']);
export function readOnlyRpc(rpc){return new Proxy(Object.create(null),{get(_target,key){if(key==='commitment')return 'confirmed';if(typeof key!=='string'||!(/^(get[A-Z]|rpcDiagnostics$)/.test(key)))throw Error('PAPER_RPC_READ_ONLY');const fn=rpc[key];if(typeof fn!=='function')throw Error('PAPER_RPC_METHOD_UNAVAILABLE');return fn.bind(rpc);}});}
export function createPaperAdapter(dir,{env=process.env,policy=projectRulesConfig({})}={}){
 const raw=new SolanaExecution();raw.rpc=readOnlyRpc(raw.rpc);
 const execution=Object.freeze({rpc:raw.rpc,curveMarketData:(...a)=>raw.curveMarketData(...a),inspectCurveMarket:(m)=>raw.inspectCurveMarket(m,undefined,{includeQuote:false}),inspectMarketFacts:m=>raw.inspectMarketFacts(m)});
 const facts=new RulesEvidence({execution,policy,walletsFile:path.resolve(env.PAPER_WEEK_WALLETS_FILE??path.join(dir,'wallets.txt'))});
 // The public owner address may be used by SDK readers; no account secret is read.
 async function poolPrice(m,poolAddress){const account=await raw.rpc.getAccountInfo(new PublicKey(poolAddress),'confirmed');if(!account?.owner.equals(PUMP_AMM_PROGRAM_ID))throw Error('PAPER_POOL_OWNER_UNVERIFIED');const p=PUMP_AMM_SDK.decodePool(account),mints=[p.baseMint.toBase58(),p.quoteMint.toBase58()];if(!mints.includes(m.mint)||!mints.includes(SOL))throw Error('PAPER_POOL_MINT_MISMATCH');const accounts=await raw.rpc.getMultipleAccountsInfo([p.poolBaseTokenAccount,p.poolQuoteTokenAccount],'confirmed');const amounts=accounts.map((a,i)=>{if(!a||!TOKENS.has(a.owner.toBase58())||a.data.length<165||new PublicKey(a.data.subarray(0,32)).toBase58()!==mints[i])throw Error('PAPER_RESERVE_UNVERIFIED');return Number(a.data.readBigUInt64LE(64));});const decimals=(await raw.rpc.getTokenSupply(new PublicKey(m.mint),'confirmed')).value.decimals,tokenIndex=mints.indexOf(m.mint),quoteIndex=mints.indexOf(SOL);return amounts[tokenIndex]>0?amounts[quoteIndex]/1e9/(amounts[tokenIndex]/10**decimals):null;}
 return Object.freeze({execution,
  evidence:m=>facts.read({mint:m.mint,pool:m.pairAddress,solUsd:m.solUsd,rawMarket:m}),
  async quote(order,m){return withRpcPriority(order.side==='SELL'?'exit':'background',async()=>{let q;if(m.dexId==='pumpfun'&&!m.migratedPool){const rows=await raw.paperCurveQuotes([{id:order.id,mint:m.mint,poolAddress:m.pairAddress,side:order.side,amount:order.amount,reason:order.reason}]);q=rows[0];if(q&&!q.failed)q={...q,minOut:(BigInt(q.outAmount)*BigInt(order.side==='BUY'?9600:9700)/10000n).toString()};}else q=await paperMarketQuote({mint:m.mint,side:order.side,amount:order.amount,slippageBps:order.side==='BUY'?400:300,minObservedAt:order.readyAt},raw.quoteFetch);
   if(q?.failed)throw Error('PAPER_QUOTE_UNAVAILABLE');const decimals=(await raw.rpc.getTokenSupply(new PublicKey(m.mint),'confirmed')).value.decimals;
   return {out:q.minOut??q.outAmount,at:q.checkedAt,decimals,roundTripLossPct:q.roundTripLossPct??null,impactPct:q.impactPct??null,source:m.dexId==='pumpfun'&&!m.migratedPool?'pump-sdk-read-only':'jupiter-quote-only',slippageAssumptionBps:order.side==='BUY'?400:300};});},
  async refreshHeld(positions,markets,solUsd){const out=[];for(const p of positions){let m=markets.find(m=>m.mint===p.mint&&m.pairAddress===p.pool)??{mint:p.mint,pairAddress:p.pool,dexId:'pumpfun',symbol:p.symbol,solUsd};try{if(m.dexId==='pumpfun'){const route=await raw.curveRoute(p.mint,'SELL',p.pool);if(route.venue==='pumpfun'){const curves=await raw.curveMarketData([p.mint],solUsd);if(!curves[0])continue;m={...m,...curves[0],spotPriceSol:curves[0].priceUsd/solUsd,priceAt:curves[0].updatedAt};}else{const price=await poolPrice(m,route.poolAddress);m={...m,spotPriceSol:price,priceAt:Date.now(),migratedPool:route.poolAddress};}}else m={...m,spotPriceSol:await poolPrice(m,m.pairAddress),priceAt:Date.now()};out.push(m);}catch{/* Missing marks remain unavailable; never synthesize an exit. */}}return out;},
  status:()=>({mode:'read-only',heliusConfigured:raw.heliusConfigured,rpcMode:raw.rpcMode,research:facts.projectResearch?.status()??null})
 });
}
