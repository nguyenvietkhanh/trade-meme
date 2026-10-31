export const SOL='So11111111111111111111111111111111111111112';
const num=Number.isFinite;
const result=(stage,reason,metrics)=>({stage_reached:stage,reason_code:reason,pass:reason===stage+'_PASS',metrics});
export function stageA(m,c,now){
 const buys=m.buys5m,sells=m.sells5m,ratio=num(buys)&&num(sells)&&buys>=0&&sells>=0?(sells?buys/sells:buys>0?Infinity:0):null;
 const age=num(m.pairCreatedAt)&&m.pairCreatedAt<=now?now-m.pairCreatedAt:null;
 const v={liquidity:m.liquidityUsd,ageMs:age,m5:m.change5mPct,m1:m.change1mPct,h1:m.change1hPct,buys,sells,txns:num(buys)&&num(sells)?buys+sells:null,ratio:ratio===Infinity?'all buys':ratio,volumeUsd:m.volume5mUsd,mcap:m.marketCapUsd??m.valuationUsd,sourceAgeMs:now-(m.marketObservedAt??m.activityCheckedAt??m.updatedAt)};
 const fail=code=>result('A',code,v);
 if(!['pumpfun','pumpswap'].includes(m.dexId)||m.quoteMint&&m.quoteMint!==SOL)return fail('NO_POOL');
 if(m.dexId==='pumpswap'){
  if(!num(v.liquidity)||v.liquidity<c.aSwapLiquidityUsd)return fail('A_LIQ');
  if(!num(age)||age<c.aSwapAgeMs)return fail('A_AGE');
  if(!num(v.m5)||v.m5<c.aSwapM5Min||v.m5>c.aSwapM5Max)return fail('A_M5_RANGE');
  if(!num(v.txns)||v.txns<c.aSwapTrades||buys<c.aSwapBuys||ratio===null||ratio<c.aRatio)return fail('A_FLOW');
  if(!num(v.volumeUsd)||v.volumeUsd<c.aSwapVolumeUsd)return fail('A_VOL');
  if(!num(v.h1)||v.h1<c.aSwapH1Min)return fail('A_H1_DUMP');
 }else{
  if(!num(v.mcap)||v.mcap<c.aCurveMcapUsd)return fail('A_LIQ');
  if(!num(age)||age<c.aCurveAgeMs)return fail('A_AGE');
  if(!num(v.m1)||!num(v.m5)||v.m1<=0||v.m5<=0)return fail('A_M5_RANGE');
  if(!num(v.txns)||v.txns<c.aCurveTrades||ratio===null||ratio<c.aRatio)return fail('A_FLOW');
 }
 if(!num(v.sourceAgeMs)||v.sourceAgeMs<0||v.sourceAgeMs>c.scanMs*2)return fail('A_STALE');
 return result('A','A_PASS',v);
}
export function stageB(f,m,c,now){
 const fail=code=>result('B',code,f??{});
 if(!f||f.mint!==m.mint||f.pool!==m.pairAddress||!num(f.checkedAt)||f.checkedAt>now||now-f.checkedAt>c.safetyTtlMs)return fail('B_UNVERIFIED');
 if(f.rejected)return fail(f.reason_code??'B_TOKEN');
 if(f.coverage?.program!==true||f.coverage?.authorities!==true||f.coverage?.holders!==true||f.coverage?.exclusions!==true||f.coverage?.rug!==true)return fail('B_UNVERIFIED');
 if(!['spl-token','spl-token-2022'].includes(f.tokenProgram)||f.extensionsSafe!==true)return fail('B_TOKEN');
 if(f.mintRevoked!==true||f.freezeRevoked!==true)return fail('B_AUTHORITY');
 if(!num(f.top10Pct)||!num(f.devPct)||!num(f.holderCount)||typeof f.rugDanger!=='boolean')return fail('B_UNVERIFIED');
 if(f.top10Pct>c.bTop10Pct)return fail('B_TOP10');if(f.devPct>c.bDevPct)return fail('B_DEV');
 if(f.holderCount<(m.dexId==='pumpfun'?c.bCurveHolders:c.bSwapHolders))return fail('B_HOLDERS');
 if(f.rugDanger)return fail('B_RUG');return result('B','B_PASS',f);
}
export function stageC(rows,c,now){
 let s=rows.slice(-c.cMaxStoredSamples);if(s.length>c.cSamples){const last=s.at(-1),first=[...s].reverse().find(r=>last.at-r.at>=c.cSpanMinMs&&last.at-r.at<=c.cSpanMaxMs),middle=first?[...s].reverse().find(r=>last.at-r.at>=c.cGapMs&&r.at-first.at>=c.cGapMs):null;s=first&&middle?[first,middle,last]:s.slice(-c.cSamples);}const v={samples:s};const fail=code=>result('C',code,v);
 if(s.length!==c.cSamples)return fail('C_SPAN');
 const gaps=s.slice(1).map((r,i)=>r.at-s[i].at),span=s.at(-1).at-s[0].at;
 if(gaps.some(g=>g<c.cGapMs)||span<c.cSpanMinMs||span>c.cSpanMaxMs)return fail('C_SPAN');
 if(s.at(-1).at>now||now-s.at(-1).at>c.cLastAgeMs)return fail('C_STALE');
 if(s.some(p=>!num(p.price)||p.price<=0||!num(p.liquiditySol)||p.liquiditySol<0))return fail('C_STALE');
 v.rise=(s.at(-1).price/s[0].price-1)*100;v.steps=s.slice(1).map((r,i)=>(r.price/s[i].price-1)*100);v.observedWindow=rows.filter(r=>r.at>=s[0].at&&r.at<=s.at(-1).at);v.drawdown=(1-s.at(-1).price/Math.max(...v.observedWindow.map(r=>r.price)))*100;
 if(v.rise<c.cRiseMin)return fail('C_RISE_LOW');if(v.rise>c.cRiseMax)return fail('C_RISE_HIGH');
 if(v.steps.some(x=>x<c.cStepMin)||s.at(-1).price<s.at(-2).price)return fail('C_STEP_DOWN');
 if(v.drawdown>c.cDrawdownMax)return fail('C_DRAWDOWN');
 if(s.at(-1).liquiditySol<s[0].liquiditySol*c.cLiquidityRetention)return fail('C_LIQ_DROP');
 return result('C','C_PASS',v);
}
export function plannedSize(m,state,c){
 const reserve=m.liquidityQuoteSol;
 if(!num(reserve)||reserve<=0)return 0;
 const losses=[...(state.trades??[])].filter(t=>t.side==='SELL'&&t.closed).sort((a,b)=>b.at-a.at);let streak=0;
 for(const t of losses){if(!(t.positionPnlSol<0))break;streak++;}
 let factor=streak>=c.lossStreakProbe?c.lossStreakProbeFactor:streak>=c.lossStreakSoft?c.lossStreakFactor:1;
 const r=state.scalp??{},fund=r.fundSol;if(num(fund)&&r.peakSol>0&&(r.peakSol-fund)/r.peakSol>=c.drawdownSoft)factor=Math.min(factor,c.drawdownFactor);if(num(fund)&&r.peakSol>0&&(r.peakSol-fund)/r.peakSol>=c.drawdownProbe)factor=Math.min(factor,c.lossStreakProbeFactor);if(r.dayStartSol>0&&(state.realized-(r.dayRealized??state.realized))/1e9<-r.dayStartSol*c.dailyLossSoftFraction)factor=Math.min(factor,c.dailyLossFactor);factor=Math.max(c.minSizeFactor,factor);
 return Math.floor(Math.min(c.fixedOrderSol*factor,reserve*c.poolFraction)*1e9)/1e9;
}
export function stageE(m,state,c,now,size,signalId){
 const v={sizeSol:size,cashSol:state.cash/1e9,positions:state.positions.length,exposureSol:state.positions.reduce((n,p)=>n+p.basis,0)/1e9,signalId};
 const fail=code=>result('E',code,v);
 if(!(size>=c.minOrderSol)||state.cash<Math.round((size+c.feeSol*2+c.rentSol)*1e9))return fail('E_CASH');
 if(size>plannedSize(m,state,c)+1e-9)return fail('E_SIZE');
 if(state.positions.some(p=>p.mint===m.mint))return fail('E_HELD');
 const lock=state.scalp?.consumed?.[m.mint];
 if(lock?.signalId===signalId)return fail('E_CONSUMED');
 if(lock&&now-lock.at<c.reentryMs)return fail('E_REENTRY');
 if(state.positions.length>=c.maxPositions)return fail('E_POSITIONS');
 const fund=Object.hasOwn(state.scalp??{},'fundSol')?state.scalp.fundSol:state.initial/1e9;if(!num(fund))return fail('E_EXPOSURE_UNVERIFIED');
 if(v.exposureSol+size>fund*c.maxExposureFraction)return fail('E_EXPOSURE');
 return result('E','E_PASS',v);
}
export function stageD(q,order,c,now){
 const r=q?.roundTrip,v={impact:q?.impactPct,reverseImpact:r?.impactPct,quoteAt:q?.at,reverseAt:r?.at};const fail=why=>({...result('D','D_COST',v),detail:why});
 if(!q||!r||r.mint!==order.mint||r.pool!==order.pool||r.inAmount!==order.amount||r.sellInput!==q.out||!/^\d+$/.test(r.sellOut??''))return fail('UNVERIFIED');
 if(![q.at,r.at].every(at=>num(at)&&at>=order.readyAt&&at<=now&&now-at<=c.dQuoteAgeMs))return fail('STALE');
 v.roundTripLoss=(1-(Number(r.sellOut)-2*c.feeSol*1e9)/Number(order.amount))*100;
 if(![v.impact,v.reverseImpact].every(n=>num(n)&&n>=0&&n<=c.dImpactMax)||!num(v.roundTripLoss)||v.roundTripLoss>c.dLossMax)return fail('FRICTION');
 const reference=order.referencePriceSol,execution=Number(order.amount)/1e9/(Number(q.expectedOut??q.out)/10**q.decimals);v.driftPct=Math.abs(execution/reference-1)*100;
 if(!num(v.driftPct)||v.driftPct>c.dDriftMax)return fail('DRIFT');
 if(c.tp1Pct<c.dEdgeMultiple*v.roundTripLoss)return fail('EDGE');
 return result('D','D_PASS',v);
}
export function scalpExitPolicy(c){return {version:c.version,stopPct:c.stopPct,tp1Pct:c.tp1Pct,tp1Fraction:c.tp1Fraction,postTp1StopPct:c.postTp1StopPct,trailingPct:c.trailingPct,tp2Pct:c.tp2Pct,timeStopMs:c.timeStopMs,timeStopGainPct:c.timeStopGainPct,maxHoldMs:c.maxHoldMs};}
export function scalpExit(p,price,now){
 const c=p.exitPolicy,change=(price/p.entry-1)*100;if(!(price>0&&p.entry>0))return null;
 p.memory??={};const stop=p.tpDone?p.entry*(1+c.postTp1StopPct/100):p.entry*(1-c.stopPct/100);
 p.memory.stopTriggered ||= price<=stop;
 if(p.memory.stopTriggered)return {reason:'stop-loss',fraction:1};
 p.memory.trailingTriggered ||= p.tpDone&&price<=p.peak*(1-c.trailingPct/100);
 if(p.memory.trailingTriggered)return {reason:'scalp-trailing',fraction:1};
 if(now-p.openedAt>=c.maxHoldMs)return {reason:'scalp-max-hold',fraction:1};
 p.memory.timeStopTriggered ||= now-p.openedAt>=c.timeStopMs&&change<c.timeStopGainPct;
 if(p.memory.timeStopTriggered)return {reason:'scalp-time-stop',fraction:1};
 p.memory.tp2Triggered ||= change>=c.tp2Pct;
 if(p.memory.tp2Triggered)return {reason:'scalp-tp2',fraction:1};
 p.memory.tp1Triggered ||= change>=c.tp1Pct;
 if(!p.tpDone&&p.memory.tp1Triggered)return {reason:'scalp-tp1',fraction:c.tp1Fraction,step:0};
 return null;
}
