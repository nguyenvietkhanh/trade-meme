import {positionLimitReached,canFundBuy,walletOrderSol,CURVE_RULES,WALLET_ORDER_FRACTION} from './desk-rules.js';
import {isPumpCurve} from './venues.js';
import {SCAN_RULES} from './scanner.js';
import {rankMarket} from './strategy.js';
export function diagnose(state,feed,rankings,now=Date.now()){
 const eligible=rankings.filter(m=>m.eligible);
 const held=new Set(state.positions.map(p=>p.mint));
 const actionable=eligible.filter(m=>!held.has(m.mint)&&!(state.cooldowns[m.mint]>now));
 const reasons=new Map();
 const stages={discovery:0,market:0,safety:0,confirmation:0,score:0,ready:0};
 for(const m of rankings){if(Object.hasOwn(stages,m.blockingStage))stages[m.blockingStage]++;for(const reason of m.primaryReasons??m.reasons)reasons.set(reason,(reasons.get(reason)??0)+1);}
 const s=state.settings;
 let phase,message;
 if(state.halted){phase='risk-halt';message=state.halted;}
 else if(feed.error||!feed.updatedAt||now-feed.updatedAt>s.maxPriceAgeMs){phase='waiting-data';message=feed.error||'Chờ dữ liệu giá mới trước khi xét lệnh.';}
 else if(!state.running){phase=state.automationRequested?'starting':'paused';message=state.automationRequested?'Đang chờ vòng quét đầu tiên để tự bật.':'Bot đang tạm dừng; chưa tự xét mua/bán.';}
 else if(positionLimitReached(state.positions.length,s)){phase='position-limit';message=`Đã đủ ${s.maxPositions} vị thế; tiếp tục theo dõi điều kiện bán.`;}
 else if(state.cashSol-s.orderSol-s.feeSol<s.reserveSol){phase='reserve';message='Giữ khoản SOL dự phòng; chưa đủ ngân sách cho lệnh mua mới.';}
 else if(!rankings.length){phase='empty-market';message='Đã kết nối nhưng nguồn khám phá chưa trả về token Solana để xét lệnh.';}
 else if(!eligible.length){phase='waiting-signal';message=`Bot đang quét ${rankings.length} token; chưa có token đạt toàn bộ điều kiện mua.`;}
 else if(!actionable.length){phase='cooldown';message='Token đạt bộ lọc đã có vị thế hoặc đang nghỉ 30 phút sau lần bán trước.';}
 else{phase='ready';message=`Có ${actionable.length} token đạt bộ lọc; sẽ kiểm tra ngân sách và an toàn thực thi trong vòng quét.`;}
 return {phase,message,candidates:rankings.length,eligible:eligible.length,actionable:actionable.length,stages,scanIntervalMs:SCAN_RULES.intervalMs,scanCycleLimit:SCAN_RULES.cycleLimit,lastEvaluationAt:state.lastEvaluationAt??null,topBlockers:[...reasons].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([reason,count])=>({reason,count}))};
}

/** Owner-only explanation. This function never clears risk limits or creates an order. */
export function diagnoseOwnerEntry(s,feed,balance,now=Date.now()){
 const result=(phase,message)=>({phase,message,at:now});
 if(s.pending)return result('pending','Đang đối soát giao dịch; chưa gửi lệnh mới.');
 if(s.positions.some(p=>p.exitBlocked))return result('exit-blocked','Có vị thế hết lượt thử SELL và vẫn còn token. Dừng BUY; xem cảnh báo thoát lệnh để thử lại sau khi kiểm tra.');
 if(!s.running)return result('paused','Bot chưa bật; dữ liệu quét vẫn tiếp tục cập nhật.');
 if(s.halted)return result('risk-halt',s.halted);
 if(s.buyPaused)return result('buy-paused','BUY đang tạm dừng; vẫn quản lý SELL.');
 if(s.buyBlockedReason||s.buyCircuitOpen)return result('execution-blocked',s.buyBlockedReason??'BUY bị khóa do lỗi thực thi liên tiếp; kiểm tra lỗi rồi bật lại thủ công.');
 if(feed.error||!feed.updatedAt||feed.updatedAt>now||now-feed.updatedAt>s.settings.maxPriceAgeMs||!(feed.solUsd>0))return result('waiting-data','Chưa đủ dữ liệu thị trường mới để mua.');
 if(!Number.isFinite(balance))return result('rpc-unavailable','RPC chưa đọc được số dư ví; không thể kiểm tra ngân sách mua.');
 if(positionLimitReached(s.positions.length,s.settings))return result('position-limit','Đã đủ số vị thế; tiếp tục theo dõi điều kiện bán.');
 const eligible=feed.markets.map(m=>({...m,...rankMarket(m,s.settings,now)})).filter(m=>m.eligible);
 if(!eligible.length)return result('waiting-signal','Chưa có token qua hết các tầng; xem số lượng bị chặn và lý do phía dưới.');
 const funded=eligible.filter(m=>{const size=walletOrderSol(balance,isPumpCurve(m)?CURVE_RULES.orderFraction:WALLET_ORDER_FRACTION);return size>0&&canFundBuy(s.cashSol,size,s.settings.reserveSol);});
 if(!funded.length)return result('reserve','Không đủ ngân sách cho cỡ lệnh và phí mà vẫn giữ 0,1 SOL dự phòng.');
 if(s.positions.some(p=>!feed.markets.some(m=>m.mint===p.mint)))return result('position-data','Chưa có dữ liệu cho toàn bộ vị thế đang mở.');
 const unheld=funded.filter(m=>!s.positions.some(p=>p.mint===m.mint));
 if(!unheld.length)return result('already-held','Token đạt điều kiện đã có vị thế; không mua trùng.');
 const ready=unheld.filter(m=>!(s.cooldowns[m.mint]>now));
 if(!ready.length)return result('reentry-lock','Token đạt điều kiện còn khóa mua lại sau giao dịch trước.');
 if(ready.every(m=>(s.orderAttempts?.['BUY:'+m.mint+':fixed']??0)>=s.settings.maxRetries+1))return result('retry-limit','Các token đạt điều kiện đã hết lượt thử lệnh; cần kiểm tra lỗi thực thi.');
 return result('ready',`Có ${ready.length} token đủ điều kiện; bộ ký sẽ kiểm tra giá và mô phỏng trước khi gửi.`);
}
