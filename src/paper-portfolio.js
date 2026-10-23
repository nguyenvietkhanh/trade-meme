import {paperMark} from './paper-identity.js';
import {paperCapitalSol,paperOrderSol,PAPER_SIZING} from './paper-sizing.js';
import {SCALP_EXIT_RULES} from './paper-scalp.js';

// Research/operational limits, not fitted profit-maximizing parameters.
// 10s freshness / 2s holding tick = 5 theoretical slots. One slot is reserved
// for contention/exit fills. This is admission control, never an exit guarantee.
export const PAPER_PORTFOLIO_POLICY=Object.freeze({version:'paper-portfolio-reservations-v2',riskPerTradeFraction:PAPER_SIZING.riskPerTradeFraction,maxOpenNominalRiskFraction:PAPER_SIZING.riskPerTradeFraction*5,monitorTickMs:2000,maxExitQuoteAgeMs:SCALP_EXIT_RULES.maxQuoteAgeMs,reservedMonitorSlots:1,telemetryWindowMs:300000});
const finite=Number.isFinite,round=n=>Math.round(n*1e9)/1e9;
const fresh=(at,now,age)=>finite(at)&&at<=now&&now-at<=age;
const p95=values=>values.length?[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1]:0;

export function recordExitSurveillance(state,{at,completedAt,ok,kind='monitor'},policy=PAPER_PORTFOLIO_POLICY){
 const t=state.exitSurveillance??={samples:[],lastAttemptAt:null,lastSuccessAt:null,lastFailureAt:null};
 const interval=kind==='monitor'&&finite(t.lastAttemptAt)&&at>t.lastAttemptAt?at-t.lastAttemptAt:null;
 t.samples=[...(Array.isArray(t.samples)?t.samples:[]).filter(x=>fresh(x.at,completedAt,policy.telemetryWindowMs)),{at:completedAt,latencyMs:Math.max(0,completedAt-at),intervalMs:interval,ok,kind}].slice(-64);
 t.sequence=(t.sequence??0)+1;if(kind==='monitor')t.lastAttemptAt=at;
 if(ok){t.lastSuccessAt=completedAt;t.lastSuccessSequence=t.sequence;}else{t.lastFailureAt=completedAt;t.lastFailureSequence=t.sequence;}
}

