const names=['strict','relaxed','probe','legacy'];
const blank=()=>({entries:0,sellFills:0,closed:0,wins:0,losses:0,realizedAfterFeesSol:0,closedPnlAfterFeesSol:0,feeSol:0,closedReturnSumPct:0,closedWithPrincipal:0,unknownClosedPnl:0,stopExits:0,stopCompared:0,slippedPastStop:0,lossBeyondInitialStop:0,unverifiedEntries:0});
export function initTierDay(day,from){
 day.tierStats??={trackingFrom:from,beforeTracking:{entries:day.buys??0,closed:day.closed??0,wins:day.wins??0,realizedAfterFeesSol:day.realized??0,feeSol:day.fees??0},tiers:{}};return day.tierStats;
}
export function recordTierTrade(day,t){
 const data=initTierDay(day,t.at),tier=names.includes(t.entryTier)?t.entryTier:'legacy',r=data.tiers[tier]??=blank();r.feeSol+=t.feeSol??0;
 if(t.side==='BUY'){r.entries++;if(t.inputs?.scalp_metrics?.B?.unverified)r.unverifiedEntries++;return;}
 r.sellFills++;r.realizedAfterFeesSol+=t.pnlSol??0;
 if(t.reason==='stop-loss'){r.stopExits++;if(Number.isFinite(t.modeledExitPriceSol)&&Number.isFinite(t.activeStopPriceSol)){r.stopCompared++;if(t.modeledExitPriceSol<t.activeStopPriceSol-1e-12)r.slippedPastStop++;}}
 if(t.closed){r.closed++;if(Number.isFinite(t.positionPnlSol)){r.closedPnlAfterFeesSol+=t.positionPnlSol;if(t.positionPnlSol>0)r.wins++;else if(t.positionPnlSol<0)r.losses++;if(t.initialPrincipalSol>0){r.closedWithPrincipal++;r.closedReturnSumPct+=t.positionPnlSol/t.initialPrincipalSol*100;}}else r.unknownClosedPnl++;
  if(t.lossBeyondInitialStop===true)r.lossBeyondInitialStop++;
 }
}
export function tierReport(day){
 const d=day?.tierStats;return {trackingFrom:d?.trackingFrom??null,beforeTracking:d?.beforeTracking??null,rows:names.map(entryTier=>{const r={...blank(),...d?.tiers?.[entryTier]};return {entryTier,...r,winRate:r.closed?r.wins/r.closed:null,expectancyAfterFeesSol:r.closed&&!r.unknownClosedPnl?r.closedPnlAfterFeesSol/r.closed:null,meanReturnAfterFeesPct:r.closedWithPrincipal?r.closedReturnSumPct/r.closedWithPrincipal:null,stopSlippageRate:r.stopCompared?r.slippedPastStop/r.stopCompared:null};}),definitions:{expectancy:'sum of full position PnL after modeled fees / positions closed in period; partial legs are not extra wins',realized:'SELL PnL booked in this report period; already after fees, do not subtract feeSol again',stopSlippage:'modeled minimum-output exit unit price below active price stop; not measured live execution slippage',lossBeyondStop:'full position loss beyond the original stop percentage of BUY principal',prior:'pre-tracking totals stay separate; tiers/expectancy/stops are not guessed retrospectively'}};
}
export function formatTierReport(summary){
 const t=summary.tierReport;if(!t)return '';const fmt=n=>Number.isFinite(n)?n.toFixed(6):'unverified',pct=n=>Number.isFinite(n)?(n*100).toFixed(2)+'%':'—';
 const lines=['TIER / KẾT QUẢ PAPER SAU PHÍ',t.trackingFrom?'Đo tier từ: '+new Date(t.trackingFrom).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'Chưa có giao dịch trong kỳ đo tier.','Tier | BUY | Đóng | Win rate | PnL chốt SOL | Expectancy SOL/vị thế | TB % vốn | Dưới giá stop | Lỗ vượt SL gốc'];
 for(const r of t.rows)lines.push([r.entryTier,r.entries,r.closed,pct(r.winRate),fmt(r.realizedAfterFeesSol),fmt(r.expectancyAfterFeesSol),Number.isFinite(r.meanReturnAfterFeesPct)?r.meanReturnAfterFeesPct.toFixed(2)+'%':'—',r.stopCompared?r.slippedPastStop+'/'+r.stopCompared:'—',r.lossBeyondInitialStop].join(' | '));
 const prior=t.beforeTracking;if(prior&&(prior.entries||prior.closed))lines.push('Trước kỳ đo tier: '+prior.entries+' BUY, '+prior.closed+' vị thế đóng, PnL '+fmt(prior.realizedAfterFeesSol)+' SOL; không gán tier hồi tố.');
 const f=summary.funnelReport;if(f){lines.push('','FUNNEL / MINT DUY NHẤT','Đo funnel từ: '+(f.trackingFrom?new Date(f.trackingFrom).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'unverified')+'; phủ đủ kỳ báo cáo: '+f.coverageComplete,'Tầng | Mint đã xét | Mint từng PASS');for(const [stage,r]of Object.entries(f.stages))lines.push(stage+' | '+r.uniqueMints+' | '+r.uniquePassed);for(const [edge,r]of Object.entries(f.conversions??{}))lines.push(edge+': '+r.converted+'/'+r.entered+' = '+pct(r.rate));lines.push('Phạm vi: mint cùng kỳ có mặt ở cả hai tầng; không phải số lượt quét. Exact='+f.exact);}
 lines.push('Giá khớp/stop là mô phỏng theo minimum-output; không phải slippage giao dịch thật.');return lines.join('\n')+'\n';
}
