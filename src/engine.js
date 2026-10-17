import {TRADE_RULES as DEFAULTS} from './desk-rules.js';
import {rankMarket} from './strategy.js';
export const SOL = 'So11111111111111111111111111111111111111112';
export const PROFILE='staged-03sol-v1';
export {TRADE_RULES as DEFAULTS} from './desk-rules.js';

export function freshState(now=Date.now()){
 return {version:2,profile:PROFILE,strategy:'autonomous',watchlist:[],decisions:[],decisionStats:{evaluated:0,bought:0,rejected:0},cashSol:DEFAULTS.initialSol,positions:[],trades:[],events:[],curve:[],running:false,automationRequested:false,halted:null,day:new Date(now).toISOString().slice(0,10),dayStartEquity:DEFAULTS.initialSol,peakEquity:DEFAULTS.initialSol,maxDrawdownObservedPct:0,cooldowns:{},settings:{...DEFAULTS}};
}
export function equity(state,markets,solUsd){
 return (state.withdrawnSol??0)+state.cashSol+state.positions.reduce((sum,p)=>sum+p.quantity*(markets.find(m=>m?.mint===p.mint)?.priceUsd??p.lastPriceUsd)/solUsd,0);
}
export function event(state,message,now=Date.now()){state.events.unshift({at:now,message});state.events=state.events.slice(0,200);}
export function assertMarket(m,now,s,exit=false){
 if(!m||!Number.isFinite(m.priceUsd)||m.priceUsd<=0||!Number.isFinite(m.updatedAt)||now-m.updatedAt>s.maxPriceAgeMs||now<m.updatedAt)throw Error('Giá không khả dụng hoặc đã cũ.');
 if(!exit&&(!Number.isFinite(m.liquidityUsd)||!Number.isFinite(m.volume24hUsd)||m.liquidityUsd<s.minLiquidityUsd||m.volume24hUsd<s.minVolume24hUsd))throw Error('Thanh khoản hoặc khối lượng thấp hơn giới hạn.');
}
export function riskCheck(state,markets,solUsd,now=Date.now()){
 if(!Number.isFinite(solUsd)||solUsd<=0)throw Error('Thiếu giá SOL.');
 const value=equity(state,markets,solUsd),day=new Date(now).toISOString().slice(0,10);
 if(day!==state.day){state.day=day;state.dayStartEquity=value;}
 state.peakEquity=Math.max(state.peakEquity,value);
 state.maxDrawdownObservedPct=Math.max(state.maxDrawdownObservedPct??0,(1-value/state.peakEquity)*100);
 if(state.dayStartEquity-value>=state.settings.maxDailyLossSol||value<=state.peakEquity*(1-state.settings.maxDrawdownPct/100)){
  if(!state.halted)event(state,'Chạm giới hạn lỗ: khóa mua mới; tiếp tục quản lý cắt lỗ và chốt lời vị thế đang mở.',now);
  state.halted='Khóa mua mới do giới hạn lỗ/ngày hoặc drawdown; vẫn quản lý thoát lệnh.';
 }
 return value;
}
export function buy(state,m,solUsd,now=Date.now(),source='manual'){
 riskCheck(state,[m],solUsd,now);if(state.halted)throw Error(state.halted);assertMarket(m,now,state.settings);
 const s=state.settings,cost=s.orderSol+s.feeSol;
 if(state.positions.length>=s.maxPositions)throw Error('Đã đủ số vị thế cho phép.');
 if(state.positions.some(p=>p.mint===m.mint))throw Error('Đã có vị thế token này.');
 if(state.cooldowns[m.mint]>now)throw Error('Token đang trong thời gian nghỉ 30 phút.');
 if(state.cashSol-cost<s.reserveSol)throw Error('Không đủ SOL ngoài khoản dự phòng.');
 const fill=m.priceUsd*(1+s.slippageBps/10000),quantity=s.orderSol*solUsd/fill;
 recordBuy(state,m,solUsd,{quantity,costSol:cost,priceUsd:fill},now,source);
}
export function recordBuy(state,m,solUsd,fill,now=Date.now(),reason='manual',mode='paper'){
 const {quantity,costSol:cost,priceUsd}=fill;
 if(!(quantity>0&&cost>0&&priceUsd>0))throw Error('Fill mua không hợp lệ.');
 state.cashSol-=cost;
 state.positions.push({mint:m.mint,symbol:m.symbol,quantity,initialQuantity:quantity,costSol:cost,initialCostSol:cost,costUsd:cost*solUsd,initialCostUsd:cost*solUsd,entrySolUsd:solUsd,entryPriceUsd:priceUsd,lastPriceUsd:m.priceUsd,openedAt:now,phase:'initial',realizedPnlSol:0,recoveredUsd:0,runnerSteps:0,nextTakeProfitPriceUsd:null,rawQuantity:fill.rawQuantity,decimals:fill.decimals});
 state.trades.unshift({side:'BUY',mode,mint:m.mint,symbol:m.symbol,quantity,priceUsd,sol:cost,at:now,reason,signature:fill.signature,networkFeeSol:fill.networkFeeSol??null});state.trades=state.trades.slice(0,500);
 event(state,`${mode==='live'?'MAINNET':'MÔ PHỎNG'} • Mua ${m.symbol}: ${cost.toFixed(5)} SOL`,now);
}
export function netPositionUsd(p,m,solUsd,s){return Math.max(0,p.quantity*m.priceUsd*(1-s.slippageBps/10000)-s.feeSol*solUsd);}
export function exitPlan(p,m,solUsd,s){
 const value=netPositionUsd(p,m,solUsd,s);
 if(value<=p.costUsd*(1-s.stopLossPct/100))return {reason:'stop-loss',fraction:1};
 if(p.phase==='initial'&&value>=p.initialCostUsd*(1+s.takeProfitTriggerPct/100)){
  const target=p.initialCostUsd*(1+s.takeProfitRecoveryPct/100);
  const quantity=(target+s.feeSol*solUsd)/(m.priceUsd*(1-s.slippageBps/10000));
  return {reason:'recover-capital',fraction:Math.min(1,quantity/p.quantity)};
 }
 if(p.phase==='runner'){
  if(value<=s.dustUsd||p.quantity<=p.initialQuantity*s.minRunnerFraction)return {reason:'dust-close',fraction:1};
  if(m.priceUsd>=p.nextTakeProfitPriceUsd)return {reason:'runner-double',fraction:s.runnerSellFraction};
 }
 return null;
}
export function sell(state,m,solUsd,now=Date.now(),reason='manual',fraction=1){
 if(!Number.isFinite(solUsd)||solUsd<=0)throw Error('Thiếu giá SOL.');assertMarket(m,now,state.settings,true);
 const p=state.positions.find(p=>p.mint===m.mint);if(!p)throw Error('Không có vị thế.');
 if(!Number.isFinite(fraction)||fraction<=0||fraction>1)throw Error('Tỷ lệ bán không hợp lệ.');
 const s=state.settings;
 // A final sale removes token dust instead of halving it forever.
 if(p.quantity*(1-fraction)<=p.initialQuantity*s.minRunnerFraction)fraction=1;
 const quantity=p.quantity*fraction,fill=m.priceUsd*(1-s.slippageBps/10000),proceeds=Math.max(0,quantity*fill/solUsd-s.feeSol);
 recordSell(state,m,solUsd,{quantity,proceedsSol:proceeds,priceUsd:fill,closed:fraction===1},now,reason);
}
export function recordSell(state,m,solUsd,fill,now=Date.now(),reason='manual',mode='paper'){
 const p=state.positions.find(p=>p.mint===m.mint);if(!p)throw Error('Không có vị thế cho fill.');
 const fraction=fill.closed?1:Math.min(1,fill.quantity/p.quantity),quantity=p.quantity*fraction,proceeds=fill.proceedsSol,allocatedCost=p.costSol*fraction,allocatedUsd=p.costUsd*fraction;
 if(!(fraction>0&&fraction<=1&&proceeds>=0))throw Error('Fill bán không hợp lệ.');
 const pnlSol=proceeds-allocatedCost;
 state.realizedNetSol=(state.realizedNetSol??0)+pnlSol;state.cashSol+=proceeds;p.quantity-=quantity;p.costSol-=allocatedCost;p.costUsd-=allocatedUsd;p.realizedPnlSol+=pnlSol;p.recoveredUsd+=proceeds*solUsd;
 if(fill.rawBalance!==undefined){p.rawQuantity=fill.rawBalance;p.quantity=Number(fill.rawBalance)/10**p.decimals;}
 if(fraction===1){state.positions=state.positions.filter(x=>x!==p);state.cooldowns[p.mint]=now+1800000;}
 else if(reason==='recover-capital'){p.phase='runner';p.nextTakeProfitPriceUsd=m.priceUsd*state.settings.runnerMultiple;}
 else if(reason==='runner-double'){p.runnerSteps++;p.nextTakeProfitPriceUsd=m.priceUsd*state.settings.runnerMultiple;}
 state.trades.unshift({side:'SELL',mode,mint:p.mint,symbol:p.symbol,quantity,priceUsd:fill.priceUsd,sol:proceeds,pnlSol,at:now,reason,fraction,closed:fraction===1,positionPnlSol:fraction===1?p.realizedPnlSol:null,initialRiskSol:p.initialCostSol*state.settings.stopLossPct/100,networkFeeSol:fill.networkFeeSol??null,remainingQuantity:p.quantity,signature:fill.signature});state.trades=state.trades.slice(0,500);
 state.decisions.unshift({at:now,mint:p.mint,symbol:p.symbol,score:null,action:'SELL',reason});state.decisions=state.decisions.slice(0,300);
 event(state,`${mode==='live'?'MAINNET':'MÔ PHỎNG'} • Bán ${(fraction*100).toFixed(2)}% ${p.symbol} (${reason}): P/L ${pnlSol.toFixed(5)} SOL`,now);
}
export function tick(state,markets,solUsd,now=Date.now()){
 riskCheck(state,markets,solUsd,now);
 for(const [mint,until] of Object.entries(state.cooldowns))if(until<=now)delete state.cooldowns[mint];
 for(const p of [...state.positions]){
  const m=markets.find(m=>m.mint===p.mint);if(!m||now-m.updatedAt>state.settings.maxPriceAgeMs||now<m.updatedAt)continue;
  p.lastPriceUsd=m.priceUsd;
  if(state.running){const plan=exitPlan(p,m,solUsd,state.settings);if(plan)sell(state,m,solUsd,now,plan.reason,plan.fraction);}
 }
 if(state.running&&!state.halted){
  state.lastEvaluationAt=now;
  const candidates=markets.map(m=>({market:m,rank:rankMarket(m,state.settings,now)})).sort((a,b)=>b.rank.score-a.rank.score);
  for(const {market:m,rank} of candidates){
   let action='SKIP',reason=rank.reasons.join('; ');state.decisionStats.evaluated++;
   if(rank.eligible){try{buy(state,m,solUsd,now,`auto-score:${rank.score}`);action='BUY';reason=`Điểm ${rank.score}/100 · momentum +${m.change5mPct}% · mua/bán ${m.buys5m}/${m.sells5m}`;state.decisionStats.bought++;}catch(e){reason=e.message;}}
   if(action==='SKIP')state.decisionStats.rejected++;
   state.decisions.unshift({at:now,mint:m.mint,symbol:m.symbol,score:rank.score,action,reason});
  }state.decisions=state.decisions.slice(0,300);
 }
 const value=riskCheck(state,markets,solUsd,now);state.curve.push({at:now,equitySol:value});state.curve=state.curve.slice(-1440);return value;
}
