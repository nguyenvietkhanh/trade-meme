import {PROFIT_RECIPIENT,PROFIT_RULES} from './desk-rules.js';
export {PROFIT_RECIPIENT};

// Native SOL basis: unrealized appreciation never finances a transfer. Fees remain reserved.
export function availableProfitLamports({cashSol,initialSol,realizedNetSol,withdrawnSol=0,payoutFeesSol=0,remainingCostSol=0,recoverableNetSol=realizedNetSol},walletBalance){
 const amounts=[cashSol,initialSol,realizedNetSol,withdrawnSol,payoutFeesSol,remainingCostSol,recoverableNetSol,walletBalance];
 if(amounts.some(n=>!Number.isFinite(n))||initialSol<=0||initialSol>.3||withdrawnSol<0||payoutFeesSol<0||remainingCostSol<0||remainingCostSol>initialSol)return 0;
 const surplus=Math.floor((cashSol+remainingCostSol-initialSol)*1e9+1e-6),earned=Math.floor((Math.min(realizedNetSol,recoverableNetSol)-withdrawnSol-payoutFeesSol)*1e9+1e-6),spendable=Math.floor(walletBalance*1e9)-Math.max(PROFIT_RULES.reserveLamports,Math.ceil((initialSol-remainingCostSol)*1e9));
 const value=Math.min(surplus,earned,spendable,PROFIT_RULES.maxTransferLamports+PROFIT_RULES.feeBufferLamports)-PROFIT_RULES.feeBufferLamports;
 return Number.isSafeInteger(value)&&value>=PROFIT_RULES.minTransferLamports?value:0;
}
export function profitState(s){
 const remainingCostSol=s.positions.reduce((sum,p)=>sum+p.costSol,0),unrecoveredPartialProfit=s.positions.reduce((sum,p)=>sum+Math.max(0,p.realizedPnlSol??0)-Math.max(0,(p.realizedPnlSol??0)-p.costSol),0);
 return {cashSol:s.cashSol,initialSol:s.settings.initialSol,realizedNetSol:s.realizedNetSol??0,recoverableNetSol:(s.realizedNetSol??0)-unrecoveredPartialProfit,remainingCostSol,withdrawnSol:s.withdrawnSol??0,payoutFeesSol:s.payoutFeesSol??0};
}
export function profitOrder(s,walletBalance){
 const amount=availableProfitLamports(profitState(s),walletBalance);
 return amount?{side:'PROFIT',symbol:'SOL',recipient:PROFIT_RECIPIENT,amount:String(amount),reason:'realized-profit',profitState:profitState(s)}:null;
}
