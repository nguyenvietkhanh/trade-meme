import {SCAN_RULES} from './scanner.js';
export function diagnose(state,feed,rankings,now=Date.now()){
 const eligible=rankings.filter(m=>m.eligible);
 const held=new Set(state.positions.map(p=>p.mint));
 const actionable=eligible.filter(m=>!held.has(m.mint)&&!(state.cooldowns[m.mint]>now));
 const reasons=new Map();
 for(const m of rankings)for(const reason of m.reasons)reasons.set(reason,(reasons.get(reason)??0)+1);
 const s=state.settings;
 let phase,message;
 if(state.halted){phase='risk-halt';message=state.halted;}
 else if(feed.error||!feed.updatedAt||now-feed.updatedAt>s.maxPriceAgeMs){phase='waiting-data';message=feed.error||'Chờ dữ liệu giá mới trước khi xét lệnh.';}
 else if(!state.running){phase=state.automationRequested?'starting':'paused';message=state.automationRequested?'Đang chờ vòng quét đầu tiên để tự bật.':'Bot đang tạm dừng; chưa tự xét mua/bán.';}
 else if(state.positions.length>=s.maxPositions){phase='position-limit';message=`Đã đủ ${s.maxPositions} vị thế; tiếp tục theo dõi điều kiện bán.`;}
 else if(state.cashSol-s.orderSol-s.feeSol<s.reserveSol){phase='reserve';message='Giữ khoản SOL dự phòng; chưa đủ ngân sách cho lệnh mua mới.';}
 else if(!rankings.length){phase='empty-market';message='Đã kết nối nhưng nguồn khám phá chưa trả về token Solana để xét lệnh.';}
 else if(!eligible.length){phase='waiting-signal';message=`Bot đang quét ${rankings.length} token; chưa có token đạt toàn bộ điều kiện mua.`;}
 else if(!actionable.length){phase='cooldown';message='Token đạt bộ lọc đã có vị thế hoặc đang nghỉ 30 phút sau lần bán trước.';}
 else{phase='ready';message=`Có ${actionable.length} token đạt bộ lọc; sẽ kiểm tra ngân sách và an toàn thực thi trong vòng quét.`;}
 return {phase,message,candidates:rankings.length,eligible:eligible.length,actionable:actionable.length,scanIntervalMs:SCAN_RULES.intervalMs,scanCycleLimit:SCAN_RULES.cycleLimit,lastEvaluationAt:state.lastEvaluationAt??null,topBlockers:[...reasons].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([reason,count])=>({reason,count}))};
}