export function paperPortfolioAdmission(state,{now=Date.now(),orderSol=null,ignorePendingId=null}={}){
 orderSol??=paperOrderSol(state,{ignorePendingId});
 const p=PAPER_PORTFOLIO_POLICY,capital=paperCapitalSol(state),positions=state.positions??[],t=state.exitSurveillance??{};
 const samples=(Array.isArray(t.samples)?t.samples:[]).filter(x=>fresh(x.at,now,p.telemetryWindowMs));
 const cadence=Math.max(p.monitorTickMs,p95(samples.map(x=>x.intervalMs).filter(x=>finite(x)&&x>0)),p95(samples.map(x=>x.latencyMs).filter(x=>finite(x)&&x>=0)));
 const freshness=Math.min(p.maxExitQuoteAgeMs,...positions.map(x=>x.exitPolicy?.maxQuoteAgeMs??p.maxExitQuoteAgeMs));
 const slots=Math.max(0,Math.floor(freshness/cadence)),capacity=slots>p.reservedMonitorSlots?slots-p.reservedMonitorSlots:slots,rows=[];
 let valid=finite(capital)&&capital>0;
 for(const held of positions){
  const stop=held.exitPolicy?.stopLossPct??state.settings?.stopLossPct??SCALP_EXIT_RULES.stopLossPct;
  const ratio=held.costSol/held.initialCostSol,allocatedBuyFee=finite(held.modeledBuyFeeSol)&&finite(ratio)&&ratio>0?held.modeledBuyFeeSol*ratio:0;
  const principal=Math.max(0,held.costSol-allocatedBuyFee),mark=paperMark(state,held),quoteFresh=mark?.rawAmount===held.rawQuantity&&finite(mark.netSol)&&mark.netSol>=0&&fresh(mark.checkedAt,now,held.exitPolicy?.maxQuoteAgeMs??p.maxExitQuoteAgeMs);
  if(!finite(held.costSol)||held.costSol<=0||!finite(stop)||stop<=0||stop>=100||!finite(principal))valid=false;
  // A missing quote is unknown exposure: charge full principal, never zero risk.
  const nominal=principal*stop/100,currentLoss=quoteFresh?Math.max(0,held.costSol-mark.netSol):principal;
  rows.push({mint:held.mint,principalSol:round(principal),stopLossPct:stop,nominalRiskSol:round(nominal),riskChargedSol:round(Math.max(nominal,currentLoss)),quoteFresh,exitRequired:quoteFresh&&currentLoss>=nominal-1e-9});
 }
 const pending=[state.pending,...(state.pendingEntries??[]),...(state.pendingExits??[])].filter(o=>o?.side==='BUY'&&o.id!==ignorePendingId);
 const pendingPrincipal=pending.reduce((sum,o)=>sum+Number(o.amount)/1e9,0),pendingRisk=pending.reduce((sum,o)=>sum+Number(o.amount)/1e9*(o.exitPolicy?.stopLossPct??SCALP_EXIT_RULES.stopLossPct)/100,0);
 const openRisk=rows.reduce((sum,r)=>sum+r.riskChargedSol,0),budget=capital*p.maxOpenNominalRiskFraction,stop=SCALP_EXIT_RULES.stopLossPct;
 const requestedRisk=orderSol*stop/100,perTradeBudget=capital*p.riskPerTradeFraction;
 const principal=rows.reduce((sum,r)=>sum+r.principalSol,0);
 const base={policyVersion:p.version,accountingCapitalSol:capital,orderSol,perTradeRiskBudgetSol:round(perTradeBudget),requestedNominalRiskSol:round(requestedRisk),openRiskChargedSol:round(openRisk),pendingRiskSol:round(pendingRisk),openRiskBudgetSol:round(budget),remainingRiskBudgetSol:round(Math.max(0,budget-openRisk-pendingRisk)),operationalCapacity:capacity,measuredMonitorCadenceMs:cadence,quoteFreshnessMs:freshness,openPositions:positions.length,reservedEntries:pending.length,reservedPrincipalSol:round(pendingPrincipal),staleMints:rows.filter(r=>!r.quoteFresh).map(r=>r.mint),positions:rows,stress:{loss50PctSol:round(principal*.5),loss90PctSol:round(principal*.9),fullPrincipalSol:round(principal),note:'Simultaneous price shocks on remaining principal, before fees/impact. Not a stop guarantee or an account drawdown halt.'}};
 const result=(code,message)=>({...base,allowed:code==='READY',code,message});
 if(!valid||!finite(orderSol)||orderSol<0||(!finite(pendingRisk)||pendingRisk<0||!finite(pendingPrincipal)||pendingPrincipal<0))return result('PORTFOLIO_DATA_INVALID','Dữ liệu vốn/rủi ro danh mục chưa hợp lệ; chưa xét BUY mới.');
 if(pending.length&&!state.concurrentAgentEntries)return result('PENDING_ENTRY','Có BUY đang chờ; vốn và rủi ro đã được dành cho ý định đó.');
 if(!orderSol)return result('INSUFFICIENT_CASH','Không đủ vốn ngoài dự phòng và đệm chi phí.');
 if(rows.some(r=>!r.quoteFresh))return result('EXIT_QUOTES_STALE','Chưa mở thêm: quote thoát của vị thế đang giữ thiếu/cũ; vẫn tiếp tục kiểm tra SELL.');
 if(rows.some(r=>r.exitRequired))return result('EXIT_REQUIRED','Chưa mở thêm: có vị thế đã chạm mức rủi ro stop; ưu tiên xử lý SELL.');
 if(fresh(t.lastFailureAt,now,p.maxExitQuoteAgeMs)&&(t.lastFailureSequence??0)>(t.lastSuccessSequence??0))return result('EXIT_PROVIDER_UNAVAILABLE','Chưa mở thêm: lần đọc quote SELL gần nhất lỗi; chờ một quote thoát mới thành công.');
 if(positions.length+pending.length+1>capacity)return result('EXIT_CAPACITY',`Chưa mở thêm: ${positions.length} vị thế + ${pending.length} BUY dành vốn; sức chứa theo nhịp quote hiện tại ${capacity}, giữ lượt cho SELL.`);
 if(requestedRisk>perTradeBudget+1e-9||openRisk+pendingRisk+requestedRisk>budget+1e-9)return result('PORTFOLIO_RISK_LIMIT',`Chưa mở thêm: rủi ro dự kiến ${(openRisk+pendingRisk+requestedRisk).toFixed(6)} SOL vượt ngân sách ${budget.toFixed(6)} SOL.`);
 return result('READY','Danh mục còn ngân sách rủi ro và sức chứa theo dõi SELL; còn kiểm tra tín hiệu và quote theo cỡ lệnh.');
}
