import {validMinuteBars} from './paper-ten-strategies.js';
export function laneChecks(config,m,now){
 const out=[],l=config.lane,bars=validMinuteBars(m.strategyData,m,now),check=(key,known,pass,label)=>out.push({key,status:!known?'unknown':pass?'pass':'fail',label});
 const age=now-m.pairCreatedAt;
 check('LANE_AGE',Number.isFinite(m.pairCreatedAt)&&m.pairCreatedAt>0&&age>=0,(l.minAgeExclusive?age>l.minAgeMs:age>=l.minAgeMs)&&(l.maxAgeMs==null||age<=l.maxAgeMs),'Tuổi pool ngoài lane của '+config.name);
 if(l.maxLiquidityUsd!==null)check('LANE_LIQUIDITY',Number.isFinite(m.liquidityUsd),m.liquidityUsd<l.maxLiquidityUsd,'Lane cần thanh khoản <$'+l.maxLiquidityUsd);
 const three=bars?.slice(-3),gains=three?.map(b=>(b[4]/b[1]-1)*100);
 if(!l.allowSharpRed)check('LANE_SHARP_RED',three?.length===3,gains?.every(p=>p>-4),'Một trong 3 M1 giảm ≥4%');
 if(l.peak30MaxDipPct!=null){const thirty=bars?.slice(-30),high=thirty?.length===30?Math.max(m.priceUsd,...thirty.map(b=>b[2])):null,dip=high?(1-m.priceUsd/high)*100:null;check('LANE_PEAK30',Number.isFinite(dip),dip>=Math.max(0,l.peak30MinDipPct??0)&&(l.includeMaxDip?dip<=l.peak30MaxDipPct:dip<l.peak30MaxDipPct),'Khoảng cách đỉnh 30m ngoài lane');}
 if(l.m5Min!=null)check('LANE_M5',Number.isFinite(m.change5mPct),m.change5mPct>=l.m5Min&&m.change5mPct<l.m5Max,'M5 ngoài ['+l.m5Min+', '+l.m5Max+')%');
 const prior=bars?.slice(-16,-1),high15=prior?.length===15?Math.max(...prior.map(b=>b[2])):null;
 if(l.atOrBelowHigh15||l.belowHigh15)check('LANE_HIGH15',Number.isFinite(high15),l.belowHigh15?m.priceUsd<high15:m.priceUsd<=high15,'Giá vượt đỉnh 15m tham chiếu');
 if(l.minM1Pct!=null)check('LANE_M1_SPIKE',!!bars?.length,bars?.length&&(bars.at(-1)[4]/bars.at(-1)[1]-1)*100+1e-9>=l.minM1Pct,'M1 cần tăng ≥'+l.minM1Pct+'%');
 if(l.maxEachM1Pct!=null)check('LANE_STEADY_M1',gains?.length===3,gains?.every(g=>g>0&&g<l.maxEachM1Pct),'Ba M1 phải xanh và mỗi nến <'+l.maxEachM1Pct+'%');
 if(l.h1Positive)check('LANE_H1',Number.isFinite(m.change1hPct),m.change1hPct>0,'H1 cần xanh');
 return out;
}
