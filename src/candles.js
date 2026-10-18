import {TREND_RULES as R} from './desk-rules.js';
/** Optional score evidence from actual completed one-minute OHLCV bars; never invent candles from snapshots. */
export function candleStructure(rows,currentPrice,now=Date.now()){
 if(!Array.isArray(rows)||rows.length<30||!(currentPrice>0))return {};
 const bars=rows.map(r=>Array.isArray(r)?r.slice(0,6):[]).sort((a,b)=>a[0]-b[0]);
 if(bars.some(r=>r.length!==6||!r.every(Number.isFinite)||r[0]*1000>now||r[1]<=0||r[4]<=0||r[3]<=0||r[2]<Math.max(r[1],r[4])||r[3]>Math.min(r[1],r[4])||r[5]<0))return {};
 const completed=bars.filter(r=>(r[0]+60)*1000<=now&&r[0]*1000>=now-31*60000);
 if(completed.length<30||now-(completed.at(-1)[0]+60)*1000>120000||completed.some((r,i)=>i&&r[0]-completed[i-1][0]!==60))return {};
 const lows=completed.filter((r,i)=>i>0&&i<completed.length-1&&r[3]<completed[i-1][3]&&r[3]<completed[i+1][3]);
 const last=completed.at(-1),peak=Math.max(...completed.slice(-30).map(r=>r[2]));
 return {...(lows.length>=2?{higherLows:lows.at(-1)[3]>lows.at(-2)[3]}:{}),pullback30mPct:(1-currentPrice/peak)*100,greenCandleConfirmed:last[4]>last[1],candleLastClosedAt:(last[0]+60)*1000};
}

/** H4 risk uses real 4-hour bars. A young pool can have one forming bar, never four fake hours. */
export function fourHourRisk(rows,currentPrice,pairCreatedAt,now=Date.now()){
 const unknown=reason=>({state:'unknown',reasons:[reason],checkedAt:now});
 if(!Array.isArray(rows)||!rows.length||rows.length>16||!Number.isFinite(currentPrice)||currentPrice<=0||!Number.isFinite(pairCreatedAt)||pairCreatedAt>now||now-pairCreatedAt<R.minHistoryMs)return unknown('H4_INSUFFICIENT_HISTORY');
 const bars=rows.map(r=>Array.isArray(r)?r.slice(0,6):[]).sort((a,b)=>a[0]-b[0]);
 if(bars.some((r,i)=>r.length!==6||!r.every(Number.isFinite)||!Number.isInteger(r[0])||r[0]%14400!==0||r[0]*1000>now||r[1]<=0||r[4]<=0||r[3]<=0||r[2]<Math.max(r[1],r[4])||r[3]>Math.min(r[1],r[4])||r[5]<0||i>0&&r[0]===bars[i-1][0]))return unknown('H4_INVALID_OHLCV');
 const relevant=bars.filter(r=>(r[0]+14400)*1000>pairCreatedAt),last=relevant.at(-1);
 if(!last||now-last[0]*1000>=28800000)return unknown('H4_STALE_BARS');
 const shape=(bar,price=bar[4])=>{
  // Extend only the risk calculation with the current observed spot; never alter/provider-fill OHLCV.
  const open=bar[1],high=Math.max(bar[2],price),low=Math.min(bar[3],price),range=high-low;
  const redDropPct=(1-price/open)*100,retreatPct=(1-price/high)*100,pumpPct=(high/open-1)*100;
  const upperWickFraction=range>0?(high-Math.max(open,price))/range:0,closeLocation=range>0?(price-low)/range:1;
  const red=redDropPct+1e-9>=R.minRedDropPct&&closeLocation<=R.maxCloseLocation;
  const rejection=pumpPct+1e-9>=R.minPumpPct&&retreatPct+1e-9>=R.minPeakRetreatPct&&upperWickFraction>=R.minUpperWickFraction;
  return {red,rejection,redDropPct,retreatPct,upperWickFraction};
 };
 const forming=(last[0]+14400)*1000>now,latest=shape(last,forming?currentPrice:last[4]);
 const reasons=[];
 if(forming&&latest.red)reasons.push('H4_BEARISH_BODY');
 if(forming&&latest.rejection)reasons.push('H4_PUMP_REJECTION');
 const closed=relevant.filter(r=>(r[0]+14400)*1000<=now),previous=closed.at(-1);
 if(previous){const s=shape(previous);if((s.red||s.rejection)&&currentPrice<=previous[1]*1.05&&currentPrice<=previous[2]*(1-R.minPeakRetreatPct/100))reasons.push('H4_PREVIOUS_REJECTION');}
 if(closed.length>=2){const a=closed.at(-2),b=closed.at(-1);if(b[4]<=a[4]*.8&&b[2]<a[2]&&b[3]<a[3]&&currentPrice<b[1]&&currentPrice<a[4])reasons.push('H4_LOWER_LOW_DOWNTREND');}
 if(reasons.length)return {state:'reject',reasons:reasons.slice(0,3),checkedAt:now,barAt:last[0]*1000,forming,...latest};
 if(!forming||now-Math.max(last[0]*1000,pairCreatedAt)<R.minHistoryMs)return unknown('H4_INSUFFICIENT_CURRENT_BAR');
 return {state:'clear',reasons:[],checkedAt:now,barAt:last[0]*1000,forming,...latest};
}
export async function fetchStructure(m,fetcher=globalThis.fetch){
 const read=async(timeframe,aggregate,limit)=>{
  const u=new URL('https://api.geckoterminal.com/api/v2/networks/solana/pools/'+encodeURIComponent(m.pairAddress)+'/ohlcv/'+timeframe);u.searchParams.set('aggregate',aggregate);u.searchParams.set('limit',limit);u.searchParams.set('currency','usd');u.searchParams.set('token','base');
  const r=await fetcher(u,{signal:AbortSignal.timeout(2000)});if(!r.ok)return null;
  const json=await r.json();return json?.meta?.base?.address===m.mint?json?.data?.attributes?.ohlcv_list:null;
 };
 const results=await Promise.allSettled([read('minute','1','35'),read('hour','4','8')]);
 const minute=results[0].status==='fulfilled'?results[0].value:null,h4=results[1].status==='fulfilled'?results[1].value:null;
 return {...candleStructure(minute,m.priceUsd),...(h4?{h4Risk:{...fourHourRisk(h4,m.priceUsd,m.pairCreatedAt),mint:m.mint,pairAddress:m.pairAddress}}:{})};
}
