import {PublicKey,VersionedTransaction,TransactionMessage,ComputeBudgetProgram,SystemProgram} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,createAssociatedTokenAccountIdempotentInstruction,createCloseAccountInstruction,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,MintLayout} from '@solana/spl-token';
import {PUMP_SDK,PUMP_PROGRAM_ID,PUMP_FEE_PROGRAM_ID,GLOBAL_PDA,PUMP_FEE_CONFIG_PDA,bondingCurvePda,bondingCurveV2Pda,creatorVaultPda,getPumpProgram,getBuyTokenAmountFromSolAmount,getSellSolAmountFromTokenAmount,getFeeRecipient,canonicalPumpPoolPda} from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import {SOL} from './engine.js';
import {validatePriorityBudget,CURVE_RULES} from './desk-rules.js';
export {PUMP_PROGRAM_ID as CURVE_PROGRAM,canonicalPumpPoolPda,bondingCurvePda};
const fail=m=>{throw Error(m);},bn=v=>new BN(String(v));
const owned=(a,p)=>a&&a.owner.equals(p)&&!a.executable&&Buffer.isBuffer(a.data);
export function decodeCurve(info){
 if(!owned(info,PUMP_PROGRAM_ID))fail('Curve không thuộc chương trình pump.fun chính thức.');
 const curve=PUMP_SDK.decodeBondingCurve(info);
 if(![PublicKey.default.toBase58(),SOL].includes(curve.quoteMint.toBase58())||curve.depth!==0||curve.isMayhemMode||curve.isCashbackCoin)fail('Curve quote/mayhem/cashback chưa hỗ trợ.');
 return curve;
}
export async function curveState(rpc,mint,poolAddress){
 mint=new PublicKey(mint);const address=bondingCurvePda(mint);if(poolAddress&&address.toBase58()!==poolAddress)fail('Địa chỉ bonding curve không khớp PDA của mint.');
 const started=Date.now(),slot=await rpc.getSlot('confirmed'),[curveInfo,globalInfo,feeInfo,mintInfo]=await rpc.getMultipleAccountsInfo([address,GLOBAL_PDA,PUMP_FEE_CONFIG_PDA,mint]),curve=decodeCurve(curveInfo);
 if(!owned(globalInfo,PUMP_PROGRAM_ID)||!owned(feeInfo,PUMP_FEE_PROGRAM_ID))fail('Cấu hình pump.fun/fee không thuộc chương trình chính thức.');
 if(!mintInfo||!Buffer.isBuffer(mintInfo.data)||mintInfo.data.length<82||![TOKEN_PROGRAM_ID.toBase58(),TOKEN_2022_PROGRAM_ID.toBase58()].includes(mintInfo.owner.toBase58()))fail('Mint của curve không hợp lệ.');
 const mintData=MintLayout.decode(mintInfo.data.subarray(0,82));if(!mintData.isInitialized||mintData.mintAuthorityOption!==0||mintData.freezeAuthorityOption!==0||mintData.decimals!==6||!curve.tokenTotalSupply.eq(bn(mintData.supply)))fail('Curve mint/supply/authority không khớp.');
 const tokenProgram=mintInfo.owner,curveAta=getAssociatedTokenAddressSync(mint,address,true,tokenProgram),vault=await rpc.getMultipleAccountsInfo([curveAta]);
 const d=vault[0]?.data;if(!owned(vault[0],tokenProgram)||d.length<165||!new PublicKey(d.subarray(0,32)).equals(mint)||!new PublicKey(d.subarray(32,64)).equals(address)||bn(d.readBigUInt64LE(64)).lt(curve.realTokenReserves))fail('Dự trữ token thực của curve không khớp.');
 if(!Number.isSafeInteger(curveInfo.lamports)||curve.realQuoteReserves.gt(bn(curveInfo.lamports)))fail('Dự trữ SOL thực của curve không khớp.');
 const lastSlot=await rpc.getSlot('confirmed');if(Date.now()-started>12000||lastSlot<slot||lastSlot-slot>20)fail('Trạng thái bonding curve đã cũ.');
 return {mint,address,curve,curveInfo,tokenProgram,mintSupply:bn(mintData.supply),global:PUMP_SDK.decodeGlobal(globalInfo),feeConfig:PUMP_SDK.decodeFeeConfig(feeInfo),slot:lastSlot,checkedAt:Date.now()};
}
export function quoteCurve(state,side,amount,{maxReserveFraction=.02}={}){
 const {curve,global,feeConfig,mintSupply}=state,value=bn(amount),buy=side==='BUY';
 if(curve.complete||curve.virtualQuoteReserves.lten(0)||curve.virtualTokenReserves.lten(0)||curve.realTokenReserves.lten(0))fail('Curve đã hoàn tất; chờ đường PumpSwap được xác minh.');
 if(value.lten(0))fail('Lượng giao dịch curve không hợp lệ.');
 const args={global,feeConfig,mintSupply,bondingCurve:curve,amount:value,quoteMint:curve.quoteMint};
 const out=buy?getBuyTokenAmountFromSolAmount(args):getSellSolAmountFromTokenAmount(args);
 if(out.lten(0)||buy&&out.gte(curve.realTokenReserves))fail('Không mua xuyên điểm hoàn tất curve hoặc nhận đầu ra bằng 0.');
 const impact=buy?value.muln(1000000).div(curve.virtualQuoteReserves).toNumber()/1000000:value.muln(1000000).div(curve.virtualTokenReserves).toNumber()/1000000;
 if(impact>maxReserveFraction||(!buy&&out.gt(curve.realQuoteReserves))||(buy&&value.muln(10000).gt(curve.realQuoteReserves.muln(Math.round(maxReserveFraction*10000)))))fail('Lệnh vượt độ sâu/price impact hoặc SOL thực có thể bán của curve.');
 return {out,impact};
}
export function curveRoundTrip(state,amount){
 const buy=quoteCurve(state,'BUY',amount),sell=quoteCurve(state,'SELL',buy.out.toString()),net=sell.out.subn(50000),loss=(1-net.toNumber()/Number(amount))*100;
 if(net.lten(0)||loss>6||loss<0)fail('Quote vòng bonding curve hao hụt vượt 6%.');
 return {roundTripQuoteOk:true,roundTripProvider:'pumpfun',probeSol:Number(amount)/1e9,roundTripLossPct:loss,buyImpactPct:buy.impact*100,sellImpactPct:sell.impact*100,quoteCheckedAt:state.checkedAt,quoteContextSlot:state.slot,buyRawAmount:buy.out.toString(),sellBackLamports:net.toString()};
}
export async function buildPumpCurve(rpc,{owner,input,output,amount,poolAddress,slippageBps=150,maxReserveFraction=.02,closeEmptyInput=false,referenceMinOut,referencePriceSol}){
 if((input===SOL)===(output===SOL)||!/^\d{1,20}$/.test(String(amount))||BigInt(amount)<=0n||BigInt(amount)>18446744073709551615n||!Number.isInteger(slippageBps)||slippageBps<1||slippageBps>1000)fail('Lệnh bonding curve không hợp lệ.');
 const buy=input===SOL;if(![.02,.1].includes(maxReserveFraction)||buy&&(maxReserveFraction!==.02||slippageBps>400))fail('Giới hạn lệnh curve không hợp lệ.');
 const state=await curveState(rpc,buy?output:input,poolAddress),{mint,curve,global,tokenProgram}=state,{out,impact}=quoteCurve(state,buy?'BUY':'SELL',amount,{maxReserveFraction});
 const entryQuoteProof=buy?curveRoundTrip(state,amount):null;
 if(buy&&(!(referencePriceSol>0)||Math.abs(curve.virtualQuoteReserves.toNumber()/1e9/(curve.virtualTokenReserves.toNumber()/1e6)/referencePriceSol-1)>.02))fail('Giá curve đã lệch quá 2% so với tín hiệu; chờ quét lại.');
 let minOut=out.muln(10000-slippageBps).divn(10000);if(buy&&referenceMinOut!=null){if(!/^\d+$/.test(String(referenceMinOut))||bn(referenceMinOut).gt(out))fail('Curve không đáp ứng mức nhận đã xác minh.');if(bn(referenceMinOut).gt(minOut))minOut=bn(referenceMinOut);}
 if(minOut.lten(0))fail('Đầu ra curve sau slippage không dương.');
 const userAta=getAssociatedTokenAddressSync(mint,owner,false,tokenProgram),userInfo=(await rpc.getMultipleAccountsInfo([userAta]))[0],instructions=[];
 const feeRecipient=getFeeRecipient(global,false),buybackFeeRecipient=global.buybackFeeRecipients.find(k=>!k.equals(PublicKey.default));if(!buybackFeeRecipient)fail('Chưa xác minh ví nhận buyback fee.');
 if(buy&&!userInfo)instructions.push(createAssociatedTokenAccountIdempotentInstruction(owner,userAta,owner,mint,tokenProgram));
 const remaining=[{pubkey:bondingCurveV2Pda(mint),isSigner:false,isWritable:false},{pubkey:buybackFeeRecipient,isSigner:false,isWritable:true}];
 if(buy){const program=getPumpProgram(rpc);instructions.push(await program.methods.buyExactSolIn(bn(amount),minOut,{0:false},{0:false}).accountsPartial({feeRecipient,mint,associatedUser:userAta,user:owner,creatorVault:creatorVaultPda(curve.creator),tokenProgram}).remainingAccounts(remaining).instruction());}
 else instructions.push(await PUMP_SDK.getSellInstructionRaw({user:owner,mint,creator:curve.creator,amount:bn(amount),solAmount:minOut,feeRecipient,buybackFeeRecipient,tokenProgram,cashback:false}));
 let closedInputAccount=null;
 if(!buy&&closeEmptyInput&&owned(userInfo,tokenProgram)&&userInfo.data.length>=165&&new PublicKey(userInfo.data.subarray(0,32)).equals(mint)&&new PublicKey(userInfo.data.subarray(32,64)).equals(owner)&&userInfo.data.readBigUInt64LE(64)===BigInt(amount)&&userInfo.data.readUInt32LE(129)===0){instructions.push(createCloseAccountInstruction(userAta,owner,owner,[],tokenProgram));closedInputAccount=userAta.toBase58();}
 const slot=await rpc.getSlot('confirmed');if(Date.now()-state.checkedAt>12000||slot<state.slot||slot-state.slot>20)fail('Quote bonding curve không còn mới.');
 const nativeNotional=buy?Number(amount):out.toNumber(),priority=Math.min(15000,Math.floor(nativeNotional*CURVE_RULES.maxPriorityFraction));validatePriorityBudget(priority,0);const block=await rpc.getLatestBlockhash('confirmed'),tx=new VersionedTransaction(new TransactionMessage({payerKey:owner,recentBlockhash:block.blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:300000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:Math.floor(priority*1000000/300000)}),...instructions]}).compileToV0Message());
 return {tx,closedInputAccount,lastValidBlockHeight:block.lastValidBlockHeight,entryQuoteProof,quote:{quotedAt:state.checkedAt,tokenProgram:tokenProgram.toBase58(),inputMint:input,outputMint:output,inAmount:String(amount),outAmount:out.toString(),otherAmountThreshold:minOut.toString(),swapMode:'ExactIn',priceImpactPct:impact,slippageBps,contextSlot:slot,routePlan:[{swapInfo:{label:'pump.fun bonding curve',ammKey:state.address.toBase58()}}]}};
}
