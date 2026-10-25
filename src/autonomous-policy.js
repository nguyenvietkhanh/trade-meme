// User-authorized live account policy. Trading signals and stop levels come
// from the model; these limits constrain money movement, not market selection.
export const AI_POLICY=Object.freeze({reserveLamports:50_000_000,executionBufferLamports:5_000_000,maxBuyFraction:.9,profitFeeBufferLamports:10_000,telegramChatId:'1766285817',pollMs:5000});
export const validAIStop=x=>Number.isFinite(x)&&x>0&&x<100;
export function aiBuyLimit(balanceLamports,availableLamports){
 if(!Number.isSafeInteger(balanceLamports)||!Number.isSafeInteger(availableLamports))return 0;
 return Math.max(0,Math.min(Number(BigInt(balanceLamports)*9n/10n),availableLamports));
}
