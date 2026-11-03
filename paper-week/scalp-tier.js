import {readFileSync} from 'node:fs';
const protectedValues={aSwapH1Min:-30,cStepMin:-.3,cDrawdownMax:1};
const allowed={A:['aSwapLiquidityUsd','aSwapAgeMs','aSwapM5Min','aSwapM5Max','aSwapTrades','aSwapBuys','aRatio','aSwapVolumeUsd','aSwapH1Min'],B:['requireSafety','allowUnverified','rejectIfKnownBad','bTop10Pct','bDevPct','bSwapHolders'],C:['cSamples','cSpanMinMs','cSpanMaxMs','cLastAgeMs','cRiseMin','cRiseMax','cStepMin','cDrawdownMax','cLiquidityRetention']};
const hard=['NO_POOL','E_MINT_LOSS_LOCK','A_H1_DUMP','C_STEP_DOWN','C_DRAWDOWN','D_COST','D_INFRA','E_QUOTE_BACKOFF'];
export function readTierPolicy(file=new URL('./scalp-tiers.json',import.meta.url)){
 const data=JSON.parse(readFileSync(file,'utf8'));
 if(JSON.stringify(data.tierPolicy?.order)!==JSON.stringify(['strict','relaxed','probe'])||!Array.isArray(data.tierPolicy?.hardBlocks)||hard.some(k=>!data.tierPolicy.hardBlocks.includes(k)))throw Error('INVALID_TIER_POLICY');
 for(const name of data.tierPolicy.order){const t=data.tiers?.[name];if(!t||Object.keys(t).some(k=>!['sizeFactor','maxOpenPositions','A','B','C'].includes(k))||!(t.sizeFactor>0&&t.sizeFactor<=1)||!Number.isInteger(t.maxOpenPositions)||t.maxOpenPositions<0)throw Error('INVALID_TIER_CONFIG');
  for(const group of ['A','B','C']){if(!t[group]||Object.keys(t[group]).some(k=>!allowed[group].includes(k)))throw Error('TIER_CANNOT_OVERRIDE_SHARED_RULES');for(const [k,v]of Object.entries(t[group]))if(typeof v!=='boolean'&&!Number.isFinite(v))throw Error('INVALID_TIER_THRESHOLD');}
  for(const [k,v]of Object.entries(protectedValues))if((t.A[k]??t.C[k])!==v)throw Error('PROTECTED_TIER_GUARD');
  if(t.C.cSamples!==3||t.C.cSpanMinMs<10000||t.C.cSpanMaxMs<t.C.cSpanMinMs||t.C.cLastAgeMs<=0||t.C.cRiseMin>t.C.cRiseMax||t.A.aSwapM5Min>t.A.aSwapM5Max)throw Error('INVALID_TIER_BOUNDS');
  if(name!=='probe'&&t.B.requireSafety!==true||name==='probe'&&!(t.B.requireSafety===false&&t.B.allowUnverified===true&&t.B.rejectIfKnownBad===true))throw Error('INVALID_TIER_SAFETY');
 }
 return data;
}
export function tierConfig(c,name='strict',snapshot=null){const t=snapshot??c.tiers?.[name];if(!t)return c;return {...c,...t.A,...t.B,...t.C,entryTier:name,entrySizeFactor:t.sizeFactor,maxPositions:t.maxOpenPositions};}
export function activeTiers(c,state,now){
 const count=(state.scalp?.entryTimes??[]).filter(at=>at>=now-c.dayMs).length;
 return c.autoRelax&&count<c.minDailyOrders?c.tierPolicy.order:[c.tierPolicy.order[0]];
}
