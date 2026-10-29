// SCALP-only override. Amounts are native SOL balance, never equity or unreserved cash.
export const SMALL_WALLET_SIZING=Object.freeze({thresholdSol:1,minFraction:.2,thresholdLamports:1000000000});
export function smallWalletSizing(balanceSol,policy={}){
 const lamports=Number.isFinite(balanceSol)&&balanceSol>=0?Math.round(balanceSol*1e9):null;
 const active=policy.smallWalletOrderEnabled!==false&&Number.isSafeInteger(lamports)&&lamports>0&&lamports<=SMALL_WALLET_SIZING.thresholdLamports;
 const minLamports=active?Math.ceil(lamports/5):0,maxFraction=active?Math.max(policy.maxOrderFraction??.1,SMALL_WALLET_SIZING.minFraction):policy.maxOrderFraction??.1;
 // Ceiling rounds UP to the same lamport as the minimum; a fractional lamport never makes a valid order impossible.
 const maxLamports=Number.isSafeInteger(lamports)?Math.max(active?minLamports:0,Number(BigInt(lamports)*BigInt(Math.floor(maxFraction*1000000))/1000000n)):0;
 return {active,balanceLamports:lamports,minLamports,minSol:minLamports/1e9,maxLamports,maxSol:maxLamports/1e9,maxFraction,thresholdSol:SMALL_WALLET_SIZING.thresholdSol,minFraction:active?SMALL_WALLET_SIZING.minFraction:0};
}
