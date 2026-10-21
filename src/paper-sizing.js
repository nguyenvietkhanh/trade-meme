import {TRADE_RULES,canFundBuy} from './desk-rules.js';

export const PAPER_SIZING=Object.freeze({version:'paper-capital-2p5-v1',fraction:.025,reserveSol:.1,overheadSol:.005,minOrderSol:.0025,basis:'cash + locked rent + remaining position cost; unrealized gains excluded'});
// Cost basis avoids forcing a synchronous quote of every holding before a BUY.
// It is an allocation reference, not a claim that stale holdings are worth their cost.
export function paperCapitalSol(state){
 const s=typeof state==='number'?{cashSol:state,positions:[],rentLockedSol:0}:state;
 const values=[s?.cashSol,s?.rentLockedSol??0,...(s?.positions??[]).map(p=>p.costSol)];
 if(values.some(v=>!Number.isFinite(v)||v<0))return 0;
 const lamports=values.reduce((n,v)=>n+Math.round(v*1e9),0);
 return Number.isSafeInteger(lamports)?lamports/1e9:0;
}
export function paperOrderSol(state){
 const cash=typeof state==='number'?state:state?.cashSol,capital=paperCapitalSol(state);
 if(!Number.isFinite(cash)||cash<0||!capital)return 0;
 const available=Math.floor(cash*1e9+1e-6)-Math.round((PAPER_SIZING.reserveSol+PAPER_SIZING.overheadSol)*1e9);
 const amount=Math.min(Math.floor(Math.round(capital*1e9)/40),available),size=amount/1e9;
 return size>=PAPER_SIZING.minOrderSol&&canFundBuy(cash,size,TRADE_RULES.reserveSol,PAPER_SIZING.overheadSol)?size:0;
}
