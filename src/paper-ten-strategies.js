import {SCALP_EXIT_RULES} from './paper-scalp.js';

export const TEN_STRATEGY_VERSION='paper-ten-prompts-v1';
const min=60000,finite=Number.isFinite,clamp=n=>Math.max(0,Math.min(1,n));
const profiles=[
 ['nova','NOVA','Momentum M5',4,3000,60,12,15,30,8,3,5,10,.5],
 ['orin','ORIN','Volume spike',5,4000,65,10,12,25,6,3,4,8,.5],
 ['vela','VELA','Breakout 15m',6,4000,65,8,10,20,5,2,3,6,.5],
 ['kade','KADE','Scalp M1',3,5000,65,7,8,16,4,2,2,4,.5],
 ['rune','RUNE','Pullback',7,4000,65,9,10,20,6,4,3,10,.5],
 ['zara','ZARA','Token mới',5,5000,60,12,18,40,10,5,5,15,.4],
 ['atlas','ATLAS','Thanh khoản lớn',8,30000,65,10,15,35,8,4,4,12,.5],
 ['echo','ECHO','Dòng tiền ví',4,4000,65,8,10,22,5,3,3,8,.5],
 ['nyx','NYX','Bắt nảy M1',6,5000,70,10,12,28,7,3,3,8,.5],
 ['sage','SAGE','Chọn lọc cao',10,10000,80,7,8,18,4,3,2,8,.5]
];
export const TEN_AGENTS=Object.freeze(profiles.map(([id,name,role,seconds,liquidity,score,stop,tp1,tp2,trailing,stall,gain,hold,fraction],index)=>Object.freeze({
 id,name,role,description:role+' · luật riêng từ file prompt',rule:role+' · điểm ≥'+score+' · thanh khoản ≥$'+liquidity.toLocaleString('en-US'),color:['mint','blue','teal','amber','rose','violet','blue','rose','teal','amber'][index],
 scanIntervalMs:seconds*1000,
 entryRules:Object.freeze({version:TEN_STRATEGY_VERSION+':'+id,minLiquidityUsd:liquidity,minScore:score,maxDataAgeMs:5000,maxRoundTripLossPct:6,confirmationGapMs:5000,confirmationMaxAgeMs:60000,minPriceRetention:.995,minLiquidityRetention:.9,reentryMs:30*min,certificationsRequired:false}),
 riskPolicy:Object.freeze({version:TEN_STRATEGY_VERSION+':'+id,label:role,strategyRulesRequired:true,certificationsRequired:false,maxImpactPct:null,allocationFraction:.025,dailyLossHalt:false,lossStreakHalt:false,drawdownHalt:false}),
 exitPolicy:Object.freeze({...SCALP_EXIT_RULES,agentId:id,agentPolicyVersion:TEN_STRATEGY_VERSION,stopLossPct:stop,firstProfitPct:tp1,finalProfitPct:tp2,trailingPct:trailing,stallMs:stall*min,stallGainPct:gain,maxHoldMs:hold*min,firstSellFraction:fraction,maxQuoteAgeMs:30000,exitPriority:'sl-tp-time-first'})
})));
export function validMinuteBars(data,m,now){
 if(data?.mint!==m.mint||data.pairAddress!==m.pairAddress||!Array.isArray(data.bars))return null;
 const bars=data.bars.map(r=>Array.isArray(r)?r.slice(0,6):[]).sort((a,b)=>a[0]-b[0]);
 if(bars.some((r,i)=>r.length!==6||!r.every(finite)||!Number.isInteger(r[0])||r[0]%60||r[1]<=0||r[3]<=0||r[4]<=0||r[2]<Math.max(r[1],r[4])||r[3]>Math.min(r[1],r[4])||r[5]<0||r[0]*1000>now||i&&r[0]===bars[i-1][0]))return null;
 const closed=bars.filter(r=>(r[0]+60)*1000<=now);
 if(!closed.length||(closed.at(-1)[0]+60)*1000!==Math.floor(now/min)*min||closed.some((r,i)=>i&&r[0]-closed[i-1][0]!==60))return null;
 return closed;
}
export function tenSignal(id,m,now=Date.now(),context={}){
 const a=TEN_AGENTS.find(a=>a.id===id),r=a?.entryRules,e=m.evidence??{},data=m.strategyData??{},missing=[],blocked=[],parts={},fresh=t=>finite(t)&&t<=now&&now-t<=5000;
 const require=(known,ok,key,label)=>{if(!known)missing.push({key,label});else if(!ok)blocked.push({key,label});};
 const common=!!a&&m.dexId==='pumpswap'&&!!m.mint&&!!m.pairAddress&&finite(m.priceUsd)&&m.priceUsd>0&&fresh(m.updatedAt);
 if(!common)return result('discovery','Thiếu giá ≤5 giây hoặc mint/pool PumpSwap hợp lệ',false,false,0);
 require(finite(m.liquidityUsd),m.liquidityUsd>=r.minLiquidityUsd,'LIQUIDITY','Thanh khoản cần ≥$'+r.minLiquidityUsd);
 const cheap=missing.length===0&&blocked.length===0;
 const bars=validMinuteBars(data,m,now),last=bars?.at(-1),pct=bar=>bar?(bar[4]/bar[1]-1)*100:null,green=bar=>!!bar&&bar[4]>bar[1],prior15=bars?.slice(-16,-1),avg15=prior15?.length===15?prior15.reduce((s,b)=>s+b[5],0)/15:null;
 const ratio=Number.isSafeInteger(m.buys5m)&&m.buys5m>=0&&Number.isSafeInteger(m.sells5m)&&m.sells5m>=0?m.buys5m/Math.max(1,m.sells5m):null;
 const flow=data.flow,flowBound=flow?.mint===m.mint&&flow.pairAddress===m.pairAddress&&fresh(flow.checkedAt),p=m.change5mPct;let strength=0;
 switch(id){
 case 'nova':
  require(finite(p),p>=5&&p<=100,'M5_MOMENTUM','M5 cần +5–100%');require(finite(m.volume5mUsd),m.volume5mUsd>=500,'VOLUME_5M','Volume 5m cần ≥$500');
  require(flowBound&&flow.lastTenComplete===true&&Array.isArray(flow.lastTen)&&flow.lastTen.length===10,flow?.lastTen?.filter?.(t=>t?.side==='BUY')?.length>=5,'LAST_TEN_TRADES','Cần 10 giao dịch thật gần nhất, trong đó ≥5 BUY');
  require(finite(ratio),ratio>=1.1,'BUY_SELL_RATIO','Mua/bán cần ≥1,1');strength=finite(p)?clamp(p/20):0;break;
 case 'orin':
  require(!!last&&finite(avg15)&&avg15>0,!!last&&last[5]>=avg15*3,'M1_VOLUME_SPIKE','Volume M1 cần ≥3× trung bình 15 phút trước');require(!!last,pct(last)+1e-9>=2,'M1_GAIN','M1 cần tăng ≥2%');require(finite(ratio),ratio>=1.2,'BUY_SELL_RATIO','Mua/bán cần ≥1,2');require(finite(p),p>=0,'M5_GREEN','M5 không âm');strength=last&&avg15>0?clamp(last[5]/avg15/6):0;break;
 case 'vela':{
  const high=prior15?.length===15?Math.max(...prior15.map(b=>b[2])):null;
  require(finite(high),m.priceUsd>high&&last?.[4]>high&&last?.[1]<=high,'BREAKOUT_15M','Nến M1 mới đóng cần vừa vượt đỉnh 15 phút trước');require(finite(high),m.priceUsd<=high*1.15,'BREAKOUT_CHASE','Giá không vượt đỉnh cũ quá 15%');require(!!last&&finite(avg15)&&avg15>0,last?.[5]>=avg15*2,'BREAKOUT_VOLUME','Volume M1 cần ≥2× nền 15 phút');strength=last&&avg15>0?clamp(last[5]/avg15/4):0;break;}
 case 'kade':{
  const three=bars?.slice(-3),gains=three?.map(pct),bodies=three?.map(b=>b[4]-b[1]);
  require(three?.length===3,gains?.every(g=>g+1e-9>=.5)&&bodies?.slice(1).every((b,i)=>b+1e-12>=bodies[i]),'THREE_GREEN_M1','Cần 3 nến M1 xanh ≥0,5%, thân không thu nhỏ');require(finite(ratio),ratio>=1.2,'BUY_SELL_RATIO','Mua/bán cần ≥1,2');strength=gains?.length===3?clamp(gains.reduce((a,b)=>a+b,0)/3):0;break;}
 case 'rune':{
  const thirty=bars?.slice(-30),peak=thirty?.length===30?Math.max(...thirty.map(b=>b[2])):null,peakIndex=thirty?.findLastIndex(b=>b[2]===peak),low=peakIndex>0?Math.min(...thirty.slice(0,peakIndex).map(b=>b[3])):null,pivots=thirty?.map((bar,index)=>({bar,index})).filter(({bar:b,index:i})=>i>0&&i<thirty.length-1&&b[3]<thirty[i-1][3]&&b[3]<=thirty[i+1][3]);
  require(finite(peak)&&finite(low),peak/low>=1.15,'RISE_30M','Cần nhịp tăng ≥15% trong 30 phút');require(finite(peak),m.priceUsd/peak>=.85&&m.priceUsd/peak<=.92,'PULLBACK','Giá cần hồi 8–15% từ đỉnh 30m');require(pivots?.length>=2,pivots?.at(-1)?.index>peakIndex&&pivots?.at(-1)?.bar[3]>pivots?.at(-2)?.bar[3],'HIGHER_LOW','Đáy hồi phải cao hơn đáy trước');require(!!last,green(last),'GREEN_CONFIRM','Cần nến M1 xanh xác nhận');strength=peak&&low?clamp((peak/low-1)/.3):0;break;}
 case 'zara':{
  const age=finite(m.pairCreatedAt)&&m.pairCreatedAt>0?now-m.pairCreatedAt:null;require(finite(age)&&age>=0,age>=3*min&&age<=30*min,'POOL_AGE','Tuổi pool cần 3–30 phút');require(finite(p),p>0,'M5_GREEN','M5 cần xanh');require(finite(ratio),ratio>=1.2,'BUY_SELL_RATIO','Mua/bán cần ≥1,2');
  const h=data.holders;let holderKnown=false;if(h?.mint===m.mint&&h.pairAddress===m.pairAddress&&finite(h.current)&&finite(h.previous)&&h.previous>0&&h.at<=now&&now-h.at<=300000&&h.at-h.previousAt>=300000){holderKnown=true;require(true,h.current/h.previous>=1.2,'HOLDER_GROWTH','Holder có dữ liệu cần tăng ≥20%/5m');}parts.holderGrowthKnown=holderKnown;strength=finite(p)?clamp(p/20):0;break;}
 case 'atlas':
  require(finite(m.valuationUsd),m.valuationUsd>=50000,'MARKET_CAP','Vốn hóa cần ≥$50.000');require(finite(context.liquidityCutoff),m.liquidityUsd>=context.liquidityCutoff,'LIQUIDITY_COHORT','Thanh khoản cần thuộc tứ phân vị cao nhất của tập quét riêng');require(finite(p),p>=3&&p<=40,'M5_LIQUID','M5 cần +3–40%');require(finite(ratio),ratio>=1.1,'BUY_SELL_RATIO','Mua/bán cần ≥1,1');strength=clamp(m.liquidityUsd/100000);break;
 case 'echo':
  require(flowBound&&flow.windowComplete===true&&flow.walletsComplete===true&&Number.isSafeInteger(flow.uniqueBuyers)&&flow.uniqueBuyers>=0&&Number.isSafeInteger(flow.uniqueSellers)&&flow.uniqueSellers>=0,flow?.uniqueBuyers>=1.3*Math.max(1,flow?.uniqueSellers),'UNIQUE_WALLETS','Cần cửa sổ 5m đầy đủ và ví BUY/SELL ≥1,3');require(flowBound&&flow.windowComplete===true&&finite(flow.largestBuySharePct),flow?.largestBuySharePct>=0&&flow?.largestBuySharePct<=25+1e-9,'SINGLE_BUY_SHARE','Một BUY không được vượt 25% volume 5m');require(flowBound&&flow.windowComplete===true&&finite(flow.smallBuyFraction),flow?.smallBuyFraction>.5&&flow.smallBuyFraction<=1,'SMALL_BUYS','Đa số BUY phải ≤5% volume 5m mỗi lệnh');require(finite(p),p>=2,'M5_FLOW','M5 cần ≥2%');strength=flow?.uniqueSellers>=0?clamp(flow.uniqueBuyers/Math.max(1,flow.uniqueSellers)/2):0;break;
 case 'nyx':{
  const red=bars?.at(-2),gain=pct(red);require(!!red&&!!last,gain<=-4&&gain>=-10,'RED_M1','Cần nến M1 đỏ trước giảm 4–10%');require(!!last&&!!red,last?.[4]>=Math.min(red?.[1],red?.[4])+Math.abs(red?.[1]-red?.[4])/2&&last?.[4]>=last?.[1],'BOUNCE_CONFIRM','Nến kế tiếp cần ngừng giảm, đóng ở nửa trên thân nến đỏ');require(finite(p)&&finite(m.change1hPct),p>0&&m.change1hPct>0,'M5_H1_GREEN','M5 và H1 cần xanh');strength=last&&red?clamp((last[4]-red[4])/Math.max(1e-12,red[1]-red[4])):0;break;}
 case 'sage':
  require(!!last,green(last),'M1_GREEN','M1 cần xanh');require(finite(p),p>0,'M5_GREEN','M5 cần xanh');require(finite(ratio),ratio>=1.3,'BUY_SELL_RATIO','Mua/bán cần ≥1,3');if(data.holders?.mint===m.mint&&data.holders.pairAddress===m.pairAddress&&finite(data.holders.top10Pct))require(true,data.holders.top10Pct<=35,'TOP_TEN','Top 10 holder có dữ liệu cần ≤35%');strength=finite(ratio)?clamp(ratio/2):0;break;
 }
 const prior=context.prior,confirmation=prior&&finite(prior.at)&&now-prior.at>=5000&&now-prior.at<=60000&&prior.sourceAt<m.updatedAt&&prior.priceUsd>0&&prior.liquidityUsd>0;
 require(!!confirmation,confirmation&&m.priceUsd>=prior.priceUsd*.995&&m.liquidityUsd>=prior.liquidityUsd*.9,'TWO_SNAPSHOTS','Cần 2 snapshot riêng ≥5 giây; giữ giá ≥99,5% và thanh khoản ≥90%');
 if(context.cooldownUntil>now)blocked.push({key:'REENTRY_30M',label:'Token đang nghỉ giao dịch 30 phút trong sổ riêng'});
 const structural=missing.length===0&&blocked.length===0,loss=e.roundTripLossPct,cost=finite(loss)?15*clamp(1-loss/6):0,liquidity=15*clamp(m.liquidityUsd/r.minLiquidityUsd-1),score=Math.round(55+liquidity+15*strength+cost);
 Object.assign(parts,{base:55,liquidity,strength:15*strength,quoteCost:finite(loss)?cost:null,definition:'Explicit heuristic weights, not fitted probabilities or backtest results'});
 const proof=e.certificationMode==='bypassed-paper'&&e.mint===m.mint&&e.pairAddress===m.pairAddress&&e.roundTripQuoteOk===true&&fresh(e.quoteCheckedAt)&&Number.isInteger(e.decimals)&&e.decimals>=0&&e.decimals<=18&&finite(e.probeSol)&&e.probeSol>0&&finite(loss)&&loss>=0;
 if(!structural){const issue=missing[0]??blocked[0];return result(missing.length?'strategy-data':'market',issue.label,cheap,false,score,issue.key);}
 if(!proof)return result('execution','Cần quote vòng thật ≤5 giây và decimals đúng cỡ lệnh',cheap,score+15>=r.minScore,score,'EXECUTION_QUOTE');
 if(loss>6+1e-9)return result('execution','Quote khứ hồi hao hụt quá 6%',cheap,false,score,'ROUND_TRIP_COST');
 if(score<r.minScore)return result('score','Điểm '+score+' dưới '+r.minScore,cheap,false,score,'SCORE');
 return result('ready','Đạt luật '+a.name,cheap,true,score);
 function result(stage,reason,roughEligible,preQuoteEligible,score,key=stage){
  const flags=stage==='ready'?[]:[key],rank={agentId:id,eligible:stage==='ready',roughEligible,preQuoteEligible,blockingStage:stage,primaryFlags:flags,red_flags:flags,primaryReasons:flags.length?[reason]:[],reasons:flags.length?[reason]:[],missingData:missing.map(x=>x.key),score:finite(score)?Math.min(100,score):0,minScore:r?.minScore??100,scoreParts:parts,policyVersion:TEN_STRATEGY_VERSION,certificationsRequired:false,baseline:{eligible:null},relaxedFlags:['SHARED_20_SOL','LOSS_HALTS_DISABLED'],strategyChecks:{missing,blocked}};
  return {eligible:rank.eligible,stage,reason,rank,m};
 }
}
