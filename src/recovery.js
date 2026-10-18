import {PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {OFFLINE_PUMP_AMM_PROGRAM as program,PUMP_AMM_PROGRAM_ID,poolPda} from '@pump-fun/pump-swap-sdk';
import {SOL,freshState,event} from './engine.js';
import {STRATEGY_VERSION,positionLimitReached,HISTORICAL_BUY_LAMPORTS,walletOrderSol} from './desk-rules.js';

export function purchaseSignature(value){
 let signature=String(value??'').trim();
 if(signature.startsWith('https://solscan.io/tx/')){const u=new URL(signature);if(u.hostname!=='solscan.io'||u.search||u.hash)throw Error('Link Solscan không hợp lệ.');signature=u.pathname.slice(4);}
 if(!/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(signature)||bs58.decode(signature).length!==64)throw Error('Cần Transaction ID đầy đủ hoặc link Solscan.');
 return signature;
}
export function inventoryBalances(accounts,owner){
 const balances=new Map();
 for(const a of accounts){const d=a.account.data;if(!Buffer.isBuffer(d)||d.length<165||new PublicKey(d.subarray(32,64)).toBase58()!==owner)throw Error('Tài khoản token không thuộc ví chủ.');const mint=bs58.encode(d.subarray(0,32)),raw=d.readBigUInt64LE(64);if(raw)balances.set(mint,(balances.get(mint)??0n)+raw);}
 return balances;
}
function tokenAmount(tx,owner,mint,side){return (tx.meta?.[side+'TokenBalances']??[]).filter(b=>b.owner===owner&&b.mint===mint).reduce((n,b)=>n+BigInt(b.uiTokenAmount.amount),0n);}
function reject(message){throw Error('Chưa thể khôi phục: '+message);}

// Read-only proof: confirmed transaction, exact-quote PumpSwap purchase, payer and pool binding.
// Never accept prices, quantities, costs, or a signed transaction supplied by the browser.
export async function verifyPurchase(execution,owner,input){
 const signature=purchaseSignature(input.signature),mint=new PublicKey(input.mint).toBase58();if(mint===SOL)reject('mint phải là token, không phải WSOL.');
 await execution.network();const rpc=execution.rpc,tx=await rpc.getParsedTransaction(signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});
 if(!tx?.meta||tx.meta.err||!Number.isInteger(tx.blockTime)||tx.blockTime*1000>Date.now()+30000||tx.transaction.signatures[0]!==signature)reject('chưa có receipt thành công đã xác nhận.');
 const keys=tx.transaction.message.accountKeys;if(keys[0]?.pubkey.toBase58()!==owner||!keys[0].signer||keys.filter(k=>k.signer).length!==1)reject('ví chủ phải là người trả phí và người ký duy nhất.');
 const swaps=tx.transaction.message.instructions.filter(i=>i.programId.equals(PUMP_AMM_PROGRAM_ID));if(swaps.length!==1||!swaps[0].data)reject('cần một lệnh mua PumpSwap trực tiếp.');
 const ix=swaps[0],decoded=program.coder.instruction.decode(Buffer.from(bs58.decode(ix.data)));
 if(!decoded||!['buyExactQuoteIn','buyExactQuoteInV2'].includes(decoded.name))reject('không phải lệnh mua exact-quote được hỗ trợ.');
 const spec=program.idl.instructions.find(i=>i.name===decoded.name),account=name=>ix.accounts[spec.accounts.findIndex(a=>a.name===name)]?.toBase58();
 if(account('user')!==owner||account('baseMint')!==mint||account('quoteMint')!==SOL)reject('lệnh mua không khớp ví/token/SOL.');
 const inputLamports=Number(decoded.data.spendableQuoteIn.toString());if(!HISTORICAL_BUY_LAMPORTS.includes(String(inputLamports))&&inputLamports!==Math.round(walletOrderSol(tx.meta.preBalances[0]/1e9)*1e9))reject('lệnh mua không thuộc cỡ hiện tại hoặc lịch sử của bot.');
 const pairAddress=account('pool'),info=await rpc.getAccountInfo(new PublicKey(pairAddress),'confirmed');
 if(!info?.owner.equals(PUMP_AMM_PROGRAM_ID))reject('pool không thuộc PumpSwap.');
 const pool=program.coder.accounts.decode('pool',info.data);
 if(pool.baseMint.toBase58()!==mint||pool.quoteMint.toBase58()!==SOL||!poolPda(pool.index,pool.creator,pool.baseMint,pool.quoteMint).equals(new PublicKey(pairAddress)))reject('pool/PDA không khớp token.');
 const pre=tokenAmount(tx,owner,mint,'pre'),post=tokenAmount(tx,owner,mint,'post'),rows=(tx.meta.postTokenBalances??[]).filter(b=>b.owner===owner&&b.mint===mint);
 if(pre!==0n||post<=0n||rows.length!==1||keys[rows[0].accountIndex]?.pubkey.toBase58()!==account('userBaseTokenAccount'))reject('đã có token trước lần mua hoặc tài khoản nhận không khớp; cần nhật ký đầy đủ.');
 const decimals=rows[0].uiTokenAmount.decimals,costLamports=tx.meta.preBalances[0]-tx.meta.postBalances[0];
 if(!Number.isInteger(decimals)||decimals<0||decimals>9||!Number.isSafeInteger(costLamports)||costLamports<inputLamports||costLamports>inputLamports+5000000||!Number.isSafeInteger(tx.meta.fee)||tx.meta.fee<0||tx.meta.fee>25000)reject('chi phí hoặc số lượng không hợp lệ.');
 const balances=inventoryBalances(await execution.holdings(owner),owner);if(balances.get(mint)!==post)reject('số dư token đã đổi sau lần mua; cần khôi phục cả lịch sử bán/mua.');
 // Same amount alone does not prove an untouched position. Reject intervening token movements.
 // Query the token account: delegated transfers need not mention the wallet in message keys.
 const newer=await rpc.getSignaturesForAddress(new PublicKey(account('userBaseTokenAccount')),{until:signature,limit:51},'confirmed');if(newer.length>50)reject('có quá nhiều giao dịch mới; cần nhật ký đầy đủ.');
 for(const item of newer){if(item.err)continue;const later=await rpc.getParsedTransaction(item.signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});if(!later?.meta)reject('thiếu receipt sau lần mua.');if(tokenAmount(later,owner,mint,'post')!==tokenAmount(later,owner,mint,'pre'))reject('token đã có giao dịch khác sau lần mua; không đoán giá vốn.');}
 return {signature,mint,pairAddress,slot:tx.slot,openedAt:tx.blockTime*1000,rawQuantity:post.toString(),quantity:Number(post)/10**decimals,decimals,costSol:costLamports/1e9,swapInputSol:inputLamports/1e9,networkFeeSol:tx.meta.fee/1e9,checkedAt:Date.now()};
}

