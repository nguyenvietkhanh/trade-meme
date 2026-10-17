import {rankMarket} from './strategy.js';
export const SOL = 'So11111111111111111111111111111111111111112';
export const DEFAULTS = Object.freeze({ initialSol: 0.3, reserveSol: 0.05, orderSol: 0.02, maxPositions: 3, stopLossPct: 10, takeProfitPct: 20, maxDrawdownPct: 15, maxDailyLossSol: 0.03, slippageBps: 150, feeSol: 0.0001, minLiquidityUsd: 100000, minVolume24hUsd: 100000, minPairAgeMs: 21600000, maxPriceAgeMs: 90000 });
export function freshState(now = Date.now()) {
  return {version: 1, strategy: 'autonomous', watchlist: [], decisions: [], decisionStats: {evaluated:0,bought:0,rejected:0}, cashSol: DEFAULTS.initialSol, positions: [], trades: [], events: [], curve: [], running: false, automationRequested:false, halted: null, day: new Date(now).toISOString().slice(0,10), dayStartEquity: DEFAULTS.initialSol, peakEquity: DEFAULTS.initialSol, maxDrawdownObservedPct:0, cooldowns: {}, settings: {...DEFAULTS}};
}
export function equity(state, markets, solUsd) {
  return state.cashSol + state.positions.reduce((sum,p) => sum + p.quantity * (markets.find(m=>m.mint===p.mint)?.priceUsd ?? p.lastPriceUsd) / solUsd,0);
}
export function event(state, message, now=Date.now()) {
  state.events.unshift({at:now,message}); state.events.length=Math.min(state.events.length,200);
}
export function assertMarket(market, now, settings) {
  if (!market || !Number.isFinite(market.priceUsd) || market.priceUsd<=0 || !Number.isFinite(market.updatedAt) || now-market.updatedAt>settings.maxPriceAgeMs || now<market.updatedAt) throw Error('Giá không khả dụng hoặc đã cũ.');
  if (!Number.isFinite(market.liquidityUsd) || !Number.isFinite(market.volume24hUsd) || market.liquidityUsd<settings.minLiquidityUsd || market.volume24hUsd<settings.minVolume24hUsd) throw Error('Thanh khoản hoặc khối lượng thấp hơn giới hạn.');
}
export function riskCheck(state, markets, solUsd, now=Date.now()) {
  if (!Number.isFinite(solUsd)||solUsd<=0) throw Error('Thiếu giá SOL.');
  const value=equity(state,markets,solUsd), day=new Date(now).toISOString().slice(0,10);
  if (day!==state.day) {state.day=day;state.dayStartEquity=value;}
  state.peakEquity=Math.max(state.peakEquity,value);
  state.maxDrawdownObservedPct=Math.max(state.maxDrawdownObservedPct??0,(1-value/state.peakEquity)*100);
  if (state.dayStartEquity-value>=state.settings.maxDailyLossSol || value<=state.peakEquity*(1-state.settings.maxDrawdownPct/100)) {
    if (!state.halted) event(state,'Chạm giới hạn lỗ: khóa lệnh mua mới, tiếp tục giám sát thoát lệnh.',now);
    state.halted='Đã chạm giới hạn lỗ/ngày hoặc drawdown. Cần đánh giá lại trước khi mua.';
  }
  return value;
}
export function buy(state, market, solUsd, now=Date.now(), source='manual') {
  riskCheck(state,[market],solUsd,now);
  if(state.halted) throw Error(state.halted);
  assertMarket(market,now,state.settings);
  const s=state.settings, cost=s.orderSol+s.feeSol;
  if(state.positions.length>=s.maxPositions) throw Error('Đã đủ số vị thế cho phép.');
  if(state.positions.some(p=>p.mint===market.mint)) throw Error('Đã có vị thế token này.');
  if(state.cooldowns[market.mint]>now) throw Error('Token đang trong thời gian nghỉ 30 phút.');
  if(state.cashSol-cost<s.reserveSol) throw Error('Không đủ SOL ngoài khoản dự phòng.');
  const fill=market.priceUsd*(1+s.slippageBps/10000), quantity=s.orderSol*solUsd/fill;
  state.cashSol-=cost;
  state.positions.push({mint:market.mint,symbol:market.symbol,quantity,costSol:cost,entryPriceUsd:fill,lastPriceUsd:market.priceUsd,openedAt:now});
  state.trades.unshift({side:'BUY',mode:'paper',mint:market.mint,symbol:market.symbol,quantity,priceUsd:fill,sol:cost,at:now,reason:source});
  state.trades=state.trades.slice(0,500);
  event(state,`MÔ PHỎNG • Mua ${market.symbol}: ${cost.toFixed(5)} SOL`,now);
}
export function sell(state, market, solUsd, now=Date.now(), reason='manual') {
  if(!Number.isFinite(solUsd)||solUsd<=0) throw Error('Thiếu giá SOL.');
  // Exits need fresh prices; liquidity filters must never prevent a risk exit.
  assertMarket({...market,liquidityUsd:Number.MAX_VALUE,volume24hUsd:Number.MAX_VALUE},now,state.settings);
  const p=state.positions.find(p=>p.mint===market.mint); if(!p) throw Error('Không có vị thế.');
  const fill=market.priceUsd*(1-state.settings.slippageBps/10000);
  const proceeds=Math.max(0,p.quantity*fill/solUsd-state.settings.feeSol);
  state.cashSol+=proceeds;state.positions=state.positions.filter(x=>x!==p);
  state.cooldowns[p.mint]=now+30*60*1000;
  state.trades.unshift({side:'SELL',mode:'paper',mint:p.mint,symbol:p.symbol,quantity:p.quantity,priceUsd:fill,sol:proceeds,pnlSol:proceeds-p.costSol,at:now,reason});
  state.trades=state.trades.slice(0,500);
  state.decisions.unshift({at:now,mint:p.mint,symbol:p.symbol,score:null,action:'SELL',reason});
  state.decisions=state.decisions.slice(0,300);
  event(state,`MÔ PHỎNG • Bán ${p.symbol} (${reason}): P/L ${(proceeds-p.costSol).toFixed(5)} SOL`,now);
}
export function tick(state,markets,solUsd,now=Date.now()) {
  riskCheck(state,markets,solUsd,now);
  for(const [mint,until] of Object.entries(state.cooldowns))if(until<=now)delete state.cooldowns[mint];
  for(const p of [...state.positions]) {
    const m=markets.find(m=>m.mint===p.mint); if(!m || now-m.updatedAt>state.settings.maxPriceAgeMs) continue;
    p.lastPriceUsd=m.priceUsd;
    const netSol=p.quantity*m.priceUsd*(1-state.settings.slippageBps/10000)/solUsd-state.settings.feeSol;
    const pnl=(netSol/p.costSol-1)*100;
    if(state.running && (state.halted || pnl<=-state.settings.stopLossPct || pnl>=state.settings.takeProfitPct)) sell(state,m,solUsd,now,state.halted?'risk-limit':pnl<0?'stop-loss':'take-profit');
  }
  if(state.running&&!state.halted) {
    state.lastEvaluationAt=now;
    const candidates=markets.map(m=>({market:m,rank:rankMarket(m,state.settings,now)})).sort((a,b)=>b.rank.score-a.rank.score);
    for(const {market:m,rank} of candidates) {
      let action='SKIP',reason=rank.reasons.join('; ');
      state.decisionStats.evaluated++;
      if(rank.eligible){
        try{buy(state,m,solUsd,now,`auto-score:${rank.score}`);action='BUY';reason=`Điểm ${rank.score}/100 · momentum +${m.change5mPct}% · mua/bán ${m.buys5m}/${m.sells5m}`;state.decisionStats.bought++;}
        catch(e){reason=e.message;}
      }
      if(action==='SKIP')state.decisionStats.rejected++;
      state.decisions.unshift({at:now,mint:m.mint,symbol:m.symbol,score:rank.score,action,reason});
    }
    state.decisions=state.decisions.slice(0,300);
  }
  const value=riskCheck(state,markets,solUsd,now);
  state.curve.push({at:now,equitySol:value});state.curve=state.curve.slice(-1440);
  return value;
}
