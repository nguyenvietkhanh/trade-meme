import {PublicKey,ComputeBudgetProgram,VersionedTransaction,TransactionMessage} from '@solana/web3.js';
import {OnlinePumpAmmSdk,PUMP_AMM_SDK,PUMP_AMM_PROGRAM_ID,PUMP_FEE_PROGRAM_ID,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,buyQuoteInput,sellBaseInput,poolPda,supportsTradeV2} from '@pump-fun/pump-swap-sdk';
import BN from 'bn.js';
import {SOL} from './engine.js';

export const PUMP_PROGRAM=PUMP_AMM_PROGRAM_ID;
const TOKEN=new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SLIPPAGE_BPS=150;
const fail=message=>{throw Error(message);};

// Quotes and instructions come from the official SDK and on-chain accounts, never an HTTP swap API.
export async function buildPumpSwap(rpc,{owner,input,output,amount,poolAddress}){
 if((input===SOL)===(output===SOL)||!/^\d{1,20}$/.test(String(amount))||BigInt(amount)<=0n||BigInt(amount)>18446744073709551615n)fail('Chỉ hỗ trợ lệnh SOL/token với số lượng hợp lệ.');
 if(!poolAddress)fail('Thiếu địa chỉ pool PumpSwap đã quét.');
 const started=Date.now(),slot=await rpc.getSlot('confirmed'),poolKey=new PublicKey(poolAddress),mint=new PublicKey(input===SOL?output:input);
 const accounts=await rpc.getMultipleAccountsInfo([poolKey,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA]);
 if(!accounts[0]?.owner.equals(PUMP_AMM_PROGRAM_ID)||!accounts[1]?.owner.equals(PUMP_AMM_PROGRAM_ID)||!accounts[2]?.owner.equals(PUMP_FEE_PROGRAM_ID))fail('Pool hoặc cấu hình phí không thuộc chương trình PumpSwap.');
 const state=await new OnlinePumpAmmSdk(rpc).swapSolanaState(poolKey,owner),{pool}=state;
 if(!pool.baseMint.equals(mint)||pool.quoteMint.toBase58()!==SOL||!state.baseTokenProgram.equals(TOKEN)||!state.quoteTokenProgram.equals(TOKEN)||!poolPda(pool.index,pool.creator,pool.baseMint,pool.quoteMint).equals(poolKey))fail('Pool không khớp mint/SOL hoặc chương trình token được hỗ trợ.');
 if(pool.isMayhemMode||!supportsTradeV2(pool))fail('Chưa hỗ trợ pool mayhem/cashback; không tạo lệnh.');
 if(state.userQuoteAccountInfo&&state.userQuoteAccountInfo.data.readBigUInt64LE(64)>0n)fail('Ví đang giữ WSOL trong ATA; cần tách tài sản trước khi swap để tránh trộn số dư.');
 const args={baseReserve:state.poolBaseAmount,quoteReserve:state.poolQuoteAmount,virtualQuoteReserves:pool.virtualQuoteReserves,feeBucketsTotal:pool.protocolFees.add(pool.creatorFees),globalConfig:state.globalConfig,feeConfig:state.feeConfig,baseMint:state.baseMint,baseMintAccount:state.baseMintAccount,coinCreator:pool.coinCreator,creator:pool.creator,quoteMint:pool.quoteMint,isMayhemMode:pool.isMayhemMode,creatorFeeBps:pool.creatorFeeBps};
 const value=new BN(String(amount)),buy=input===SOL,reserve=buy?state.poolQuoteAmount:state.poolBaseAmount;
 if(reserve.lten(0)||value.muln(100).gt(reserve.muln(2)))fail('Lệnh vượt 2% dự trữ pool; bỏ qua do price impact.');
 const priced=buy?buyQuoteInput({...args,quote:value,slippage:0}):sellBaseInput({...args,base:value,slippage:0});
 const out=buy?priced.base:priced.uiQuote,minOut=out.muln(10000-SLIPPAGE_BPS).divn(10000);
 if(minOut.lten(0)||(!buy&&out.gt(new BN(String(Number.MAX_SAFE_INTEGER)))))fail('Đầu ra sau slippage không nằm trong khoảng hỗ trợ.');
 if(buy){const reverse=sellBaseInput({...args,base:minOut,slippage:1.5});if(reverse.minQuote.muln(100).lt(value.muln(92)))fail('Chi phí vòng mua/bán vượt 8%; bỏ qua token.');}
 const instructions=buy?await PUMP_AMM_SDK.buyExactQuoteInV2Instructions(state,value,minOut):await PUMP_AMM_SDK.sellV2Instructions(state,value,minOut);
 const currentSlot=await rpc.getSlot('confirmed');if(Date.now()-started>12000||currentSlot<slot||currentSlot-slot>20)fail('Trạng thái pool đã cũ; chờ báo giá mới.');
 const block=await rpc.getLatestBlockhash('confirmed');
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:owner,recentBlockhash:block.blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:300000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:50000}),...instructions]}).compileToV0Message());
 return {tx,lastValidBlockHeight:block.lastValidBlockHeight,quote:{inputMint:input,outputMint:output,inAmount:String(amount),outAmount:out.toString(),otherAmountThreshold:minOut.toString(),swapMode:'ExactIn',priceImpactPct:value.muln(1000000).div(reserve).toNumber()/1000000,slippageBps:SLIPPAGE_BPS,contextSlot:currentSlot,routePlan:[{swapInfo:{label:'PumpSwap',ammKey:poolAddress}}]}};
}
