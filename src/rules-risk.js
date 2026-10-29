import {rulesConfig} from './rules-config.js';
export function softRisk({lossStreak=0,dailyPnlSol=0,dayStartSol=0,peakSol=0,equitySol=0}={},p=rulesConfig()){
 const drawdown=peakSol>0?Math.max(0,1-equitySol/peakSol):0,factors=[],probeOnly=lossStreak>=p.lossStreakProbe||drawdown>p.drawdownProbe,minimal=drawdown>p.drawdownProbe;
 if(lossStreak>=p.lossStreakProbe)factors.push({reason:'loss_streak_probe',factor:p.lossStreakProbeFactor});else if(lossStreak>=p.lossStreakSoft)factors.push({reason:'loss_streak_soft',factor:p.lossStreakFactor});
 if(dayStartSol>0&&dailyPnlSol<-dayStartSol*p.dailyLossSoftFraction)factors.push({reason:'daily_loss_soft',factor:p.dailyLossFactor});if(drawdown>p.drawdownSoft)factors.push({reason:'drawdown',factor:p.drawdownFactor});
 return {factor:Math.max(.25,Math.min(1,...factors.map(r=>r.factor))),probeOnly,minimal,drawdown,factors,buyPaused:false};
}
export function riskSnapshot(state,equitySol,now,p=rulesConfig()){
 const day=new Date(now).toISOString().slice(0,10),prior=state.rulesRisk??{},flows=state.netDepositsSol??0,delta=flows-(prior.netDepositsSol??flows),peak=Math.max(equitySol,(prior.peakSol??equitySol)+delta),start=prior.day===day?Math.max(0,prior.dayStartSol+delta):equitySol;
 const closed=(state.trades??[]).filter(t=>(t.group??'SCALP')==='SCALP'&&t.side==='SELL'&&t.closed&&Number.isFinite(t.positionPnlSol)).sort((a,b)=>b.at-a.at);let lossStreak=0;for(const t of closed){if(t.positionPnlSol>0)break;if(t.positionPnlSol<0)lossStreak++;}
 const knownDailyPnl=(state.trades??[]).filter(t=>(t.group??'SCALP')==='SCALP'&&t.at>=Date.parse(day+'T00:00:00Z')&&['SELL','FEE'].includes(t.side)).reduce((n,t)=>n+(Number.isFinite(t.pnlSol)?t.pnlSol:0),0);
 const realized=state.realizedPnlByGroup?.SCALP??state.realizedPnlSol??0,startRealized=prior.day===day&&Number.isFinite(prior.dayStartRealizedPnl)?prior.dayStartRealizedPnl:realized-knownDailyPnl,dailyPnlSol=realized-startRealized;
 state.rulesRisk={day,dayStartSol:start,dayStartRealizedPnl:startRealized,baselineObservedAt:prior.day===day?prior.baselineObservedAt:now,peakSol:peak,netDepositsSol:flows};return {baselineObservedAt:state.rulesRisk.baselineObservedAt,lossStreak,dailyPnlSol,dayStartSol:start,peakSol:peak,equitySol,...softRisk({lossStreak,dailyPnlSol,dayStartSol:start,peakSol:peak,equitySol},p)};
}
export function openExposure(state,excludeId=null){return (state.positions??[]).reduce((n,p)=>n+(p.costSol??p.initialCostSol??0),0)+Object.values(state.orders??{}).filter(o=>o.id!==excludeId&&!o.terminal&&o.side==='BUY').reduce((n,o)=>n+Number(o.amount)/1e9,0);}
