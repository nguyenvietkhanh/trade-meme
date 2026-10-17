import {freshState,recordBuy,recordSell,riskCheck,exitPlan,event} from './engine.js';
import {rankMarket} from './strategy.js';

export function createOwnerLedger(owner,balance){
 if(!Number.isFinite(balance)||balance<.085)throw Error('Cần ít nhất 0,085 SOL để giữ dự phòng và chuẩn bị lệnh 0,03 SOL.');
 const s=freshState(),budget=Math.min(.3,balance);
 return {...s,owner,ownerLedgerVersion:1,cashSol:budget,peakEquity:budget,dayStartEquity:budget,settings:{...s.settings,initialSol:budget},pending:null,recordedSignatures:[],running:false};
}
export function nextOwnerOrder(s,feed,walletBalance){
 if(s.pending||feed.error||!feed.updatedAt||Date.now()-feed.updatedAt>90000||!Number.isFinite(feed.solUsd)||feed.solUsd<=0)return null;
 riskCheck(s,feed.markets,feed.solUsd);
 for(const p of s.positions){const m=feed.markets.find(m=>m.mint===p.mint);if(!m||Date.now()-m.updatedAt>90000)continue;p.lastPriceUsd=m.priceUsd;const plan=exitPlan(p,m,feed.solUsd,s.settings);if(plan)return ownerExit(s,p.mint,plan.fraction,plan.reason,feed.solUsd);}
 if(s.halted||s.positions.length>=5||s.cashSol-.035<.05||walletBalance-.035<.05||s.positions.some(p=>!feed.markets.some(m=>m.mint===p.mint)))return null;
 const m=feed.markets.map(m=>({...m,...rankMarket(m,s.settings)})).filter(m=>m.eligible&&!s.positions.some(p=>p.mint===m.mint)&&!(s.cooldowns[m.mint]>Date.now())).sort((a,b)=>b.score-a.score)[0];
 return m?{side:'BUY',mint:m.mint,symbol:m.symbol,reason:'autonomous-low-cap'}:null;
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
 if(result.status==='confirmed'){
  const raw=BigInt(result.tokenDelta),quantity=Number(raw<0n?-raw:raw)/10**result.decimals,m={mint:intent.mint,symbol:intent.symbol,priceUsd:intent.priceUsd};
  if(intent.side==='BUY')recordBuy(s,m,intent.solUsd,{quantity,costSol:-result.solDelta,priceUsd:-result.solDelta*intent.solUsd/quantity,rawQuantity:raw.toString(),decimals:result.decimals,signature:result.signature},Date.now(),intent.reason,'live');
  else{
   const p=s.positions.find(p=>p.mint===intent.mint);if(!p||raw>=0n||-raw>BigInt(p.rawQuantity))throw Error('Lượng bán không khớp sổ vị thế của ứng dụng.');
   const remaining=BigInt(p.rawQuantity)+raw;
   recordSell(s,m,intent.solUsd,{quantity,proceedsSol:result.solDelta,priceUsd:result.solDelta*intent.solUsd/quantity,rawBalance:remaining.toString(),closed:remaining===0n,signature:result.signature},Date.now(),intent.reason,'live');
  }
 }else if(result.status==='failed'){
  if(!Number.isFinite(result.feeSol)||result.feeSol<0)throw Error('Không xác minh được phí giao dịch thất bại.');
  s.cashSol-=result.feeSol;event(s,'Giao dịch thất bại trên Solana; đã ghi nhận phí mạng.');
 }else if(result.status==='expired')event(s,'Giao dịch hết hạn; không ghi nhận mua/bán và không tự gửi thay thế.');
 else return false;
 s.recordedSignatures.push(result.signature);s.recordedSignatures=s.recordedSignatures.slice(-1000);s.pending=null;return result.status==='confirmed';
}
