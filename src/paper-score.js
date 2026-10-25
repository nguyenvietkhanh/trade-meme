import {tenSignal,validMinuteBars} from './paper-ten-strategies.js';
import {laneChecks} from './paper-lanes.js';
const clamp=x=>Number.isFinite(x)?Math.max(0,Math.min(1,x)):0;
function mainComponents(c,m,now){
 const bars=validMinuteBars(m.strategyData,m,now),last=bars?.at(-1),previous=bars?.slice(-16,-1),avg=previous?.length===15?previous.reduce((n,b)=>n+b[5],0)/15:null,ratio=m.buys5m/Math.max(1,m.sells5m),f=m.strategyData?.flow,t=c.mainSpec.targets,pct=b=>b?(b[4]/b[1]-1)*100:NaN;let v={};
 switch(c.id){
  case 'nova':v={momentum:m.change5mPct/t.momentum,lastBuys:((f?.lastTen?.filter(r=>r.side==='BUY').length??0)/10-.5)/(t.buyShare-.5),flow:(ratio-1.1)/t.flowMargin};break;
  case 'orin':v={volume:last?.[5]/avg/t.volumeMultiple,gain:pct(last)/t.gainPct,flow:ratio/t.flowRatio};break;
  case 'vela':{const high=previous?.length===15?Math.max(...previous.map(b=>b[2])):NaN;v={volume:last?.[5]/avg/t.volumeMultiple,breakout:(m.priceUsd/high-1)*100/t.breakoutPct};break;}
  case 'kade':{const three=bars?.slice(-3)??[],bodies=three.map(b=>b[4]-b[1]);v={gain:three.reduce((n,b)=>n+pct(b),0)/3/t.meanGainPct,steady:bodies.length?Math.min(...bodies)/Math.max(...bodies):0,flow:ratio/t.flowRatio};break;}
  case 'rune':{const b=bars?.slice(-30)??[],peak=b.length===30?Math.max(...b.map(x=>x[2])):NaN,idx=b.findLastIndex(x=>x[2]===peak),low=idx>0?Math.min(...b.slice(0,idx).map(x=>x[3])):NaN,pivots=b.filter((x,i)=>i>0&&i<b.length-1&&x[3]<b[i-1][3]&&x[3]<=b[i+1][3]);v={rise:(peak/low-1)*100/t.risePct,higherLow:pivots.length>=2?(pivots.at(-1)[3]/pivots.at(-2)[3]-1)*100/t.higherLowPct:0,confirm:pct(last)/t.confirmPct};break;}
  case 'zara':v={momentum:m.change5mPct/t.momentum,flow:ratio/t.flowRatio};break;
  case 'atlas':v={depth:m.liquidityUsd/t.liquidityUsd,momentum:m.change5mPct/t.momentum,flow:ratio/t.flowRatio};break;
  case 'echo':v={wallets:(f?.uniqueBuyers/Math.max(1,f?.uniqueSellers)-1.3)/t.walletMargin,concentration:(25-f?.largestBuySharePct)/25,smallBuys:(f?.smallBuyFraction-.5)/.5};break;
  case 'nyx':{const red=bars?.at(-2);v={recovery:last&&red?(last[4]-red[4])/(red[1]-red[4]):0,momentum:m.change5mPct/t.momentum,hour:m.change1hPct/t.hour};break;}
  case 'sage':v={minute:pct(last)/t.minuteGainPct,momentum:m.change5mPct/t.momentum,flow:(ratio-1.3)/t.flowMargin};break;
 }
 return Object.fromEntries(Object.entries(c.mainSpec.weights).map(([key,weight])=>[key,{weight,normalized:clamp(v[key])}]));
}
export function independentSignal(config,m,now,context={}){
 const raw=tenSignal(config.id,m,now,{...context,signalOnly:true}),base=raw.rank.strategyChecks?.checks??[];
 const lanes=laneChecks(config,m,now),main=base.filter(c=>c.key!=='LIQUIDITY'),w=config.scoreWeights;
 const all=[...base,...lanes],known=all.filter(c=>c.status!=='unknown').length;
 const structural=raw.eligible&&lanes.every(c=>c.status==='pass');
 const prior=context.prior,confirmed=structural&&prior?.structural===true&&now-prior.at>=5000&&now-prior.at<=60000&&prior.snapshotId!==context.snapshotId&&m.updatedAt>prior.sourceAt&&m.priceUsd>=prior.priceUsd*.995&&m.liquidityUsd>=prior.liquidityUsd*.9;
 const holders=m.strategyData?.holders,holderKnown=holders?.mint===m.mint&&holders.pairAddress===m.pairAddress&&Number.isFinite(holders.top10Pct)&&holders.top10Pct>=0&&Number.isFinite(holders.at)&&now-holders.at>=0&&now-holders.at<=300000;
 const components=mainComponents(config,m,now),scoreParts={main:w.main*Object.values(components).reduce((n,c)=>n+c.weight*c.normalized,0),persistence:confirmed?w.persistence:0,lane:structural?w.liquidity*clamp(m.liquidityUsd/config.entryRules.minLiquidityUsd-1)+(holderKnown?w.holders*clamp(1-holders.top10Pct/100):0):0,holderKnown,mainComponents:components};
 const score=Math.round(scoreParts.main+scoreParts.persistence+scoreParts.lane),missing=all.find(c=>c.status==='unknown'),failed=all.find(c=>c.status==='fail');
 let stage=raw.stage==='discovery'?'discovery':failed?'market':missing?'strategy-data':!confirmed?'confirmation':score<config.entryRules.minScore?'score':'ready';
 const reason=stage==='discovery'?raw.reason:failed?.label??missing?.label??(!confirmed?'Chờ hai snapshot mới cách ≥5 giây, tín hiệu còn đúng':score<config.entryRules.minScore?'Điểm dưới ngưỡng':'Đạt tín hiệu riêng');
 const eligible=stage==='ready';
 return {eligible,structural,stage,reason,score,minScore:config.entryRules.minScore,scoreParts,checks:all,coverage:all.length?known/all.length:0,conditionRatio:all.length?all.filter(c=>c.status==='pass').length/all.length:0,quoteSource:null,
 rank:{...raw.rank,score,minScore:config.entryRules.minScore,scoreParts,eligible,roughEligible:structural,preQuoteEligible:structural,blockingStage:stage,primaryReasons:[reason],primaryFlags:[missing?.key??failed?.key??stage]}};
}
