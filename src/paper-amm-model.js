import {ReadRejectionCache} from './read-rejection-cache.js';
import {pumpAmmClient} from './pump-amm-client.js';
import {PublicKey} from '@solana/web3.js';
import {OnlinePumpAmmSdk,PUMP_AMM_SDK,PUMP_AMM_PROGRAM_ID,PUMP_FEE_PROGRAM_ID,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,buyQuoteInput,sellBaseInput,poolPda,supportsTradeV2} from '@pump-fun/pump-swap-sdk';
import BN from 'bn.js';
import {DEFAULT_OWNER} from './security.js';
import {SOL} from './engine.js';
const TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export class PaperPoolReader{
 constructor(rpc,{clock=Date.now,bootstrapIntervalMs=0}={}){this.bootstrapIntervalMs=bootstrapIntervalMs;this.nextBootstrapAt=0;this.rpc=rpc;this.clock=clock;this.cache=new Map();this.jobs=new Map();this.attempts=new Map();this.rejections=new ReadRejectionCache({clock});}
 prune(){const now=this.clock();for(const [k,v]of this.cache)if(now-v.at>300000)this.cache.delete(k);if(this.cache.size>128)for(const [key]of [...this.cache].sort(([,a],[,b])=>a.at-b.at).slice(0,this.cache.size-128))this.cache.delete(key);for(const [k,at]of this.attempts)if(now-at>300000)this.attempts.delete(k);while(this.attempts.size>512)this.attempts.delete(this.attempts.keys().next().value);}
 async ensure(m){
  const key=m.mint+':'+m.pairAddress,old=this.cache.get(key);if(old&&this.clock()-old.metadataAt<30000)return old;
  if(this.jobs.has(key))return this.jobs.get(key);
  const rejected=this.rejections.get(key);if(rejected)throw rejected;
  const task=(async()=>{
   const at=this.clock(),poolKey=new PublicKey(m.pairAddress),accounts=await this.rpc.getMultipleAccountsInfo([poolKey,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA],'confirmed');
   if(!accounts[0]?.owner.equals(PUMP_AMM_PROGRAM_ID)||!accounts[1]?.owner.equals(PUMP_AMM_PROGRAM_ID)||!accounts[2]?.owner.equals(PUMP_FEE_PROGRAM_ID))throw Error('Model pool/fee ownership mismatch');
   const state=await pumpAmmClient(this.rpc).swapSolanaState(poolKey,new PublicKey(DEFAULT_OWNER)),p=state.pool;
   if(p.baseMint.toBase58()!==m.mint||p.quoteMint.toBase58()!==SOL||!poolPda(p.index,p.creator,p.baseMint,p.quoteMint).equals(poolKey)||p.isMayhemMode||!supportsTradeV2(p))throw Error('Unsupported model pool identity/version');
   // Unknown Token-2022 transfer effects are not modeled as zero fees.
   if(state.baseTokenProgram.toBase58()!==TOKEN||state.quoteTokenProgram.toBase58()!==TOKEN)throw Error('Model requires supported SPL token programs');
   const decimals=state.baseMintAccount?.decimals;if(!Number.isInteger(decimals)||decimals<0||decimals>18)throw Error('Model missing decimals');
   state.poolBaseTokenAccount=p.poolBaseTokenAccount;state.poolQuoteTokenAccount=p.poolQuoteTokenAccount;
   const row={m:{mint:m.mint,pairAddress:m.pairAddress},state,metadataAt:at,decimals,at};this.cache.set(key,row);this.prune();return row;
  })();this.jobs.set(key,task);try{return await task;}catch(error){this.rejections.remember(key,error);throw error;}finally{this.jobs.delete(key);}
 }
 async refresh(markets){
  this.prune();
  // Bootstrap one previously unseen pool per cycle; existing pool price reads are batched.
  const unique=[...new Map(markets.filter(m=>m.dexId==='pumpswap').map(m=>[m.mint+':'+m.pairAddress,m])).values()];
  const missing=unique.find(m=>!this.cache.has(m.mint+':'+m.pairAddress)&&!this.rejections.get(m.mint+':'+m.pairAddress)&&this.clock()-(this.attempts.get(m.mint+':'+m.pairAddress)??-Infinity)>30000);if(missing&&this.clock()>=this.nextBootstrapAt){this.nextBootstrapAt=this.clock()+this.bootstrapIntervalMs;this.attempts.set(missing.mint+':'+missing.pairAddress,this.clock());try{await this.ensure(missing);}catch(error){if(error.code==='RPC_UNAVAILABLE')this.nextBootstrapAt=Math.max(this.nextBootstrapAt,this.clock()+30000,error.retryAt??0);console.error('paper reserve bootstrap',missing.mint,error.message);}}
  const rows=unique.map(m=>this.cache.get(m.mint+':'+m.pairAddress)).filter(Boolean);const at=this.clock();
  for(let start=0;start<rows.length;start+=20){const group=rows.slice(start,start+20),keys=group.flatMap(r=>[new PublicKey(r.m.pairAddress),r.state.poolBaseTokenAccount,r.state.poolQuoteTokenAccount]),accounts=await this.rpc.getMultipleAccountsInfo(keys,'confirmed');
   for(const [i,r]of group.entries()){
    const [pa,base,quote]=accounts.slice(i*3,i*3+3);if(!pa?.owner.equals(PUMP_AMM_PROGRAM_ID)||!base?.owner.equals(r.state.baseTokenProgram)||!quote?.owner.equals(r.state.quoteTokenProgram)||base.data.length<165||quote.data.length<165)continue;
    const pool=PUMP_AMM_SDK.decodePool(pa);if(pool.baseMint.toBase58()!==r.m.mint||pool.quoteMint.toBase58()!==SOL||!pool.poolBaseTokenAccount.equals(r.state.poolBaseTokenAccount)||!pool.poolQuoteTokenAccount.equals(r.state.poolQuoteTokenAccount)||new PublicKey(base.data.subarray(0,32)).toBase58()!==r.m.mint||new PublicKey(quote.data.subarray(0,32)).toBase58()!==SOL)continue;
    r.state.pool=pool;r.state.poolBaseAmount=new BN(base.data.readBigUInt64LE(64).toString());r.state.poolQuoteAmount=new BN(quote.data.readBigUInt64LE(64).toString());r.at=at;
   }
  }
  this.prune();return this.prices(unique);
 }
 prices(markets){return markets.flatMap(m=>{const r=this.cache.get(m.mint+':'+m.pairAddress);if(!r||r.state.poolBaseAmount.lten(0))return [];const price=Number(r.state.poolQuoteAmount.add(r.state.pool.virtualQuoteReserves).toString())/1e9/(Number(r.state.poolBaseAmount.toString())/10**r.decimals);return [{mint:m.mint,pairAddress:m.pairAddress,spotPriceSol:price,priceAt:r.at,priceSource:'RPC pool reserves'}];});}
 async quote(input,m){
  let r=await this.ensure(m);if(this.clock()-r.at>1000||r.at<input.minObservedAt){await this.refresh([m]);r=this.cache.get(m.mint+':'+m.pairAddress);}
  const now=this.clock();if(r.at<input.minObservedAt||now-r.at>1500||now-r.metadataAt>30000)throw Error('AMM model reserves/fees stale');
  const s=r.state,p=s.pool,args={baseReserve:s.poolBaseAmount,quoteReserve:s.poolQuoteAmount,virtualQuoteReserves:p.virtualQuoteReserves,feeBucketsTotal:p.protocolFees.add(p.creatorFees),globalConfig:s.globalConfig,feeConfig:s.feeConfig,baseMint:s.baseMint,baseMintAccount:s.baseMintAccount,coinCreator:p.coinCreator,creator:p.creator,quoteMint:p.quoteMint,isMayhemMode:p.isMayhemMode,creatorFeeBps:p.creatorFeeBps};
  const amount=new BN(input.amount),buy=input.side==='BUY',priced=buy?buyQuoteInput({...args,quote:amount,slippage:0}):sellBaseInput({...args,base:amount,slippage:0}),out=buy?priced.base:priced.uiQuote;
  if(out.lten(0))throw Error('Model zero output');
  const reverse=buy?sellBaseInput({...args,base:out,slippage:0}).uiQuote:null,loss=reverse?Math.max(0,1-(Number(reverse.toString())-50000)/Number(input.amount))*100:null;
  return {quote:{mint:input.mint,side:input.side,inAmount:input.amount,outAmount:out.toString(),checkedAt:r.at,provider:'PumpSwap SDK AMM model',impactPct:amount.muln(1000000).div(buy?s.poolQuoteAmount:s.poolBaseAmount).toNumber()/10000},quoteSource:'model',decimals:r.decimals,roundTripLossPct:loss,observedNow:now};
 }
}