export function adoptPurchase(current,owner,proof,walletBalance){
 if(current?.running||current?.pending)throw Error('Dừng bot và đối soát lệnh chờ trước khi khôi phục.');
 if(current?.recordedSignatures.includes(proof.signature))return current;
 if(current?.positions.some(p=>p.mint===proof.mint))throw Error('Token đã có vị thế; không cộng trùng.');
 if(!Number.isFinite(walletBalance)||walletBalance<0)throw Error('Chưa đọc được số dư SOL.');
 const s=current?structuredClone(current):{...freshState(),owner,ownerLedgerVersion:1,strategyVersion:STRATEGY_VERSION,settings:{...freshState().settings,initialSol:.3},cashSol:Math.min(walletBalance,Math.max(0,.3-proof.costSol)),peakEquity:.3,dayStartEquity:.3,pending:null,recordedSignatures:[],realizedNetSol:0,withdrawnSol:0,payoutFeesSol:0,payouts:[],expenses:[]};
 if(positionLimitReached(s.positions.length,s.settings))throw Error('Đã đủ số vị thế; không ghi đè vị thế khác.');
 const entryPriceSol=proof.swapInputSol/proof.quantity;
 s.positions.push({mint:proof.mint,pairAddress:proof.pairAddress,symbol:proof.mint.slice(0,6),quantity:proof.quantity,initialQuantity:proof.quantity,rawQuantity:proof.rawQuantity,decimals:proof.decimals,costSol:proof.costSol,initialCostSol:proof.costSol,costUsd:0,initialCostUsd:0,entrySolUsd:null,entryPriceUsd:null,lastPriceUsd:null,peakPriceUsd:null,priceBasis:'sol',entryPriceSol,lastPriceSol:entryPriceSol,peakPriceSol:entryPriceSol,nextTakeProfitPriceSol:null,maxGainPct:0,openedAt:proof.openedAt,observedSince:Date.now(),phase:'initial',realizedPnlSol:0,recoveredUsd:0,runnerSteps:0,recoverySignature:proof.signature});
 s.trades.unshift({side:'BUY',mode:'live',mint:proof.mint,symbol:proof.mint.slice(0,6),quantity:proof.quantity,priceUsd:null,sol:proof.costSol,at:proof.openedAt,reason:'verified-recovery',signature:proof.signature,networkFeeSol:proof.networkFeeSol,recovered:true});
 s.recordedSignatures.push(proof.signature);s.running=false;s.buyPaused=true;s.recoveryRequired=true;s.recoveryReason='Đã khôi phục vị thế từ receipt; lịch sử tài khoản chưa đầy đủ nên chưa chuyển lãi. Bật bot để tiếp tục BUY/SELL theo giới hạn vốn.';
 s.recoveries??=[];s.recoveries.push({...proof,recoveredAt:Date.now()});
 event(s,'Khôi phục vị thế từ giao dịch '+proof.signature+'; giữ nguyên SOL hiện có, không trừ tiền mua lần hai.');return s;
}
