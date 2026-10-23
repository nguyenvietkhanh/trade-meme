// Net trade attribution, not ten fictional independently funded portfolios.
// Realized drawdown is an absolute SOL decline of cumulative SELL PnL, and
// deliberately excludes unrealized exposure. Missing basis remains unknown.
export function updateAgentMetrics(g,f){
 if(f.side!=='SELL'||!Number.isFinite(f.pnlSol))return;
 g.realizedCurveSol=(g.realizedCurveSol??0)+f.pnlSol;
 g.realizedPeakSol=Math.max(g.realizedPeakSol??0,g.realizedCurveSol);
 g.maxRealizedDrawdownSol=Math.max(g.maxRealizedDrawdownSol??0,g.realizedPeakSol-g.realizedCurveSol);
 if(!f.closed||!Number.isFinite(f.positionPnlSol))return;
 if(Number.isFinite(f.initialCostSol)&&f.initialCostSol>0){
  g.costBasisClosedCount=(g.costBasisClosedCount??0)+1;
  g.closedEntryCostSol=(g.closedEntryCostSol??0)+f.initialCostSol;
  g.knownBasisPnlSol=(g.knownBasisPnlSol??0)+f.positionPnlSol;
 }
}
export function agentMetricView(g={}){
 const closed=g.closed??0,known=g.costBasisClosedCount??0;
 return {netMarginPct:closed>0&&known===closed&&g.closedEntryCostSol>0?g.knownBasisPnlSol/g.closedEntryCostSol*100:null,costBasisClosedCount:known,missingCostBasisCount:closed-known,maxRealizedDrawdownSol:g.maxRealizedDrawdownSol??0,drawdownNote:'Realized SELL PnL only, in SOL; excludes unrealized losses and is not standalone portfolio max drawdown.'};
}
