import {freshState,recordBuy,recordSell,riskCheck,exitPlan,event} from './engine.js';
import {rankMarket} from './strategy.js';
import {profitOrder,PROFIT_RECIPIENT} from './profit.js';
import {STRATEGY_VERSION,positionLimitReached,canFundBuy,BUY_LAMPORTS,walletOrderSol,WALLET_SIZING_VERSION,WALLET_ORDER_FRACTION,CURVE_RULES} from './desk-rules.js';
import {isPumpCurve} from './venues.js';
import {enqueueTrainingRecord} from './training-records.js';

export function createOwnerLedger(owner,balance){
 if(!Number.isFinite(balance)||balance<0||!Number.isSafeInteger(Math.round(balance*1e9)))throw Error('Số dư SOL ví chưa hợp lệ.');
 const s=freshState(),budget=balance,size=walletOrderSol(balance);
 return {...s,strategyVersion:STRATEGY_VERSION,owner,ownerLedgerVersion:1,realizedNetSol:0,withdrawnSol:0,externalWithdrawnSol:0,payoutFeesSol:0,payouts:[],expenses:[],cashSol:budget,peakEquity:budget,dayStartEquity:budget,settings:{...s.settings,initialSol:budget,orderSol:size,smallOrderSol:size,orderFraction:WALLET_ORDER_FRACTION,sizingVersion:WALLET_SIZING_VERSION},pending:null,recordedSignatures:[],running:false};
}
export function allocateOwnerCapital(s,walletBalance,now=Date.now()){
 if(s.pending||![walletBalance,s.cashSol,s.settings?.initialSol,s.peakEquity,s.dayStartEquity].every(Number.isFinite))return 0;
 const initial=Math.round(s.settings.initialSol*1e9),observed=Math.floor(walletBalance*1e9+1e-6),lamports=observed-Math.round(s.cashSol*1e9);
 if(walletBalance<0||!Number.isSafeInteger(observed)||!Number.isSafeInteger(initial)||!Number.isSafeInteger(initial+Math.max(0,lamports)))return 0;
 s.settings.orderSol=walletOrderSol(walletBalance);s.settings.smallOrderSol=s.settings.orderSol;s.settings.orderFraction=WALLET_ORDER_FRACTION;s.settings.sizingVersion=WALLET_SIZING_VERSION;
 if(lamports===0)return 0;
 const amount=lamports/1e9;
 s.cashSol=observed/1e9;
 if(amount>0){s.settings.initialSol=(initial+lamports)/1e9;s.peakEquity+=amount;s.dayStartEquity+=amount;}else s.externalWithdrawnSol=(s.externalWithdrawnSol??0)-amount;
 s.capitalAllocations??=[];s.capitalAllocations.push({at:now,amountSol:amount,initialSol:s.settings.initialSol});s.capitalAllocations=s.capitalAllocations.slice(-200);
 event(s,amount>0?`Đã bổ sung ${amount.toFixed(6)} SOL vào vốn ứng dụng; không ghi thành lợi nhuận.`:`Ví giảm ${(-amount).toFixed(6)} SOL ngoài sổ lệnh; ghi dòng tiền ra, không tính là lỗ giao dịch.`,now);return amount;
}
export function nextOwnerOrder(s,feed,walletBalance){
 if(s.pending)return null;
 const now=Date.now(),validSol=Number.isFinite(feed.solUsd)&&feed.solUsd>0;
 if(validSol&&(!feed.solUsdEstimated&&now-feed.updatedAt<=s.settings.maxPriceAgeMs||s.positions.length&&s.positions.every(p=>{const q=feed.markets.find(m=>m.mint===p.mint)?.exitQuote;return q?.mint===p.mint&&q.rawAmount===p.rawQuantity&&q.checkedAt<=now&&now-q.checkedAt<=s.settings.maxPriceAgeMs&&Number.isFinite(q.netSol);})))riskCheck(s,feed.markets,feed.solUsd);
 const exhausted=o=>(s.orderAttempts?.[o.side+':'+(o.mint??o.recipient)+':'+(o.amount??'fixed')]??0)>=s.settings.maxRetries+1;
 if(s.liquidating&&s.positions.length){for(const p of s.positions){const o=ownerExit(s,p.mint,1,'drawdown-close',feed.solUsd);if(!exhausted(o))return o;}s.running=false;return null;}
 for(const p of s.positions){
  const m=feed.markets.find(m=>m.mint===p.mint)??{mint:p.mint,priceUsd:p.lastPriceUsd};
  if(Number.isFinite(m.priceUsd)&&m.priceUsd>0)p.lastPriceUsd=m.priceUsd;
  const fresh=m.updatedAt<=now&&now-m.updatedAt<=s.settings.maxPriceAgeMs;
  const plan=exitPlan(p,m,validSol?feed.solUsd:p.entrySolUsd,{...s.settings,requireExecutableQuote:true},now);
  if(plan&&(fresh||['max-hold','time-stop','emergency-risk','stop-loss'].includes(plan.reason))){const o=ownerExit(s,p.mint,plan.fraction,plan.reason,feed.solUsd);if(!exhausted(o))return {...o,exitTrigger:plan.trigger};}
 }
 if(feed.error||!feed.updatedAt||now-feed.updatedAt>s.settings.maxPriceAgeMs||feed.updatedAt>now||!validSol||s.buyPaused||s.buyBlockedReason)return null;
 const payout=s.recoveryRequired?null:profitOrder(s,walletBalance);if(payout)return payout;
 if(!walletOrderSol(walletBalance,CURVE_RULES.orderFraction)||s.halted||positionLimitReached(s.positions.length,s.settings)||s.positions.some(p=>!feed.markets.some(m=>m.mint===p.mint)))return null;
 const m=feed.markets.map(m=>({...m,...rankMarket(m,s.settings)})).filter(m=>m.eligible&&canFundBuy(s.cashSol,walletOrderSol(walletBalance,isPumpCurve(m)?CURVE_RULES.orderFraction:WALLET_ORDER_FRACTION),s.settings.reserveSol)&&walletOrderSol(walletBalance,isPumpCurve(m)?CURVE_RULES.orderFraction:WALLET_ORDER_FRACTION)>0&&!s.positions.some(p=>p.mint===m.mint)&&!(s.cooldowns[m.mint]>Date.now())&&!exhausted({side:'BUY',venue:isPumpCurve(m)?'pumpfun':'pumpswap',mint:m.mint})).sort((a,b)=>b.score-a.score)[0];
 const size=m?walletOrderSol(walletBalance,isPumpCurve(m)?CURVE_RULES.orderFraction:WALLET_ORDER_FRACTION):0;
 return m?{side:'BUY',venue:isPumpCurve(m)?'pumpfun':'pumpswap',mint:m.mint,symbol:m.symbol,reason:'autonomous-low-cap',orderSol:size,minContextSlot:s.lastReceiptSlot,strategyVersion:STRATEGY_VERSION,riskSol:size*s.settings.stopLossPct/100}:null;
}
export function ownerExit(s,mint,fraction=1,reason='owner-exit',solUsd){
 const p=s.positions.find(p=>p.mint===mint);if(!p)throw Error('Không có vị thế do ứng dụng quản lý.');
 const raw=BigInt(p.rawQuantity),amount=fraction>=1?raw:raw*BigInt(Math.floor(fraction*1e9))/1000000000n;
 if(amount<=0n)throw Error('Lượng bán quá nhỏ.');
 return {side:'SELL',venue:p.venue,mint,symbol:p.symbol,amount:amount.toString(),closeEmptyInput:amount===raw,reason};
}
export function applyOwnerReceipt(s,pending,result){
 if(s.recordedSignatures.includes(result.signature)){s.pending=null;return false;}
 const {intent}=pending;let trainingPosition=null;
 if(result.status==='confirmed'&&intent.side==='PROFIT'){
  if(result.recipient!==PROFIT_RECIPIENT||result.amountLamports!==intent.amount||!Number.isFinite(result.feeSol)||result.feeSol<0||result.feeSol>.00001||!Number.isFinite(result.solDelta)||Math.abs(result.solDelta+Number(intent.amount)/1e9+result.feeSol)>1e-10)throw Error('Receipt chuyển lãi không khớp.');
  const amount=Number(result.amountLamports)/1e9;s.cashSol+=result.solDelta;s.withdrawnSol=(s.withdrawnSol??0)+amount;s.payoutFeesSol=(s.payoutFeesSol??0)+result.feeSol;
  s.payouts??=[];s.payouts.unshift({signature:result.signature,amountSol:amount,feeSol:result.feeSol,recipient:PROFIT_RECIPIENT,at:Date.now()});s.payouts=s.payouts.slice(0,500);event(s,'Đã xác nhận chuyển lãi '+amount.toFixed(6)+' SOL về '+PROFIT_RECIPIENT);
 }else if(result.status==='confirmed'){
  const raw=BigInt(result.tokenDelta),quantity=Number(raw<0n?-raw:raw)/10**result.decimals,m={mint:intent.mint,symbol:intent.symbol,priceUsd:intent.priceUsd,liquidityUsd:intent.entryLiquidityUsd,volume5mUsd:intent.entryVolume5mUsd,pairAddress:intent.pairAddress};
  if(intent.side==='BUY'){
   recordBuy(s,m,intent.solUsd,{quantity,costSol:-result.solDelta,priceUsd:Number(intent.amount??BUY_LAMPORTS)/1e9*intent.solUsd/quantity,rawQuantity:raw.toString(),decimals:result.decimals,signature:result.signature,networkFeeSol:result.feeSol??null},Date.now(),intent.reason,'live');
   trainingPosition=s.positions.find(p=>p.mint===intent.mint);trainingPosition.trainingEntry={signature:result.signature,features:intent.entryFeatures??null};trainingPosition.venue=intent.venue??'pumpswap';if(intent.venue==='pumpfun'){trainingPosition.priceBasis='sol';trainingPosition.entryPriceSol=-result.solDelta/quantity;trainingPosition.peakPriceSol=trainingPosition.entryPriceSol;trainingPosition.lastPriceSol=trainingPosition.entryPriceSol;trainingPosition.nextTakeProfitPriceSol=null;}
  }
  else{
   const p=s.positions.find(p=>p.mint===intent.mint);if(!p||raw>=0n||-raw>BigInt(p.rawQuantity))throw Error('Lượng bán không khớp sổ vị thế của ứng dụng.');
   trainingPosition=p;const remaining=BigInt(p.rawQuantity)+raw;
   recordSell(s,m,intent.solUsd,{quantity,proceedsSol:result.solDelta,priceUsd:result.solDelta*intent.solUsd/quantity,rawBalance:remaining.toString(),closed:remaining===0n,signature:result.signature,networkFeeSol:result.feeSol??null},Date.now(),intent.reason,'live');
  }
 }else if(result.status==='failed'){
  if(!Number.isFinite(result.feeSol)||result.feeSol<0)throw Error('Không xác minh được phí giao dịch thất bại.');
  s.expenses??=[];s.expenses.unshift({signature:result.signature,feeSol:result.feeSol,kind:'failed-'+intent.side,at:Date.now()});s.expenses=s.expenses.slice(0,500);
  s.cashSol-=result.feeSol;s.realizedNetSol=(s.realizedNetSol??0)-result.feeSol;event(s,'Giao dịch thất bại trên Solana; đã ghi nhận phí mạng.');
 }else if(result.status==='expired')event(s,'Giao dịch hết hạn; không ghi nhận mua/bán và không tự gửi thay thế.');
 else return false;
 if(result.status==='confirmed'&&['BUY','SELL'].includes(intent.side)){
  const trade=s.trades.find(t=>t.signature===result.signature);
  if(trade){trainingPosition.trainingFills??=[];trainingPosition.trainingFills.push({signature:trade.signature,side:trade.side,at:trade.at,sol:trade.sol,pnlSol:trade.pnlSol??null,networkFeeSol:trade.networkFeeSol,reason:trade.reason});enqueueTrainingRecord(s,trade,intent,trainingPosition,result);}
 }
 if(Number.isSafeInteger(result.slot))s.lastReceiptSlot=Math.max(s.lastReceiptSlot??0,result.slot);
 s.recordedSignatures.push(result.signature);s.recordedSignatures=s.recordedSignatures.slice(-1000);s.pending=null;if(s.haltKind==='drawdown'&&!s.positions.length){s.liquidating=false;s.running=false;}return result.status==='confirmed';
}
