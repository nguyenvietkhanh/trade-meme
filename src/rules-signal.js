import {rulesConfig} from './rules-config.js';
export function preFilter(i,p=rulesConfig()){
 const failed=[];if(!Number.isFinite(i.volume_5m_sol)||i.volume_5m_sol<=0)failed.push('volume_5m_sol >0');if(!Number.isFinite(i.quote_reserve_sol)||i.quote_reserve_sol<p.minReserveSol)failed.push('reserve >= '+p.minReserveSol);if(!Number.isFinite(i.buys_5m)||!Number.isFinite(i.sells_5m)||i.buys_5m+i.sells_5m<p.preFilterMinTrades)failed.push('trades >='+p.preFilterMinTrades);return {ok:!failed.length,failed};
}
export function signalTier(i,score,p=rulesConfig(),risk={}){
 const ratio=i.buys_5m/Math.max(1,i.sells_5m),trades=i.buys_5m+i.sells_5m,wash=ratio>=p.washRatio&&i.volume_5m_sol/Math.max(1,trades)<p.washAvgSol;
 const check=t=>({score:score>=(t===p.standard?p.scoreStandard:p.scoreProbe),ratio:ratio>=t.ratio,buys:i.buys_5m>=t.buys,trades:trades>=t.trades,volume:i.volume_5m_sol>=t.volume,change:Number.isFinite(i.change_5m_pct)&&i.change_5m_pct>=t.minChange&&i.change_5m_pct<=t.maxChange});
 const standard=check(p.standard),probe=check(p.probe),all=c=>Object.values(c).every(Boolean),tier=!wash&&!risk.probeOnly&&all(standard)?'STANDARD':all(probe)?'PROBE':'SKIP';
 return {tier,wash,ratio,trades,checks:{standard,probe},failed:Object.entries(tier==='STANDARD'?standard:probe).filter(([,v])=>!v).map(([k])=>k),thresholds:{standard:{score:p.scoreStandard,...p.standard},probe:{score:p.scoreProbe,...p.probe}}};
}
export function signalScore(i,o={},p=rulesConfig()){
 const pos=[],neg=[],unknowns=[];const add=(points,reason)=>(points>0?pos:neg).push({points,reason});
 for(const [k,threshold]of [['top10_pct',p.maxTop10Pct],['dev_wallet_pct',p.maxDevPct]])if(Number.isFinite(i[k])&&i[k]<=threshold)add(1,k+' within safety bound');
 if(i.holder_count>=p.minHolderCount)add(1,'holder count verified');if(i.quote_reserve_sol>=p.minReserveSol)add(1,'real pool depth');
 const ratio=i.buys_5m/Math.max(1,i.sells_5m),trades=i.buys_5m+i.sells_5m;
 if(ratio>=1.1)add(1.5,'buy/sell >=1.1');else if(ratio>=1)add(1,'buy/sell >=1');
 if(i.buys_5m>=5)add(.5,'buys >=5');if(trades>=8)add(1,'trades >=8');else if(trades>=5)add(.5,'trades >=5');
 if(i.volume_5m_sol>=.5)add(1,'volume >=0.5 SOL');else if(i.volume_5m_sol>=.3)add(.5,'volume >=0.3 SOL');
 if(i.change_5m_pct>=0&&i.change_5m_pct<=100)add(1,'nonnegative momentum');else if(i.change_5m_pct>=-2)add(.5,'probe pullback');
 if(o.uniqueBuyersVerified&&Number.isInteger(i.unique_buyers_5m))add(i.unique_buyers_5m>=8?.5:.1,'observed signing buyers');else{add(-.5,'unique buyers unknown');unknowns.push('unique_buyers_5m');}
 if(o.entryConfirmed)add(.5,'two observed snapshots');else{add(-.25,'confirmation unknown');unknowns.push('entry_confirmation');}
 if(!Array.isArray(i.dev_sell_history)){add(-.25,'dev launch history unknown');unknowns.push('dev_sell_history');}if(!Array.isArray(i.bundle_clusters)){add(-.25,'complete bundle history unknown');unknowns.push('bundle_clusters');}
 // Distinct signing wallets do not prove independent funding or beneficial ownership.
 unknowns.push('funding_clusters_not_verified');
 unknowns.push('rugcheck_external_not_configured');add(-.25,'external RugCheck not configured');
 return {score:Math.max(0,Math.min(10,[...pos,...neg].reduce((n,p)=>n+p.points,0))),pos,neg,unknowns};
}
// Indicative CPMM price movement only; protocol fees, route availability and quote freshness remain unknown.
export function constantProductEstimate(size,reserve){return size>0&&reserve>0?{impactPct:100*size/(reserve+size),roundtripPriceOnlyPct:100*(1-(reserve/(reserve+size))**2),feesIncluded:false}:null;}
