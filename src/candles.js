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
export async function fetchStructure(m,fetcher=globalThis.fetch){
 const u=new URL('https://api.geckoterminal.com/api/v2/networks/solana/pools/'+encodeURIComponent(m.pairAddress)+'/ohlcv/minute');u.searchParams.set('aggregate','1');u.searchParams.set('limit','35');u.searchParams.set('currency','usd');u.searchParams.set('token','base');
 const r=await fetcher(u,{signal:AbortSignal.timeout(2000)});if(!r.ok)return {};
 const json=await r.json();if(json?.meta?.base?.address!==m.mint)return {};return candleStructure(json?.data?.attributes?.ohlcv_list,m.priceUsd);
}
