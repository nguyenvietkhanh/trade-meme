import {paperPortfolioAdmission} from './paper-portfolio.js';
import {rankPaperMarket} from './paper-policy.js';
import {comparePaperEntries,modeledNormalRoundTripPct} from './paper-scalp.js';

// Independent signal hypotheses, one shared 20 SOL book/executor. These are
// unoptimized research filters, not six independently funded backtests or LLMs.
export const PAPER_AGENT_VERSION='paper-signal-team-v1';
export const PAPER_AGENTS=Object.freeze([
 {id:'nova',name:'NOVA',role:'Continuation',description:'Đà tăng tiếp theo bộ v5; làm nhóm tham chiếu.',rule:'Bộ lọc v5 đầy đủ',color:'mint'},
 {id:'orin',name:'ORIN',role:'Buy pressure',description:'Thử lực mua mạnh hơn trên số đếm giao dịch; không coi đó là ví độc lập.',rule:'≥10 mua/5m, mua/bán ≥1,5; Δmua ≥2×max(1, Δbán)',color:'blue'},
 {id:'vela',name:'VELA',role:'Pool depth',description:'Thử pool có dự trữ SOL thực lớn hơn; vẫn kiểm tra impact theo cỡ lệnh.',rule:'Dự trữ SOL đã xác minh ≥50 SOL',color:'teal'},
 {id:'kade',name:'KADE',role:'Low cost',description:'Thử giảm lực cản do chi phí khứ hồi ước tính; không thay đổi mô hình phí.',rule:'Hao hụt quote vòng + haircut mô hình ≤4,5%',color:'amber'},
 {id:'rune',name:'RUNE',role:'Early momentum',description:'Thử phần tăng 5m vừa phải, sau xác nhận tiếp diễn v5.',rule:'5m từ +5% đến +25%',color:'rose'},
 {id:'zara',name:'ZARA',role:'Strong momentum',description:'Thử nhịp tăng mạnh có volume; không bỏ kiểm chứng an toàn hoặc chống đuổi giá.',rule:'5m từ +25% đến +60%; volume 5m ≥$1.500',color:'violet'}
].map(Object.freeze));
export function agentSignal(agentId,m,base=rankPaperMarket(m)){
 const agent=PAPER_AGENTS.find(a=>a.id===agentId);if(!agent)return {eligible:false,stage:'agent',reason:'Unknown agent'};
 let accepts=false;
 switch(agentId){
 case 'nova': accepts=true;break;
 case 'orin': accepts=m.buys5m>=10&&m.buys5m/Math.max(1,m.sells5m)>=1.5&&m.scalpSetup?.flowKnown===true&&m.scalpSetup.deltaBuys>=2*Math.max(1,m.scalpSetup.deltaSells);break;
 case 'vela': accepts=Number.isFinite(m.evidence?.quoteReserveSol)&&m.evidence.quoteReserveSol>=50;break;
 case 'kade': {const cost=modeledNormalRoundTripPct(m.evidence?.roundTripLossPct);accepts=Number.isFinite(cost)&&cost<=4.5;break;}
 case 'rune': accepts=Number.isFinite(m.change5mPct)&&m.change5mPct>=5&&m.change5mPct<=25;break;
 case 'zara': accepts=Number.isFinite(m.change5mPct)&&m.change5mPct>=25&&m.change5mPct<=60&&m.volume5mUsd>=1500;break;
 }
 return {eligible:base.eligible&&accepts,stage:!base.eligible?base.blockingStage:accepts?'ready':'hypothesis',reason:!base.eligible?base.primaryReasons.join('; '):accepts?'Đạt tín hiệu '+agent.name:agent.rule};
}
export function agentCandidates(state,markets,now=Date.now()){
 const rows=markets.map(m=>({m,r:rankPaperMarket(m,state.settings,now)})).filter(({m,r})=>r.eligible&&!state.positions.some(p=>p.mint===m.mint)&&!(state.cooldowns[m.mint]>now));
 const cursor=Number.isSafeInteger(state.agentCursor)?state.agentCursor%PAPER_AGENTS.length:0,out=[];
 for(let offset=0;offset<PAPER_AGENTS.length;offset++){
  const index=(cursor+offset)%PAPER_AGENTS.length,agent=PAPER_AGENTS[index];
  for(const row of rows.filter(({m,r})=>agentSignal(agent.id,m,r).eligible).sort((a,b)=>comparePaperEntries({...a.m,...a.r},{...b.m,...b.r})))out.push({...row,agent,index});
 }
 return out;
}
export function observeAgentSignals(state,markets,now=Date.now()){
 const ranked=markets.map(m=>({m,r:rankPaperMarket(m,state.settings,now)})),agents={};
 for(const agent of PAPER_AGENTS){const stages={};let eligible=0;for(const {m,r} of ranked){const d=agentSignal(agent.id,m,r);eligible+=Number(d.eligible);stages[d.stage]=(stages[d.stage]??0)+1;}agents[agent.id]={evaluated:ranked.length,eligible,stages};}
 state.agentSignals={version:PAPER_AGENT_VERSION,at:now,agents};return state.agentSignals;
}
export function recordAgentFill(state,trade){
 const id=trade.agentId??'legacy',stats=state.agentStats??={};
 const g=stats[id]??={fills:0,buys:0,sells:0,closed:0,wins:0,losses:0,realizedPnlSol:0,closedPnlSol:0,grossProfitSol:0,grossLossSol:0,modeledFeesSol:0};
 g.fills++;g[trade.side==='BUY'?'buys':'sells']++;g.modeledFeesSol+=trade.modeledFeeSol??0;
 if(trade.side==='SELL'){g.realizedPnlSol+=trade.pnlSol??0;if(trade.closed&&Number.isFinite(trade.positionPnlSol)){g.closed++;g.closedPnlSol+=trade.positionPnlSol;if(trade.positionPnlSol>0){g.wins++;g.grossProfitSol+=trade.positionPnlSol;}if(trade.positionPnlSol<0){g.losses++;g.grossLossSol-=trade.positionPnlSol;}}}
 g.lastFill={at:trade.at,side:trade.side,symbol:trade.symbol,mint:trade.mint,pnlSol:trade.pnlSol,reason:trade.reason};
}
export function paperAgentSnapshot(state,now=Date.now()){
 const admission=paperPortfolioAdmission(state,{now});
 return {admission,version:PAPER_AGENT_VERSION,sharedCapital:true,initialVirtualSol:20,comparison:'Attributed trades in one shared portfolio; not independently funded returns. Older unattributed fills remain legacy.',agents:PAPER_AGENTS.map(agent=>{
  const stats=state.agentStats?.[agent.id]??{},signal=state.agentSignals?.agents?.[agent.id]??null,positions=state.positions.filter(p=>p.agentId===agent.id),pending=[state.pending,...(state.pendingExits??[])].filter(o=>o?.agentId===agent.id),fresh=Number.isFinite(state.agentSignals?.at)&&state.agentSignals.at<=now&&now-state.agentSignals.at<=30000;
  return {...agent,stats:{...stats,closed:stats.closed??0,realizedPnlSol:stats.realizedPnlSol??0,expectancySol:stats.closed?stats.closedPnlSol/stats.closed:null,winRate:stats.closed?stats.wins/stats.closed:null,profitFactor:stats.grossLossSol>0?stats.grossProfitSol/stats.grossLossSol:null,insufficientSample:(stats.closed??0)<100},signal:fresh?signal:null,signalAt:state.agentSignals?.at??null,signalStale:!fresh,openPositions:positions.length,pending:pending.map(o=>({side:o.side,mint:o.mint})),phase:pending.some(o=>o.side==='SELL')?'exit-pending':pending.some(o=>o.side==='BUY')?'entry-pending':positions.length?'monitoring':!state.running?'paused':!fresh?'waiting-data':signal?.eligible?admission.allowed?'signal-ready':'portfolio-wait':'scanning'};
 }),legacyOpenPositions:state.positions.filter(p=>!p.agentId).length};
}
