import {TRADE_RULES as DEFAULTS,positionLimitReached,clearLegacyDailyHalt,clearLegacyLossPause,clearLegacyDrawdownHalt,CURVE_RULES} from './desk-rules.js';
import {rankMarket} from './strategy.js';
import {recordEvaluation} from './scanner.js';
export const SOL = 'So11111111111111111111111111111111111111112';
export const PROFILE='staged-03sol-v1';
export {TRADE_RULES as DEFAULTS} from './desk-rules.js';

export function freshState(now=Date.now()){
 return {version:2,profile:PROFILE,strategy:'autonomous',watchlist:[],decisions:[],decisionStats:{evaluated:0,bought:0,rejected:0},cashSol:DEFAULTS.initialSol,positions:[],trades:[],events:[],curve:[],running:false,automationRequested:false,halted:null,day:new Date(now).toISOString().slice(0,10),dayStartEquity:DEFAULTS.initialSol,peakEquity:DEFAULTS.initialSol,maxDrawdownObservedPct:0,cooldowns:{},settings:{...DEFAULTS}};
}
export function equity(state,markets,solUsd,now=Date.now()){
 return (state.withdrawnSol??0)+(state.externalWithdrawnSol??0)+state.cashSol+state.positions.reduce((sum,p)=>sum+(()=>{const m=markets.find(m=>m?.mint===p.mint),q=m?.exitQuote;return q?.mint===p.mint&&typeof p.rawQuantity==='string'&&q.rawAmount===p.rawQuantity&&Number.isFinite(q.netSol)&&q.checkedAt<=now&&now-q.checkedAt<=state.settings.maxPriceAgeMs?q.netSol:p.priceBasis==='sol'?p.quantity*(p.lastPriceSol??p.entryPriceSol):p.quantity*(m?.priceUsd??p.lastPriceUsd)/solUsd;})(),0);
}
export function event(state,message,now=Date.now()){state.events.unshift({at:now,message});state.events=state.events.slice(0,200);}
export function assertMarket(m,now,s,exit=false){
 if(!m||!Number.isFinite(m.priceUsd)||m.priceUsd<=0||!Number.isFinite(m.updatedAt)||now-m.updatedAt>s.maxPriceAgeMs||now<m.updatedAt)throw Error('Giá không khả dụng hoặc đã cũ.');
 if(!exit&&(!Number.isFinite(m.liquidityUsd)||!Number.isFinite(m.volume24hUsd)||m.liquidityUsd<s.minLiquidityUsd||m.volume24hUsd<s.minVolume24hUsd))throw Error('Thanh khoản hoặc khối lượng thấp hơn giới hạn.');
}
export function riskCheck(state,markets,solUsd,now=Date.now()){
 if(!Number.isFinite(solUsd)||solUsd<=0)throw Error('Thiếu giá SOL.');
 const value=equity(state,markets,solUsd,now),day=new Date(now).toISOString().slice(0,10);
 clearLegacyDailyHalt(state);clearLegacyLossPause(state);clearLegacyDrawdownHalt(state);
 if(day!==state.day){state.day=day;state.dayStartEquity=value;}
 state.peakEquity=Math.max(state.peakEquity,value);
 state.maxDrawdownObservedPct=Math.max(state.maxDrawdownObservedPct??0,state.peakEquity>0?(1-value/state.peakEquity)*100:0);


 return value;
}
export function buy(state,m,solUsd,now=Date.now(),source='manual'){
 riskCheck(state,[m],solUsd,now);if(state.halted)throw Error(state.halted);assertMarket(m,now,state.settings);
 const s=state.settings,size=source.startsWith('auto-score:')?rankMarket(m,s,now).orderSol:s.orderSol,cost=size+s.feeSol;
 if(positionLimitReached(state.positions.length,s))throw Error('Đã đủ số vị thế cho phép.');
 if(state.positions.some(p=>p.mint===m.mint))throw Error('Đã có vị thế token này.');
 if(state.cooldowns[m.mint]>now)throw Error('Token đang khóa mua lại trong 24 giờ.');
 if(state.cashSol-cost<s.reserveSol)throw Error('Không đủ SOL ngoài khoản dự phòng.');
 const fill=m.priceUsd*(1+s.slippageBps/10000),quantity=size*solUsd/fill;
 recordBuy(state,m,solUsd,{quantity,costSol:cost,priceUsd:fill},now,source);
}
export function recordBuy(state,m,solUsd,fill,now=Date.now(),reason='manual',mode='paper'){
 const {quantity,costSol:cost,priceUsd}=fill;
 if(!(quantity>0&&cost>0&&priceUsd>0))throw Error('Fill mua không hợp lệ.');
 state.cashSol-=cost;
 state.positions.push({mint:m.mint,pairAddress:m.pairAddress,symbol:m.symbol,quantity,initialQuantity:quantity,costSol:cost,initialCostSol:cost,costUsd:cost*solUsd,initialCostUsd:cost*solUsd,entrySolUsd:solUsd,entryPriceUsd:priceUsd,lastPriceUsd:m.priceUsd,entryLiquidityUsd:m.liquidityUsd,entryVolume5mUsd:m.volume5mUsd,peakPriceUsd:priceUsd,maxGainPct:0,openedAt:now,phase:'initial',realizedPnlSol:0,recoveredUsd:0,runnerSteps:0,nextTakeProfitPriceUsd:null,rawQuantity:fill.rawQuantity,decimals:fill.decimals});
 state.trades.unshift({side:'BUY',mode,mint:m.mint,symbol:m.symbol,venue:m.venue??m.dexId??null,strategyVersion:state.strategyVersion??null,quantity,priceUsd,sol:cost,at:now,reason,signature:fill.signature,networkFeeSol:fill.networkFeeSol??null});state.trades=state.trades.slice(0,500);
 event(state,`${mode==='live'?'MAINNET':'MÔ PHỎNG'} • Mua ${m.symbol}: ${cost.toFixed(5)} SOL`,now);
}
export function netPositionUsd(p,m,solUsd,s){return Math.max(0,p.quantity*m.priceUsd*(1-s.slippageBps/10000)-s.feeSol*solUsd);}
export function exitPlan(p,m,solUsd,s,now=Date.now()){
 if(p.venue==='pumpfun')return curveExitPlan(p,m,now);
 if(p.priceBasis==='sol'){
  // A receipt contains SOL cost, not historical SOL/USD. Keep recovered positions in SOL.
  const q=m.exitQuote,fresh=q?.mint===p.mint&&q.rawAmount===p.rawQuantity&&Number.isFinite(q.netSol)&&q.netSol>=0&&q.checkedAt<=now&&now-q.checkedAt<=s.maxPriceAgeMs;
  const priceSol=fresh?q.netSol/p.quantity:p.lastPriceSol;
  const normalized={...p,priceBasis:undefined,entryPriceUsd:p.entryPriceSol,peakPriceUsd:p.peakPriceSol,lastPriceUsd:priceSol,initialCostUsd:p.initialCostSol,nextTakeProfitPriceUsd:p.nextTakeProfitPriceSol};
  const plan=exitPlan(normalized,{...m,priceUsd:priceSol},1,{...s,dustUsd:solUsd>0?s.dustUsd/solUsd:0},now);
  p.peakPriceSol=normalized.peakPriceUsd;p.maxGainPct=normalized.maxGainPct;if(fresh){p.lastPriceSol=priceSol;p.lastQuoteAt=q.checkedAt;}
  if(plan?.reason==='time-stop'&&p.observedSince&&now-p.observedSince<s.timeStopMs)return null;
  // Stale native marks must not trigger price-based exits. Time/emergency rules still apply.
  return fresh||['max-hold','time-stop','emergency-risk'].includes(plan?.reason)?plan:null;
 }
 const quote=m.exitQuote,quoted=quote&&quote.mint===p.mint&&typeof p.rawQuantity==='string'&&quote.rawAmount===p.rawQuantity&&Number.isFinite(quote.netSol)&&quote.netSol>=0&&quote.checkedAt<=now&&now-quote.checkedAt<=s.maxPriceAgeMs;
 const trailing=p.peakPriceUsd/p.entryPriceUsd>=8?20:p.peakPriceUsd/p.entryPriceUsd>=4?25:s.runnerTrailingPct;
 const value=quoted?quote.netSol*solUsd:netPositionUsd(p,m,solUsd,s);
 p.peakPriceUsd=Math.max(p.peakPriceUsd??p.entryPriceUsd,m.priceUsd);
 p.maxGainPct=Math.max(p.maxGainPct??0,(m.priceUsd/p.entryPriceUsd-1)*100);
 p.peakLiquidityUsd=Math.max(p.peakLiquidityUsd??p.entryLiquidityUsd??0,Number.isFinite(m.liquidityUsd)?m.liquidityUsd:0);
 if((Number.isFinite(p.entryLiquidityUsd)&&Number.isFinite(m.liquidityUsd)&&m.liquidityUsd<p.peakLiquidityUsd*.6)||m.evidence?.lpWithdrawn===true||m.evidence?.largeHolderDump===true||m.evidence?.sellSimulationOk===false)return {reason:'emergency-risk',fraction:1};
 if(p.phase==='runner'&&m.priceUsd/p.peakPriceUsd<=1-trailing/100+1e-12)return {reason:'runner-trailing',fraction:1};
 if((quoted||!s.requireExecutableQuote)&&value/solUsd<=p.costSol*(1-s.stopLossPct/100))return {reason:'stop-loss',fraction:1};
 if(now-p.openedAt>=s.maxHoldMs)return {reason:'max-hold',fraction:1};
 if(Number.isFinite(p.entryVolume5mUsd)&&Number.isFinite(m.volume5mUsd)&&m.volume5mUsd<p.entryVolume5mUsd*.3&&m.priceUsd<p.entryPriceUsd)return {reason:'volume-exhaustion',fraction:1};
 if(p.phase==='initial'&&now-p.openedAt>=s.timeStopMs&&p.maxGainPct<s.timeStopGainPct)return {reason:'time-stop',fraction:1};
 if(p.phase==='initial'&&value>=p.initialCostUsd*(1+s.takeProfitTriggerPct/100)){
  return {reason:'recover-capital',fraction:s.takeProfitSellFraction};
 }
 if(p.phase==='runner'){
  if(value<=s.dustUsd||p.quantity<=p.initialQuantity*s.minRunnerFraction)return {reason:'dust-close',fraction:1};
  if(m.priceUsd>=p.nextTakeProfitPriceUsd)return {reason:'runner-double',fraction:s.runnerSellFraction};
 }
 return null;
}
export function curveExitPlan(p,m,now=Date.now()){
 const q=m.exitQuote,fresh=q?.mint===p.mint&&q.rawAmount===p.rawQuantity&&Number.isFinite(q.netSol)&&q.netSol>=0&&q.checkedAt<=now&&now-q.checkedAt<=CURVE_RULES.maxQuoteAgeMs;
 if(fresh){p.lastQuoteAt=q.checkedAt;p.lastPriceSol=q.netSol/p.quantity;p.peakPriceSol=Math.max(p.peakPriceSol??p.entryPriceSol,p.lastPriceSol);p.maxGainPct=Math.max(p.maxGainPct??0,(p.lastPriceSol/p.entryPriceSol-1)*100);}
 p.peakLiquidityUsd=Math.max(p.peakLiquidityUsd??p.entryLiquidityUsd??0,Number.isFinite(m.liquidityUsd)?m.liquidityUsd:0);
 const plan=(reason,fraction)=>({reason,fraction,...(fresh?{trigger:{at:now,quoteCheckedAt:q.checkedAt,expectedNetSol:q.netSol*fraction,remainingRaw:p.rawQuantity,provider:q.provider??null}}:{})});
 if(Number.isFinite(m.liquidityUsd)&&m.liquidityUsd<p.peakLiquidityUsd*.6||m.creatorSoldRecently===true||m.evidence?.largeHolderDump===true||m.evidence?.sellSimulationOk===false)return plan('emergency-risk',1);
 if(fresh&&q.netSol<=p.costSol*.8)return plan('stop-loss',1);
 if(now-p.openedAt>=CURVE_RULES.maxHoldMs)return plan('max-hold',1);
 if(now-p.openedAt>=CURVE_RULES.timeStopMs&&(p.maxGainPct??0)<CURVE_RULES.timeStopGainPct)return plan('time-stop',1);
 if(!fresh)return null;
 const multiple=p.lastPriceSol/p.entryPriceSol,trailing=p.peakPriceSol/p.entryPriceSol>=8?20:p.peakPriceSol/p.entryPriceSol>=4?25:30;
 if(p.phase==='runner'&&p.lastPriceSol<=p.peakPriceSol*(1-trailing/100))return plan('runner-trailing',1);
 if(Number.isFinite(p.entryVolume5mUsd)&&Number.isFinite(m.volume5mUsd)&&m.volume5mUsd<p.entryVolume5mUsd*.3&&multiple<1)return plan('volume-exhaustion',1);
 if(p.phase==='initial'&&!p.earlyProfitTaken&&multiple>=1+CURVE_RULES.earlyTakeProfitPct/100)return plan('curve-early-profit',CURVE_RULES.earlySellFraction);
 if(p.phase==='initial'&&multiple>=1.8){const recovered=p.initialCostSol-p.costSol+p.realizedPnlSol,target=Math.max(0,p.initialCostSol*1.4-recovered);return plan('recover-capital',Math.min(1,Math.max(.000001,target/q.netSol)));}
 if(p.phase==='runner'&&p.quantity<=p.initialQuantity*DEFAULTS.minRunnerFraction)return plan('dust-close',1);
 if(p.phase==='runner'&&p.lastPriceSol>=p.nextTakeProfitPriceSol)return plan('runner-double',.5);
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
 clearLegacyLossPause(state);clearLegacyDrawdownHalt(state);
 const p=state.positions.find(p=>p.mint===m.mint&&(fill.positionId===undefined||p.paperPositionId===fill.positionId));if(!p)throw Error('Không có vị thế cho fill.');
 const fraction=fill.closed?1:Math.min(1,fill.quantity/p.quantity),quantity=p.quantity*fraction,proceeds=fill.proceedsSol,allocatedCost=p.costSol*fraction,allocatedUsd=p.costUsd*fraction;
 if(!(fraction>0&&fraction<=1&&proceeds>=0))throw Error('Fill bán không hợp lệ.');
 const pnlSol=proceeds-allocatedCost;
 state.realizedNetSol=(state.realizedNetSol??0)+pnlSol;state.cashSol+=proceeds;p.quantity-=quantity;p.costSol-=allocatedCost;p.costUsd-=allocatedUsd;p.realizedPnlSol+=pnlSol;p.recoveredUsd+=proceeds*solUsd;
 if(fill.rawBalance!==undefined){p.rawQuantity=fill.rawBalance;p.quantity=Number(fill.rawBalance)/10**p.decimals;}
 if(reason==='curve-early-profit')p.earlyProfitTaken=true;
 if(fraction===1){state.lossStreak=p.realizedPnlSol<0?(state.lossStreak??0)+1:0;state.positions=state.positions.filter(x=>x!==p);state.cooldowns[p.mint]=now+(reason==='stop-loss'?state.settings.reentryMs:state.settings.coarseCooldownMs);}
 else if(reason==='recover-capital'){p.phase='runner';p.peakPriceUsd=m.priceUsd;p.nextTakeProfitPriceUsd=p.entryPriceUsd*2**Math.max(1,Math.floor(Math.log2(m.priceUsd/p.entryPriceUsd))+1);}
 else if(reason==='runner-double'){p.runnerSteps++;p.nextTakeProfitPriceUsd=p.entryPriceUsd*2**Math.max(1,Math.floor(Math.log2(m.priceUsd/p.entryPriceUsd))+1);}
 if(p.priceBasis==='sol'&&fraction<1&&['recover-capital','runner-double'].includes(reason)){
  const priceSol=fill.proceedsSol/fill.quantity;
  if(reason==='recover-capital')p.peakPriceSol=priceSol;
  p.nextTakeProfitPriceSol=p.entryPriceSol*2**Math.max(1,Math.floor(Math.log2(priceSol/p.entryPriceSol))+1);p.nextTakeProfitPriceUsd=null;p.peakPriceUsd=null;
 }
 state.trades.unshift({side:'SELL',mode,mint:p.mint,symbol:p.symbol,venue:m.venue??p.venue??null,strategyVersion:state.strategyVersion??null,quantity,priceUsd:fill.priceUsd,sol:proceeds,pnlSol,at:now,reason,fraction,closed:fraction===1,positionPnlSol:fraction===1?p.realizedPnlSol:null,initialRiskSol:p.initialCostSol*state.settings.stopLossPct/100,networkFeeSol:fill.networkFeeSol??null,remainingQuantity:p.quantity,signature:fill.signature});state.trades=state.trades.slice(0,500);
 state.decisions.unshift({at:now,mint:p.mint,symbol:p.symbol,score:null,action:'SELL',reason});state.decisions=state.decisions.slice(0,300);
 event(state,`${mode==='live'?'MAINNET':'MÔ PHỎNG'} • Bán ${(fraction*100).toFixed(2)}% ${p.symbol} (${reason}): P/L ${pnlSol.toFixed(5)} SOL`,now);
}
export function tick(state,markets,solUsd,now=Date.now()){
 riskCheck(state,markets,solUsd,now);
 for(const [mint,until] of Object.entries(state.cooldowns))if(until<=now)delete state.cooldowns[mint];
 for(const p of [...state.positions]){
  const m=markets.find(m=>m.mint===p.mint);if(!m||now-m.updatedAt>state.settings.maxPriceAgeMs||now<m.updatedAt)continue;
  p.lastPriceUsd=m.priceUsd;
  if(state.running){const plan=state.liquidating?{reason:'drawdown-close',fraction:1}:exitPlan(p,m,solUsd,state.settings,now);if(plan)sell(state,m,solUsd,now,plan.reason,plan.fraction);}
 }
 if(state.running&&!state.halted){
  state.lastEvaluationAt=now;
  const candidates=markets.map(m=>({market:m,rank:rankMarket(m,state.settings,now)})).sort((a,b)=>b.rank.score-a.rank.score);
  for(const {market:m,rank} of candidates){
   let action='SKIP',reason=rank.primaryReasons.join('; ');
   if(rank.eligible){try{buy(state,m,solUsd,now,`auto-score:${rank.score}`);action='BUY';reason=`Điểm ${rank.score}/100 · momentum +${m.change5mPct}% · mua/bán ${m.buys5m}/${m.sells5m}`;state.decisionStats.bought++;}catch(e){reason=e.message;}}
   recordEvaluation(state,{at:now,mint:m.mint,symbol:m.symbol,score:rank.score,action,reason});
  }
 }
 if(state.liquidating&&!state.positions.length){state.liquidating=false;state.running=false;}
 const value=riskCheck(state,markets,solUsd,now);state.curve.push({at:now,equitySol:value});state.curve=state.curve.slice(-1440);return value;
}
