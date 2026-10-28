import {momentumScore} from './rules-momentum.js';
const finite=Number.isFinite;
export function scoreRules(i,observed={},z={mode:'AUTO',friction:0}){
 const core=observed.evidenceProfile==='onchain-momentum',scored=core?momentumScore(i,z):null,pos=scored?.pos??[],neg=scored?.neg??[],add=(points,reason)=>{(points>0?pos:neg).push({points,reason});},number=k=>finite(i[k]),curve=number('curve_progress_pct')&&i.curve_progress_pct>=15&&i.curve_progress_pct<=80;
 if(!core){
 if(curve&&observed.curveMonotonic===true)add(1.5,'curve 15–80%, monotonic');
 if(i.dev_wallet_pct<3&&i.dev_sell_history.length===0)add(1.5,'dev <3%, no sells');
 if(i.top10_pct<15)add(1.5,'top10 <15%');
 if(number('holder_growth_rate')&&i.holder_growth_rate>0&&i.bundle_clusters.length===0)add(1,'organic holder growth');
 if(number('buy_sell_ratio')&&i.buy_sell_ratio>1.2&&observed.volume5mStable===true)add(1,'buy/sell >1.2, stable volume');
 if(number('narrative_heat')&&i.narrative_heat>=7&&i.token_age_minutes<360)add(.5,'narrative >=7');
 if(i.funding_source_trace?.status==='clean')add(.5,'funding verified clean');
 if(observed.liquidityHealthy===true)add(.5,'liquidity criterion verified');
 const socials=i.socials,ages=socials?.account_age_days;
 if(socials?.presence===true&&Array.isArray(ages)&&ages.length&&ages.every(a=>finite(a)&&a>=30))add(.5,'socials >=30d');
 if(i.bundle_clusters.length||i.block0_buyer_count>=3)add(-3,'bundle or block0 >=3');
 if(i.graduation_dump_model>40)add(-2,'graduation dump >40');
 if(z.friction>6)add(-2,'roundtrip >6%');
 if(socials?.presence===false||Array.isArray(ages)&&ages.some(a=>finite(a)&&a<2))add(-1.5,'missing socials or age <48h');
 if(number('holder_growth_rate')&&i.holder_growth_rate<=0)add(-1,'non-positive holder growth');
 if(i.token_age_minutes>360&&observed.newAthWithin120m===false)add(-1,'old token, no recent ATH');
 if(i.expected_slippage_pct>8)add(-1,'slippage >8%');
 }
 return {pos,neg,score:Math.max(0,Math.min(10,[...pos,...neg].reduce((n,p)=>n+p.points,0)))};
}
