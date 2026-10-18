import {TRADE_RULES as T,TREND_RULES,ENTRY_EXCLUDED_MINTS} from './desk-rules.js';
const finite=Number.isFinite,pct=v=>finite(v)&&v>=0&&v<=100;
const clamp=v=>finite(v)?Math.max(0,Math.min(1,v)):0;
const MAJOR_NAMES=new Set(['SOL','SOLANA','WSOL','USDC','USD COIN','USDT','TETHER','BONK','WIF','DOGWIFHAT','POPCAT']);
// Known large-token identities are deliberately outside the low-cap entry universe.
export function coarseMarket(m,s=T,now=Date.now()){
 m=m&&typeof m==='object'?m:{};const reasons=[],red_flags=[];
 const fail=(ok,code,text)=>{if(!ok){red_flags.push(code);reasons.push(text);}};
 fail(m.blacklisted!==true,'BLACKLISTED_MINT','Mint đã vào blacklist giả mạo token lớn');
 fail(!ENTRY_EXCLUDED_MINTS.includes(m.mint),'OWNER_EXCLUDED_MINT','Mint chủ ví chỉ định tránh mua theo mẫu H4');
 fail(m.dexId==='pumpswap','UNSUPPORTED_DEX','Không phải pool PumpSwap');
 fail(finite(m.valuationUsd)&&m.valuationUsd>=s.minMarketCapUsd&&m.valuationUsd<=s.maxMarketCapUsd&&(['marketCap','pump-fdv'].includes(m.valuationSource)),'INVALID_MARKET_CAP',`Vốn hóa ngoài $${s.minMarketCapUsd.toLocaleString('en-US')}–$${s.maxMarketCapUsd.toLocaleString('en-US')} hoặc thiếu; FDV chỉ dùng mint đuôi pump`);
 fail(m.valuationSource!=='pump-fdv'||String(m.mint??'').endsWith('pump'),'INVALID_FDV_FALLBACK','Không cho FDV thay market cap với mint khác đuôi pump');
 fail(![m.symbol,m.name].some(x=>MAJOR_NAMES.has(String(x??'').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'').trim().toUpperCase())),'MAJOR_TOKEN_OR_IMPERSONATOR','Tên/symbol thuộc token lớn; không mua bản trùng tên trong tập low-cap');
 return {eligible:!reasons.length,reasons,red_flags};
}
/** Deterministic six-stage analyst. Missing optional score data earns half, mandatory safety stays closed. */
export function rankMarket(m,s=T,now=Date.now()){
 m=m&&typeof m==='object'&&!Array.isArray(m)?m:{};
 const coarse=coarseMarket(m,s,now);
 const reasons=[...coarse.reasons],red_flags=[...coarse.red_flags];
 const fail=(ok,code,text)=>{if(!ok){red_flags.push(code);reasons.push(text);}};
 const e=m.evidence??{},fresh=t=>finite(t)&&t<=now&&now-t<=s.maxPriceAgeMs;
 fail(fresh(m.updatedAt),'STALE_MARKET','Dữ liệu quá 30 giây hoặc không hợp lệ');
 fail(typeof m.mint==='string'&&m.mint.length>0&&typeof m.pairAddress==='string'&&m.pairAddress.length>0,'MISSING_IDENTITY','Thiếu mint/pool');
 fail(finite(m.priceUsd)&&m.priceUsd>0,'INVALID_PRICE','Thiếu giá hợp lệ');
 // Missing optional Dex quote reserves should reach RPC verification, never pass BUY by assumption.
 fail(m.liquidityQuoteSol==null||finite(m.liquidityQuoteSol)&&m.liquidityQuoteSol>=20,'LOW_QUOTE_LIQUIDITY','Dự trữ quote DexScreener dưới 20 SOL hoặc không hợp lệ');
 const depth=m.liquidityUsd/m.valuationUsd;
 fail(finite(depth)&&depth>=.03,'THIN_DEPTH','Tổng thanh khoản dưới 3% vốn hóa');
 const counts=[m.buys5m,m.sells5m,m.buys1h,m.sells1h];
 fail(counts.every(v=>Number.isSafeInteger(v)&&v>=0)&&m.buys5m>=8&&m.buys5m+m.sells5m>=15&&m.buys1h+m.sells1h>=80&&m.buys1h>=m.buys5m&&m.sells1h>=m.sells5m,'LOW_ACTIVITY','Cần ≥8 mua/5m, ≥15 lệnh/5m, ≥80 lệnh/1h, số liệu nhất quán');
 fail(finite(m.change1hPct)&&m.change1hPct<=150&&finite(m.change5mPct)&&m.change5mPct>=-8,'DUMP_OR_CHASE','Giá đang xả dưới −8%/5m hoặc tăng quá 150%/1h');
 fail(finite(m.change5mPct)&&m.change5mPct>0&&finite(m.change1hPct)&&m.change1hPct>0,'NO_UPTREND','Chỉ mua khi M5 và H1 cùng tăng; không bắt nhịp hồi trong xu hướng giảm');
 const volumes=[m.volume5mUsd,m.volume1hUsd,m.volume24hUsd];
 fail(volumes.every(v=>v==null||finite(v)&&v>=0)&&!(finite(volumes[0])&&finite(volumes[1])&&volumes[0]>volumes[1])&&!(finite(volumes[1])&&finite(volumes[2])&&volumes[1]>volumes[2]),'INCONSISTENT_VOLUME','Volume âm hoặc mâu thuẫn');
 const roughEligible=reasons.length===0;
 const marketReasons=reasons.slice(coarse.reasons.length),safetyStart=reasons.length;
 fail(!m.verificationError,'VERIFICATION_PROVIDER_ERROR',m.verificationError);
 fail(e.mint===m.mint&&e.pairAddress===m.pairAddress&&fresh(e.checkedAt),'MISSING_SAFETY_EVIDENCE','Thiếu kiểm chứng an toàn mới, đúng mint/pool');
 const reserve=finite(m.liquidityQuoteSol)?m.liquidityQuoteSol:e.mint===m.mint&&e.pairAddress===m.pairAddress&&fresh(e.checkedAt)?e.quoteReserveSol:null;
 fail(finite(reserve)&&reserve>=20,'UNVERIFIED_QUOTE_RESERVE','Chưa xác minh dự trữ SOL thực của pool ≥20 SOL');
 fail(e.mintRevoked===true&&e.freezeRevoked===true,'ACTIVE_OR_UNKNOWN_AUTHORITY','Mint/freeze chưa xác nhận revoke');
 fail(e.tokenProgram==='spl-token'||e.tokenProgram==='spl-token-2022'&&e.extensionsSafe===true,'UNSAFE_TOKEN_PROGRAM','Token program hoặc extension chưa được kiểm tra');
 fail(pct(e.lpSecuredPct)&&e.lpSecuredPct>=90,'LP_UNVERIFIED','LP burn/lock chưa xác nhận ≥90%');
 fail(e.top10ExcludesPool===true&&pct(e.top10Pct)&&e.top10Pct<=35&&pct(e.largestHolderPct)&&e.largestHolderPct<=8,'HOLDER_CONCENTRATION','Top 10 trừ vault/curve phải ≤35%; mỗi ví ≤8%');
 fail(e.devPct==null||pct(e.devPct)&&e.devPct<=5,'DEV_CONCENTRATION','Creator nắm quá 5% hoặc dữ liệu sai');
 fail(e.riskWarningsChecked===true&&Array.isArray(e.criticalWarnings)&&e.criticalWarnings.length===0,'RUG_WARNINGS','Thiếu RugCheck hoặc có rủi ro nghiêm trọng');
 fail(e.roundTripQuoteOk===true&&e.probeSol===T.orderSol&&finite(e.roundTripLossPct)&&e.roundTripLossPct>=0&&e.roundTripLossPct<=6&&pct(e.buyImpactPct)&&e.buyImpactPct<=2&&pct(e.sellImpactPct)&&e.sellImpactPct<=2,'ROUND_TRIP_UNVERIFIED','Jupiter quote vòng 0,2 SOL chưa đạt hao hụt ≤6%, impact mỗi chiều ≤2%');
 const h4=e.h4Risk,h4Bound=h4&&typeof h4==='object'&&h4.mint===m.mint&&h4.pairAddress===m.pairAddress&&finite(h4.checkedAt)&&h4.checkedAt<=now;
 const h4Known=h4Bound&&now-h4.checkedAt<=TREND_RULES.h4MaxAgeMs&&['clear','reject'].includes(h4.state);
 const h4Rejected=h4Bound&&h4.state==='reject'&&now-h4.checkedAt<=TREND_RULES.h4RejectMemoryMs;
 fail(!h4Rejected,'H4_DUMP_PATTERN','H4 đỏ mạnh/râu trên dài và giá tụt sâu sau nhịp tăng vọt; bỏ qua mua mới');
 const safetyReasons=reasons.slice(safetyStart);
 fail(m.signalConfirmed===true,'UNCONFIRMED_SIGNAL','Chờ 2 lần quét liên tiếp cách 10–15 giây');
 const acceleration=finite(m.volume5mUsd)&&finite(m.volume1hUsd)&&m.volume1hUsd>m.volume5mUsd?m.volume5mUsd/((m.volume1hUsd-m.volume5mUsd)/11):null;
 const ratio=m.buys5m/Math.max(1,m.sells5m);
 const missing=[];
 const component=(key,known,max,calculate)=>{if(!known){missing.push(key);return max/2;}return Math.max(0,Math.min(max,calculate()));};
 const parts={
  momentum:component('momentum',finite(acceleration)&&finite(m.change5mPct),30,()=>20*clamp(acceleration/1.5)+(m.change5mPct>0&&m.change5mPct<=12?10:0)),
  flow:component('flow',counts.slice(0,2).every(Number.isSafeInteger),20,()=>ratio>=1.15&&ratio<=2.5?20:ratio>2.5&&ratio<=4?8:0),
  structure:component('structure',typeof e.higherLows==='boolean'&&finite(e.pullback30mPct)&&typeof e.greenCandleConfirmed==='boolean',20,()=>(e.higherLows?8:0)+(e.pullback30mPct>=10&&e.pullback30mPct<=30?8:0)+(e.greenCandleConfirmed?4:0)),
  depth:component('depth',finite(depth),15,()=>15*clamp(depth/.1)),
  holders:component('holders',pct(e.top10Pct)&&pct(e.largestHolderPct),10,()=>5*clamp((40-e.top10Pct)/20)+5*clamp((10-e.largestHolderPct)/5)),
  community:component('community',typeof m.hasProfile==='boolean',5,()=>m.hasProfile?5:0)
 };
 const trades=m.buys5m+m.sells5m;
 const oddVolume=finite(m.volume5mUsd)&&trades>0&&trades<30&&m.volume5mUsd/trades>m.liquidityUsd*.25;
 const washPenalty=(oddVolume?5:0)+(ratio>4?5:0),boostPenalty=m.boosted?5:0;
 const h4Penalty=h4Known?0:5;
 const score=Math.round(Math.max(0,Object.values(parts).reduce((a,b)=>a+b,0)-washPenalty-boostPenalty-h4Penalty));
 fail(score>=60,'LOW_SCORE','Điểm dưới 60/100');
 const blockingStage=!coarse.eligible?'discovery':!roughEligible?'market':safetyReasons.length?'safety':m.signalConfirmed!==true?'confirmation':score<60?'score':'ready';
 const primaryReasons=blockingStage==='discovery'?coarse.reasons:blockingStage==='market'?marketReasons:blockingStage==='safety'?safetyReasons:blockingStage==='confirmation'?['Chờ 2 lần quét liên tiếp cách 10–15 giây']:blockingStage==='score'?['Điểm dưới 60/100']:[];
 return {roughEligible,score,eligible:!reasons.length,reasons,primaryReasons,blockingStage,red_flags,scoreParts:parts,missingScoreData:missing,washPenalty,boostPenalty,h4Penalty,h4Status:h4Rejected?'reject':h4Known?h4.state:'unknown',volumeAcceleration:acceleration,buyShare:trades?m.buys5m/trades:0,orderSol:T.orderSol,coarseRejected:!coarse.eligible};
}
export function decideMarket(m,s=T,now=Date.now()){
 const r=rankMarket(m,s,now);
 return {action:r.eligible?'BUY':'SKIP',token:typeof m?.mint==='string'?m.mint:'',sell_percent:0,score:r.score,reasons:r.eligible?[`Đạt an toàn; ${r.score}/100`,`Cỡ lệnh ${r.orderSol} SOL`]:r.primaryReasons.slice(0,3),red_flags:r.red_flags};
}
