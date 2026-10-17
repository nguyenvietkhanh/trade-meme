import {SCREENER_RULES as R,TRADE_RULES as T} from './desk-rules.js';
const finite=Number.isFinite;
const pct=v=>finite(v)&&v>=0&&v<=100;
const clamp=v=>Number.isFinite(v)?Math.max(0,Math.min(1,v)):0;
/** Pure decision module: never signs or executes. Unknown is never treated as safe. */
export function rankMarket(m,s=T,now=Date.now()){
 const reasons=[],red_flags=[];
 const fail=(ok,code,text)=>{if(!ok){red_flags.push(code);reasons.push(text);}};
 const e=m.evidence??{},fresh=t=>finite(t)&&t<=now&&now-t<=s.maxPriceAgeMs;
 fail(fresh(m.updatedAt),'STALE_MARKET','Giá cũ, thiếu hoặc ở tương lai');
 fail(typeof m.mint==='string'&&m.mint.length>0&&typeof m.pairAddress==='string'&&m.pairAddress.length>0,'MISSING_IDENTITY','Thiếu địa chỉ token/pool');
 fail(finite(m.priceUsd)&&m.priceUsd>0,'INVALID_PRICE','Thiếu giá token hợp lệ');
 fail(m.dexId==='pumpswap','UNSUPPORTED_DEX','Chỉ hỗ trợ thực thi pool PumpSwap');
 fail(finite(m.solUsd)&&m.solUsd>0&&finite(m.liquidityUsd)&&m.liquidityUsd>=s.minLiquiditySol*m.solUsd,'LOW_LIQUIDITY','Thanh khoản chưa đạt 20 SOL hoặc thiếu giá SOL');
 fail(m.valuationSource==='marketCap'&&finite(m.valuationUsd)&&m.valuationUsd>=s.minMarketCapUsd&&m.valuationUsd<=s.maxMarketCapUsd,'INVALID_MARKET_CAP','Cần market cap thật trong $10k–$5m; FDV không thay thế market cap');
 const depth=m.liquidityUsd/m.valuationUsd;
 fail(finite(depth)&&depth>=.05,'THIN_DEPTH','Thanh khoản dưới 5% vốn hóa');
 const age=now-m.pairCreatedAt;
 fail(finite(m.pairCreatedAt)&&m.pairCreatedAt>0&&age>=s.minPairAgeMs&&age<=s.maxPairAgeMs,'POOL_AGE','Tuổi pool phải từ 15 phút đến 24 giờ');
 fail(finite(m.volume5mUsd)&&m.volume5mUsd>=0&&finite(m.volume1hUsd)&&m.volume1hUsd>0&&m.volume1hUsd>=m.volume5mUsd&&finite(m.volume24hUsd)&&m.volume24hUsd>=m.volume1hUsd,'INCONSISTENT_VOLUME','Volume thiếu hoặc mâu thuẫn giữa các khung');
 fail(Number.isSafeInteger(m.buys5m)&&m.buys5m>=R.minBuys,'LOW_RECENT_ACTIVITY','Cần ít nhất 10 lượt mua trong 5 phút');
 const counts=[m.buys5m,m.sells5m,m.buys1h,m.sells1h];
 fail(counts.every(v=>Number.isSafeInteger(v)&&v>=0)&&m.buys1h>=m.buys5m&&m.sells1h>=m.sells5m&&m.buys1h+m.sells1h>=100,'LOW_ACTIVITY','Cần ít nhất 100 giao dịch/1h và số lệnh nhất quán');
 fail(e.mint===m.mint&&e.pairAddress===m.pairAddress&&fresh(e.checkedAt),'MISSING_SAFETY_EVIDENCE','Thiếu kiểm chứng an toàn mới cho đúng token/pool');
 fail(e.mintRevoked===true&&e.freezeRevoked===true,'ACTIVE_OR_UNKNOWN_AUTHORITY','Quyền mint/freeze chưa được xác nhận đã revoke');
 fail(pct(e.lpSecuredPct)&&e.lpSecuredPct>=90,'LP_UNVERIFIED','LP burn/lock chưa được xác nhận đạt 90%');
 fail(e.probeSol===s.orderSol&&e.sellSimulationOk===true&&pct(e.sellTaxPct)&&e.sellTaxPct<=5&&pct(e.sellImpactPct)&&e.sellImpactPct<=3,'SELL_UNVERIFIED','Chưa mô phỏng bán thành công với thuế ≤5%, impact ≤3%');
 fail(pct(e.top10Pct)&&e.top10Pct<=30&&e.top10ExcludesPool===true,'HOLDER_CONCENTRATION','Top 10 (trừ pool) chưa được xác nhận ≤30%');
 fail(pct(e.devPct)&&e.devPct<=5,'DEV_CONCENTRATION','Tỷ lệ ví dev chưa được xác nhận ≤5%');
 fail(e.bundleChecked===true&&pct(e.bundleSniperPct)&&e.bundleSniperPct<=10,'BUNDLE_UNVERIFIED','Bundle/sniper chưa kiểm chứng hoặc nắm trên 10%');
 const trades=m.buys5m+m.sells5m,unique=e.uniqueBuyers5m;
 fail(e.buyersWindowComplete===true&&Number.isSafeInteger(unique)&&unique>=0&&unique<=m.buys5m&&unique/Math.max(1,m.buys5m)>=.25,'WASH_TRADING','Thiếu số ví mua riêng biệt hoặc tỷ lệ ví mua/lượt mua <25%');
 // A 1:1 aggregate by itself cannot prove wash trading. Require corroborating wallet data.
 fail(!(trades<20&&m.volume5mUsd/Math.max(1,trades)>m.liquidityUsd*.25),'SUSPICIOUS_TICKET_VOLUME','Volume quá lớn so với số lệnh và thanh khoản');
 fail(e.washTradingDetected===false,'WASH_UNVERIFIED','Chưa kiểm chứng giao dịch giả');
 fail(finite(e.roundTripCostPct)&&e.roundTripCostPct>=0&&e.roundTripCostPct<=s.maxRoundTripCostPct,'EXCESSIVE_OR_UNKNOWN_COST','Tổng phí/trượt giá khứ hồi chưa được xác nhận ≤8%');
 fail(e.riskWarningsChecked===true&&Array.isArray(e.criticalWarnings)&&e.criticalWarnings.length===0,'RUG_WARNINGS','Cảnh báo rủi ro nghiêm trọng hoặc thiếu kiểm tra');
 fail(m.signalConfirmed===true,'UNCONFIRMED_SIGNAL','Chờ xác nhận tín hiệu qua các lần quét');
 fail(finite(m.change1hPct)&&m.change1hPct>0&&m.change1hPct<=150&&finite(e.change15mPct)&&e.change15mPct<=100&&e.change15mPct>=0,'CHASE_RISK','Thiếu giá 15m hoặc tăng quá 100%/15m, 150%/1h');
 const acceleration=m.volume1hUsd>m.volume5mUsd?m.volume5mUsd/((m.volume1hUsd-m.volume5mUsd)/11):0;
 const ratio=m.buys5m/Math.max(1,m.sells5m),hourRatio=m.buys1h/Math.max(1,m.sells1h);
 const higherLows=e.higherLows===true;
 const growth=Number.isSafeInteger(e.holderCount)&&e.holderCount>0&&Number.isSafeInteger(e.previousHolderCount)&&e.previousHolderCount>0&&e.holderCount>e.previousHolderCount&&finite(e.previousHolderAt)&&e.previousHolderAt<e.checkedAt&&e.checkedAt-e.previousHolderAt>=30000&&e.checkedAt-e.previousHolderAt<=900000;
 fail(higherLows&&growth,'MISSING_TREND_HISTORY','Chưa có nến đáy cao hơn và lịch sử số holder tăng');
 fail(finite(m.change5mPct)&&m.change5mPct>=1&&m.change5mPct<=12&&acceleration>=1.2,'WEAK_MOMENTUM','Động lượng 5m hoặc tăng tốc volume chưa đạt');
 fail(ratio>=1.3&&ratio<=8&&hourRatio>1&&hourRatio<=8,'BUY_PRESSURE','Lực mua chưa nghiêng về mua hoặc quá cực đoan');
 const parts={momentum:(higherLows?10:0)+clamp(acceleration/3)*10+(m.change1hPct>0&&m.change1hPct<=80?10:0),holders:(growth?10:0)+(pct(e.top10Pct)?clamp((40-e.top10Pct)/20)*10:0)+(pct(e.devPct)?clamp((10-e.devPct)/5)*5:0),depth:finite(depth)?clamp(depth/.1)*20:0,buyPressure:ratio>=1.3&&ratio<=8&&hourRatio>1&&hourRatio<=8?clamp(unique/Math.max(1,m.buys5m)) *15:0,notChasing:finite(e.change15mPct)&&e.change15mPct>=0&&e.change15mPct<=100&&m.change1hPct<=150?10:0};
 const boostPenalty=m.boosted===true?5:0;
 const score=Math.max(0,Math.min(100,Math.round(Object.values(parts).reduce((a,b)=>a+b,0)-boostPenalty)));
 fail(score>=R.minScore,'LOW_SCORE','Điểm tổng dưới 70/100');
 return {score,eligible:reasons.length===0,reasons,red_flags,scoreParts:parts,boostPenalty,volumeAcceleration:acceleration,buyShare:trades?m.buys5m/trades:0};
}
export function decideMarket(m,s=T,now=Date.now()){
 const r=rankMarket(m,s,now);
 return {action:r.eligible?'BUY':'SKIP',token:m.mint??'',sell_percent:0,score:r.score,reasons:r.eligible?['Đạt toàn bộ điều kiện bắt buộc','Điểm tín hiệu ≥70/100']:r.reasons.slice(0,3),red_flags:r.red_flags};
}
