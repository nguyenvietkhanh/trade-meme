/** Transparent, untrained heuristic. Score is a filter, not a probability of profit. */
export function rankMarket(m,s,now=Date.now()){
 const reasons=[];
 const fresh=Number.isFinite(m.updatedAt)&&now-m.updatedAt<=s.maxPriceAgeMs&&now>=m.updatedAt;
 const liquid=Number.isFinite(m.liquidityUsd)&&m.liquidityUsd>=s.minLiquidityUsd;
 const volume=Number.isFinite(m.volume24hUsd)&&m.volume24hUsd>=s.minVolume24hUsd;
 const momentum=Number.isFinite(m.change5mPct)&&m.change5mPct>=1&&m.change5mPct<=8;
 const activity=Number.isFinite(m.buys5m)&&m.buys5m>=10;
 const pressure=Number.isFinite(m.sells5m)&&m.sells5m>=0&&m.buys5m>m.sells5m*1.3;
 const aged=Number.isFinite(m.pairCreatedAt)&&m.pairCreatedAt>0&&now-m.pairCreatedAt>=s.minPairAgeMs;
 if(!fresh)reasons.push('Giá cũ hoặc thiếu');
 if(!liquid)reasons.push('Thanh khoản < $100k');
 if(!volume)reasons.push('Volume 24h < $100k');
 if(!momentum)reasons.push('Biến động 5m ngoài khoảng +1% đến +8%');
 if(!activity)reasons.push('Ít hơn 10 lượt mua/5m');
 if(!pressure)reasons.push('Lực mua chưa vượt 1,3× lực bán');
 if(!aged)reasons.push('Pool dưới 6 giờ hoặc không rõ tuổi');
 const score=(liquid?20:0)+(volume?15:0)+(momentum?25:0)+(activity?10:0)+(pressure?20:0)+(aged?10:0);
 return {score,eligible:reasons.length===0,reasons};
}
