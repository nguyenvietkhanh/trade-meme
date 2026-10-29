import {smallWalletSizing} from './small-wallet-sizing.js';
import {rulesConfig} from './rules-config.js';import {signalScore,signalTier} from './rules-signal.js';
export const AUTO_SIZING=Object.freeze({maxOrderFraction:.1,maxRiskFraction:.015,assumedLossFraction:.5,poolFraction:.015,reserveSol:.05,executionBufferSol:.005,minOrderSol:.0025,maxPositions:5,frictionCapPct:6});
const down=x=>Math.floor(x*1e9+1e-7)/1e9;
export function planRulesOrder(i,o={},p=rulesConfig()){
 const walletBalance=i.wallet_balance_sol??i.account_equity_sol,valid=[walletBalance,i.account_equity_sol,i.available_capital_sol].every(x=>Number.isFinite(x)&&x>=0),allocationScore=signalScore(i,o,p).score,risk=i.softRisk??{factor:1},signal=signalTier(i,allocationScore,p,risk),tier=i.entry_tier??signal.tier;
 const smallWallet=smallWalletSizing(i.wallet_balance_sol,p);
 const riskBudgetSol=valid?Math.min(i.risk_base_capital_sol??i.available_capital_sol,walletBalance)*p.riskFraction:0,baseRiskSize=riskBudgetSol/p.worstLoss,tierFactor=tier==='QUICK'?p.quickSizeMultiplier:tier==='PROBE'?p.probeSizeMultiplier:1,target=valid?baseRiskSize*tierFactor*(risk.factor??1):0,maxOrder=valid?(smallWallet.active?smallWallet.maxSol:down(walletBalance*p.maxOrderFraction)):0,depthCap=Number.isFinite(i.quote_reserve_sol)?down(i.quote_reserve_sol*p.poolFraction):0;
 const spendable=valid?Math.max(0,Math.min(i.available_capital_sol,walletBalance-p.reserveSol-p.bufferSol)):0,exposureRemaining=valid?Math.max(0,i.account_equity_sol*p.exposureFraction-(i.open_exposure_sol??0)):0;
 const legacyFlooredTarget=tier==='QUICK'&&baseRiskSize*(risk.factor??1)>=p.minOrderSol?Math.max(target,p.minOrderSol):target;
 const minimumOrderSol=Math.max(p.minOrderSol,smallWallet.minSol),flooredTarget=smallWallet.active?Math.max(legacyFlooredTarget,minimumOrderSol):legacyFlooredTarget;
 let size=down(Math.max(0,Math.min(flooredTarget,maxOrder,spendable,depthCap,exposureRemaining)));if(risk.minimal&&size>=minimumOrderSol)size=minimumOrderSol;
 if(Number.isFinite(i.quote_selected_sol))size=down(Math.min(size,i.quote_selected_sol));
 const minimumBlocked=smallWallet.active&&Math.round(size*1e9)<smallWallet.minLamports;if(minimumBlocked)size=0;
 return {smallWallet,minimumOrderSol,minimumBlocked,baseRiskSize,tierFactor,walletBalance,allocationScore,riskFraction:p.riskFraction,assumedLossFraction:p.worstLoss,riskBudgetSol,fraction:walletBalance>0?size/walletBalance:0,maxOrder,target,depthCap,size,tier,softRisk:risk,exposureRemaining};
}
