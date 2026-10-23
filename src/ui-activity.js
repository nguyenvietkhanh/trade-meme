import {TRADE_RULES} from './desk-rules.js';
import {paperOrderSol} from './paper-sizing.js';
import {paperPortfolioAdmission} from './paper-portfolio.js';
export function paperPendingView(order,now=Date.now()){
 if(!order)return null;const ageSeconds=Number.isFinite(order.decisionAt)?Math.max(0,Math.floor((now-order.decisionAt)/1000)):0,waitSeconds=Number.isFinite(order.readyAt)?Math.max(0,Math.ceil((order.readyAt-now)/1000)):0,attempts=Number.isSafeInteger(order.attempts)?Math.max(0,order.attempts):0,lastErrorCode=/^[A-Z0-9_]{1,32}$/.test(order.lastErrorCode??'')?order.lastErrorCode:null;
 const detail=attempts?`thử lại ${attempts}/${TRADE_RULES.maxRetries}${lastErrorCode?' · '+lastErrorCode:''}`:waitSeconds?`chờ độ trễ ${waitSeconds}s`:'đang lấy quote mới sau độ trễ';
 return {id:order.id,side:order.side,mint:order.mint,reason:order.reason,decisionAt:order.decisionAt,ageSeconds,waitSeconds,attempts,lastErrorCode,label:`${order.side} mô phỏng · ${ageSeconds}s${attempts?' · thử lại '+attempts+'/'+TRADE_RULES.maxRetries:''}`,message:`${order.side} …${String(order.mint).slice(-6)} · đã chờ ${ageSeconds}s · ${detail}.`};
}
// Ephemeral display telemetry. No trading state, provider requests or credentials.
export class UiActivity{
 constructor({clock=Date.now}={}){this.clock=clock;this.next=0;this.active=new Map();this.recent=[];}
 async track(kind,mint,work){const row={id:++this.next,kind,mint,startedAt:this.clock()};this.active.set(row.id,row);let status='done';try{return await work();}catch(e){status='error';throw e;}finally{this.active.delete(row.id);this.recent.unshift({...row,finishedAt:this.clock(),status});this.recent=this.recent.slice(0,20);}}
 snapshot(){const now=this.clock();this.recent=this.recent.filter(r=>now-r.finishedAt<10000);return {active:[...this.active.values()].map(r=>({...r})),recent:this.recent.map(r=>({...r}))};}
}
export function explainPaperStatus(state,feed,rankings,valuation,now=Date.now()){
 const reasons=new Map();for(const r of rankings)for(const reason of r.primaryReasons??[])reasons.set(reason,(reasons.get(reason)??0)+1);
 const topBlockers=[...reasons].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([reason,count])=>({reason,count}));
 const base={topBlockers,lastEvaluationAt:state.lastEvaluationAt??null,eligible:rankings.filter(r=>r.eligible).length,totalEvaluated:state.decisionStats?.totalEvaluated??0,staleExitQuotes:valuation.staleMints.length};
 const result=(phase,message)=>({...base,phase,message});
 if(!state.running)return result('paused','BUY mô phỏng đang tạm dừng; vẫn theo dõi vị thế để thoát.');
 if(!feed.updatedAt||feed.error||now-feed.updatedAt>30000||feed.updatedAt>now)return result('feed-unavailable','Dữ liệu thị trường thiếu/cũ hoặc API lỗi; chưa tạo lệnh mô phỏng.');
 if(state.pending)return result('pending',paperPendingView(state.pending,now).message);
 if(!feed.markets.length)return result('empty-feed','Nguồn thị trường chưa trả về token PumpSwap.');
 const portfolio=paperPortfolioAdmission(state,{now});if(!portfolio.allowed)return {...result(portfolio.code==='INSUFFICIENT_CASH'?'insufficient-cash':'portfolio',portfolio.message),portfolio};
 if(!base.eligible)return result('filtered','Bot vẫn quét; chưa có token qua đủ điều kiện. Xem các lý do bị chặn bên dưới.');
 const available=rankings.filter(m=>m.eligible&&!state.positions.some(p=>p.mint===m.mint)&&!(state.cooldowns[m.mint]>now));
 if(!available.length)return result('held-or-cooldown','Các token đạt bộ lọc đã có vị thế hoặc đang trong thời gian tránh mua lại.');
 const size=paperOrderSol(state);if(!size)return result('insufficient-cash','Không đủ SOL mô phỏng sau khoản dự phòng và đệm chi phí.');
 const sized=available.filter(m=>Math.abs((m.evidence?.probeSol??0)-size)<=1e-9);if(!sized.length)return result('sizing-proof','Đang chờ quote vòng khớp cỡ lệnh SOL mô phỏng hiện tại.');
 const deep=sized.filter(m=>size<=(m.evidence?.quoteReserveSol??0)*.02);if(!deep.length)return result('order-depth',`Cỡ lệnh ${size.toFixed(3)} SOL vượt 2% dự trữ SOL thực của các pool đạt điểm; chưa BUY.`);
 if(deep.every(m=>!Number.isInteger(m.evidence?.decimals)))return result('mint-data','Chưa có số decimals đã xác minh để tính lượng token; chưa BUY.');
 return result('checking-entry','Có ứng viên đạt bộ lọc; đang kiểm tra cỡ lệnh, dự trữ pool và quote trước khi khớp.');
}
