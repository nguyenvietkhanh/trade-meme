import {freshState,recordBuy,recordSell,riskCheck,exitPlan,event} from './engine.js';
import {rankMarket} from './strategy.js';
import {profitOrder,PROFIT_RECIPIENT} from './profit.js';
import {STRATEGY_VERSION} from './desk-rules.js';

export function createOwnerLedger(owner,balance){
 if(!Number.isFinite(balance)||balance<.085)throw Error('Cần ít nhất 0,085 SOL để giữ dự phòng và chuẩn bị lệnh 0,03 SOL.');
 const s=freshState(),budget=Math.min(.3,balance);
 return {...s,owner,ownerLedgerVersion:1,realizedNetSol:0,withdrawnSol:0,payoutFeesSol:0,payouts:[],expenses:[],cashSol:budget,peakEquity:budget,dayStartEquity:budget,settings:{...s.settings,initialSol:budget},pending:null,recordedSignatures:[],running:false};
}
export function nextOwnerOrder(s,feed,walletBalance){
 if(s.pending||feed.error||!feed.updatedAt||Date.now()-feed.updatedAt>90000||feed.updatedAt>Date.now()||!Number.isFinite(feed.solUsd)||feed.solUsd<=0)return null;
 riskCheck(s,feed.markets,feed.solUsd);
 if(s.haltKind==='drawdown')return null;
 for(const p of s.positions){const m=feed.markets.find(m=>m.mint===p.mint);if(!m||m.updatedAt>Date.now()||Date.now()-m.updatedAt>90000)continue;p.lastPriceUsd=m.priceUsd;const plan=exitPlan(p,m,feed.solUsd,s.settings);if(plan)return ownerExit(s,p.mint,plan.fraction,plan.reason,feed.solUsd);}
 const payout=profitOrder(s,walletBalance);if(payout)return payout;
 if(s.halted||s.lossPauseUntil>Date.now()||s.positions.length>=s.settings.maxPositions||s.cashSol-.035<.05||walletBalance-.035<.05||s.positions.some(p=>!feed.markets.some(m=>m.mint===p.mint)))return null;
 const m=feed.markets.map(m=>({...m,...rankMarket(m,s.settings)})).filter(m=>m.eligible&&!s.positions.some(p=>p.mint===m.mint)&&!(s.cooldowns[m.mint]>Date.now())).sort((a,b)=>b.score-a.score)[0];
 return m?{side:'BUY',mint:m.mint,symbol:m.symbol,reason:'autonomous-low-cap',strategyVersion:STRATEGY_VERSION,riskSol:s.settings.orderSol*s.settings.stopLossPct/100}:null;
}
export function ownerExit(s,mint,fraction=1,reason='owner-exit',solUsd){
 const p=s.positions.find(p=>p.mint===mint);if(!p)throw Error('Không có vị thế do ứng dụng quản lý.');
 const raw=BigInt(p.rawQuantity),amount=fraction>=1?raw:raw*BigInt(Math.floor(fraction*1e9))/1000000000n;
 if(amount<=0n)throw Error('Lượng bán quá nhỏ.');
 return {side:'SELL',mint,symbol:p.symbol,amount:amount.toString(),reason,...(reason==='recover-capital'?{targetSol:p.initialCostUsd*1.4/solUsd}:{})};
}
export function applyOwnerReceipt(s,pending,result){
 if(s.recordedSignatures.includes(result.signature)){s.pending=null;return false;}
 const {intent}=pending;
 if(result.status==='confirmed'&&intent.side==='PROFIT'){
  if(result.recipient!==PROFIT_RECIPIENT||result.amountLamports!==intent.amount||!Number.isFinite(result.feeSol)||result.feeSol<0||result.feeSol>.00001||!Number.isFinite(result.solDelta)||Math.abs(result.solDelta+Number(intent.amount)/1e9+result.feeSol)>1e-10)throw Error('Receipt chuyển lãi không khớp.');
  const amount=Number(result.amountLamports)/1e9;s.cashSol+=result.solDelta;s.withdrawnSol=(s.withdrawnSol??0)+amount;s.payoutFeesSol=(s.payoutFeesSol??0)+result.feeSol;
  s.payouts??=[];s.payouts.unshift({signature:result.signature,amountSol:amount,feeSol:result.feeSol,recipient:PROFIT_RECIPIENT,at:Date.now()});s.payouts=s.payouts.slice(0,500);event(s,'Đã xác nhận chuyển lãi '+amount.toFixed(6)+' SOL về '+PROFIT_RECIPIENT);
 }else if(result.status==='confirmed'){
  const raw=BigInt(result.tokenDelta),quantity=Number(raw<0n?-raw:raw)/10**result.decimals,m={mint:intent.mint,symbol:intent.symbol,priceUsd:intent.priceUsd,liquidityUsd:intent.entryLiquidityUsd,pairAddress:intent.pairAddress};
  if(intent.side==='BUY')recordBuy(s,m,intent.solUsd,{quantity,costSol:-result.solDelta,priceUsd:-result.solDelta*intent.solUsd/quantity,rawQuantity:raw.toString(),decimals:result.decimals,signature:result.signature,networkFeeSol:result.feeSol??null},Date.now(),intent.reason,'live');
  else{
   const p=s.positions.find(p=>p.mint===intent.mint);if(!p||raw>=0n||-raw>BigInt(p.rawQuantity))throw Error('Lượng bán không khớp sổ vị thế của ứng dụng.');
   const remaining=BigInt(p.rawQuantity)+raw;
   recordSell(s,m,intent.solUsd,{quantity,proceedsSol:result.solDelta,priceUsd:result.solDelta*intent.solUsd/quantity,rawBalance:remaining.toString(),closed:remaining===0n,signature:result.signature,networkFeeSol:result.feeSol??null},Date.now(),intent.reason,'live');
  }
 }else if(result.status==='failed'){
  if(!Number.isFinite(result.feeSol)||result.feeSol<0)throw Error('Không xác minh được phí giao dịch thất bại.');
  s.expenses??=[];s.expenses.unshift({signature:result.signature,feeSol:result.feeSol,kind:'failed-'+intent.side,at:Date.now()});s.expenses=s.expenses.slice(0,500);
  s.cashSol-=result.feeSol;s.realizedNetSol=(s.realizedNetSol??0)-result.feeSol;event(s,'Giao dịch thất bại trên Solana; đã ghi nhận phí mạng.');
 }else if(result.status==='expired')event(s,'Giao dịch hết hạn; không ghi nhận mua/bán và không tự gửi thay thế.');
 else return false;
 s.recordedSignatures.push(result.signature);s.recordedSignatures=s.recordedSignatures.slice(-1000);s.pending=null;return result.status==='confirmed';
}
