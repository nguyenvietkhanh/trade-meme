// User-authorized live account policy. Trading signals and stop levels come
// from the model; these limits constrain money movement, not market selection.
export const AI_POLICY=Object.freeze({reserveLamports:50_000_000,executionBufferLamports:5_000_000,maxBuyFraction:.9,profitFeeBufferLamports:10_000,telegramChatId:'1766285817',pollMs:5000});
export function aiMarketCap(m){const cap=m.marketCapUsd??(m.valuationSource==='marketCap'?m.valuationUsd:null);return Number.isFinite(cap)&&cap>0?cap:null;}
export function aiMarketEligible(m){return Number.isFinite(m.change5mPct)&&m.change5mPct>0;}
export function compareAIMarkets(a,b){return (b.change5mPct??-Infinity)-(a.change5mPct??-Infinity)||(b.volume5mUsd??0)-(a.volume5mUsd??0)||a.mint.localeCompare(b.mint);}
export const validAIStop=x=>Number.isFinite(x)&&x>0&&x<100;
export function aiBuyLimit(balanceLamports,availableLamports){
 if(!Number.isSafeInteger(balanceLamports)||!Number.isSafeInteger(availableLamports))return 0;
 return Math.max(0,Math.min(Number(BigInt(balanceLamports)*9n/10n),availableLamports));
}

export function validAIRisk(r){return r?.approved===true&&typeof r.reason==='string'&&r.reason.trim().length>0&&r.reason.length<=300&&['risks','unknowns'].every(k=>Array.isArray(r[k])&&r[k].length<=8&&r[k].every(v=>typeof v==='string'&&v.length>0&&v.length<=100));}
export function cleanAIRisk(r){return {approved:r.approved,reason:r.reason.replace(/[\u0000-\u001f]/g,' ').slice(0,300),risks:r.risks.map(v=>v.replace(/[\u0000-\u001f]/g,' ')),unknowns:r.unknowns.map(v=>v.replace(/[\u0000-\u001f]/g,' '))};}
