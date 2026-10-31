import {readFileSync} from 'node:fs';
export const SCALP_VERSION='paper-meme-scalp-entry-v1';
export function scalpConfig(env=process.env){
 const defaults=JSON.parse(readFileSync(new URL('./scalp-config.json',import.meta.url),'utf8'));
 const override=env.PAPER_SCALP_CONFIG?JSON.parse(readFileSync(env.PAPER_SCALP_CONFIG,'utf8')):{};
 for(const key of Object.keys(override))if(!(key in defaults))throw Error('UNKNOWN_SCALP_CONFIG: '+key);
 const c={...defaults,...override};
 for(const [key,value]of Object.entries(c)){
  const name='SCALP_'+key.replace(/[A-Z]/g,m=>'_'+m).toUpperCase(),raw=env[name];
  if(raw!==undefined)c[key]=typeof value==='number'?Number(raw):typeof value==='boolean'?raw==='true':Array.isArray(value)?JSON.parse(raw):raw;
  if(typeof value==='number'&&!Number.isFinite(c[key]))throw Error('INVALID_SCALP_CONFIG: '+name);
  if(typeof value==='number'&&value>=0&&c[key]<0)throw Error('INVALID_SCALP_CONFIG: '+name);
  if(Array.isArray(value)&&(!Array.isArray(c[key])||!c[key].length))throw Error('INVALID_SCALP_CONFIG: '+name);
 }
 if(c.version!==SCALP_VERSION||c.cSamples!==3||c.cMaxStoredSamples<c.cSamples||c.cSpanMinMs<c.cGapMs*2||c.cTargetGapMs*2<c.cSpanMinMs||c.cSpanMaxMs<c.cSpanMinMs||c.minOrderSol<=0||c.fixedOrderSol<c.minOrderSol||c.maxCandidates>100||c.maxPositions<1||c.maxExposureFraction>1||c.poolFraction>1||c.maxBackground<1||c.maxBackground>4||c.scanMs<1000||c.priceTtlMs<=0||c.slippageBps<=0||c.slippageBps>=10000||c.emergencySlippageBps>=10000||c.logQuotaMiB<=0)throw Error('INVALID_SCALP_CONFIG_BOUNDS');
 if(c.dBackoffMs.length!==c.dInfraRetries||c.dBackoffMs.some(x=>!Number.isFinite(x)||x<0)||c.dSizeFractions.some((x,i,a)=>!Number.isFinite(x)||x<=0||x>1||(i>0&&x>=a[i-1]))||c.cRiseMin>c.cRiseMax||c.tp1Fraction<=0||c.tp1Fraction>=1||c.stopPct<=0||c.stopPct>=100)throw Error('INVALID_SCALP_CONFIG_SEQUENCE');
 return {...c,scalpEntry:true,momentumOnly:true,guardedEntry:false,simulationOnly:true,maxEntryQuoteAgeMs:c.dQuoteAgeMs,maxSellQuoteAgeMs:c.dQuoteAgeMs};
}
