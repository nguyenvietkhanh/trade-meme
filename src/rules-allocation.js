import {scoreRules} from './rules-score.js';
export const AUTO_SIZING=Object.freeze({maxOrderFraction:.5,reserveSol:.05,executionBufferSol:.005,minOrderSol:.0025,maxPositions:5,frictionCapPct:8});
const finite=Number.isFinite,down=x=>Math.floor(x*1e9+1e-7)/1e9;
// Size is chosen before quoting, so a quote's friction penalty cannot create a sizing loop.
// Available capital already excludes pending reservations, profit reserves and gas.
export function planRulesOrder(i,observed={}){
 const walletBalance=i.wallet_balance_sol??i.account_equity_sol;
 const valid=[walletBalance,i.account_equity_sol,i.available_capital_sol].every(x=>finite(x)&&x>=0);
 const allocationScore=scoreRules(i,observed,{mode:'AUTO',friction:0}).score;
 const fraction=Math.min(.5,Math.max(.1,Math.round((.1+(allocationScore-6)*.1)*10000)/10000));
 const maxOrder=valid?down(Math.min(walletBalance,i.account_equity_sol)*.5):0;
 const target=valid?down(walletBalance*fraction):0;
 const depthCap=finite(i.quote_reserve_sol)&&i.quote_reserve_sol>=0?down(i.quote_reserve_sol*.02):Infinity;
 const spendable=valid?Math.max(0,Math.min(i.available_capital_sol,walletBalance-AUTO_SIZING.reserveSol-AUTO_SIZING.executionBufferSol)):0;
 const size=down(Math.max(0,Math.min(target,maxOrder,spendable,depthCap)));
 return {walletBalance,allocationScore,fraction,maxOrder,target,depthCap,size};
}
