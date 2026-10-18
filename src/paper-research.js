import path from 'node:path';
import {readFile,mkdir} from 'node:fs/promises';
import {freshState,recordBuy,recordSell,curveExitPlan} from './engine.js';
import {rankMarket} from './strategy.js';
import {isPumpCurve} from './venues.js';
import {canFundBuy,STRATEGY_VERSION} from './desk-rules.js';
import {writeDurable} from './persistence.js';
import {withRpcPriority} from './rpc-priority.js';
export const PAPER_CONFIG=Object.freeze({version:1,initialSol:1,minDelayMs:2000,quoteIntervalMs:10000,feeAllowanceSol:.000025,refundableRentSol:.003,minimumClosedPerArm:100,arms:[{id:'baseline-5pct',fraction:.05,maxExposure:null},{id:'candidate-2pct',fraction:.02,maxExposure:.1}]});
const fresh=(at,now,ms=30000)=>Number.isFinite(at)&&at<=now&&now-at<=ms;
const initial=()=>({version:1,createdAt:Date.now(),arms:PAPER_CONFIG.arms.map(config=>({config:{...config},ledger:{...freshState(),strategyVersion:STRATEGY_VERSION,cashSol:1,peakEquity:1,settings:{...freshState().settings,initialSol:1}},pending:null,metrics:{closed:0,wins:0,losses:0,grossProfit:0,grossLoss:0,netPnl:0},gaps:0}))});
/** Forward quote-shadow study. It has no signer, private key or broadcast API.
 * Live on-chain reserves already exclude our hypothetical orders; this is NOT a
 * calibrated counterfactual backtest and can never automatically promote a policy.
 */
export class PaperResearch{
 constructor(dir,quoteReadOnly,journal){this.dir=path.join(dir,'research');this.file=path.join(this.dir,'paper-state.json');this.quote=quoteReadOnly;this.journal=journal;this.state=initial();this.busy=null;this.lastQuoteAt=0;this.error=null;this.storageFailed=false;this.pausedForLive=false;}
 async load(){try{const s=JSON.parse(await readFile(this.file,'utf8'));if(s.version!==1||s.arms?.length!==2||s.arms.some((a,i)=>JSON.stringify(a.config)!==JSON.stringify(PAPER_CONFIG.arms[i])||!Number.isFinite(a.ledger?.cashSol)||a.ledger.cashSol<0||!Array.isArray(a.ledger.positions)||!Number.isSafeInteger(a.metrics?.closed)))throw Error('invalid');this.state=s;}catch(e){if(e.code!=='ENOENT'){this.storageFailed=true;this.error='Sổ paper không đọc được; không ghi đè, cần kiểm tra.';}}}
 async save(){await mkdir(this.dir,{recursive:true,mode:0o700});await writeDurable(this.file,this.state);}
 status(){return {mode:'quote-shadow',initialSol:PAPER_CONFIG.initialSol,minimumClosedPerArm:100,readyForLive:false,requiresReplayValidation:true,error:this.error,pausedForLive:this.pausedForLive,limitations:['model-fees-and-rent','no-counterfactual-reserve-path','migration-not-modeled','failed-transaction-costs-not-modeled','quotes-not-guaranteed-fills'],arms:this.state.arms.map(a=>{const m=a.metrics;return {id:a.config.id,fraction:a.config.fraction,closed:m.closed,wins:m.wins,losses:m.losses,open:a.ledger.positions.length,netPnlSol:m.netPnl,expectancySol:m.closed?m.netPnl/m.closed:null,profitFactor:m.grossLoss?m.grossProfit/m.grossLoss:null,winRate:m.closed?m.wins/m.closed:null,maxDrawdownPct:a.ledger.maxDrawdownObservedPct,valuationFresh:a.ledger.positions.every(p=>fresh(p.lastQuoteAt,Date.now())),pending:!!a.pending,dataGaps:a.gaps};})};}
 log(type,arm,extra={}){this.journal?.enqueue({type:'paper_'+type,at:Date.now(),arm:arm.config.id,model:'sdk-quote-shadow',...extra});}
 markEquity(a,now){const l=a.ledger;if(l.positions.some(p=>!fresh(p.lastQuoteAt,now)))return null;const value=l.cashSol+l.positions.reduce((n,p)=>n+(p.lastNetSol??p.costSol),0);l.peakEquity=Math.max(l.peakEquity,value);l.maxDrawdownObservedPct=Math.max(l.maxDrawdownObservedPct,(1-value/l.peakEquity)*100);if(value<=l.peakEquity*.85)l.halted='paper-drawdown-15';return value;}
 tick(feed,{liveBusy=false}={}){this.pausedForLive=liveBusy;if(this.busy||liveBusy||this.storageFailed||Date.now()-this.lastQuoteAt<PAPER_CONFIG.quoteIntervalMs)return this.busy??Promise.resolve();this.lastQuoteAt=Date.now();this.busy=this.step(feed).catch(()=>{this.error='Chưa có paper quote mới; không suy fill từ giá hiển thị.';}).finally(()=>{this.busy=null;});return this.busy;}
 async step(feed){
  const now=Date.now(),requests=[];
  for(const a of this.state.arms){
   const l=a.ledger;this.markEquity(a,now);
   if(a.pending){if(now-a.pending.at>30000){a.gaps++;this.log('no_fill',a,{mint:a.pending.mint,reason:'order-expired'});a.pending=null;}else if(now-a.pending.at>=PAPER_CONFIG.minDelayMs)requests.push({...a.pending,id:a.config.id});continue;}
   const p=l.positions.filter(p=>!fresh(p.lastQuoteAt,now,10000)).sort((a,b)=>(a.lastQuoteAt??0)-(b.lastQuoteAt??0))[0];
   if(p){requests.push({id:a.config.id,kind:'MARK',side:'SELL',mint:p.mint,poolAddress:p.pairAddress,amount:p.rawQuantity,at:p.lastQuoteAt??p.openedAt,reason:l.halted?'drawdown-close':'quote-probe'});continue;}
   if(l.halted||feed.error||!fresh(feed.updatedAt,now)||!(feed.solUsd>0))continue;
   const market=feed.markets.filter(isPumpCurve).map(m=>({...m,rank:rankMarket(m,undefined,now)})).filter(m=>m.rank.eligible&&!l.positions.some(p=>p.mint===m.mint)&&!(l.cooldowns[m.mint]>now)).sort((a,b)=>b.rank.score-a.rank.score)[0];if(!market)continue;
   const size=Math.floor(Math.floor(l.cashSol*1e9+1e-6)*a.config.fraction)/1e9,value=this.markEquity(a,now);
   if(value===null||!size||!canFundBuy(l.cashSol,size,.05)||a.config.maxExposure&&l.positions.reduce((n,p)=>n+p.costSol,0)+size+PAPER_CONFIG.feeAllowanceSol+PAPER_CONFIG.refundableRentSol>value*a.config.maxExposure)continue;
   a.pending={kind:'BUY',side:'BUY',mint:market.mint,poolAddress:market.pairAddress,amount:String(Math.round(size*1e9)),at:now,symbol:String(market.symbol).slice(0,60),priceSol:market.priceUsd/feed.solUsd,reason:'paper-entry'};this.log('signal',a,{mint:market.mint,amount:a.pending.amount,sourceAt:market.updatedAt});
  }
  // Both arms may quote the same mint from one on-chain snapshot. Otherwise FIFO
  // by due time; never more than one mint/read job per 10 seconds.
  requests.sort((a,b)=>(a.at??0)-(b.at??0));const first=requests[0];if(!first){await this.save();return;}
  const batch=requests.filter(r=>r.mint===first.mint&&r.poolAddress===first.poolAddress);
  let quotes;try{quotes=await withRpcPriority('research',()=>this.quote(batch));}catch{for(const r of batch){const a=this.state.arms.find(a=>a.config.id===r.id);a.gaps++;this.log('quote_failed',a,{mint:r.mint});}await this.save();throw Error('paper quote unavailable');}
  for(const r of batch){
   const a=this.state.arms.find(a=>a.config.id===r.id),l=a.ledger,q=quotes.find(q=>q.id===r.id),at=Date.now();
   if(!q||q.failed||q.mint!==r.mint||q.side!==r.side||q.amount!==r.amount||!fresh(q.checkedAt,at,5000)||!/^\d{1,20}$/.test(q.outAmount??'')||BigInt(q.outAmount)<=0n){a.gaps++;this.log('no_fill',a,{mint:r.mint,reason:'quote-unavailable-or-stale'});continue;}
   const market=feed.markets.find(m=>m.mint===r.mint),fee=PAPER_CONFIG.feeAllowanceSol,rent=PAPER_CONFIG.refundableRentSol;
   if(r.kind==='BUY'){
    if(!market||feed.error||!rankMarket(market,undefined,at).eligible||!Number.isFinite(q.spotPriceSol)||Math.abs(q.spotPriceSol/r.priceSol-1)>.02||!Number.isFinite(q.roundTripLossPct)||q.roundTripLossPct<0||q.roundTripLossPct>6||!Number.isFinite(q.impactPct)||q.impactPct>2){this.log('no_fill',a,{mint:r.mint,reason:'entry-no-longer-eligible'});a.pending=null;continue;}
    const size=Number(r.amount)/1e9,cost=size+fee+rent,raw=BigInt(q.outAmount)*9850n/10000n,quantity=Number(raw)/1e6;
    if(!canFundBuy(l.cashSol,size,.05)||!(quantity>0)){a.pending=null;continue;}
    recordBuy(l,market,feed.solUsd,{quantity,costSol:cost,priceUsd:cost*feed.solUsd/quantity,rawQuantity:raw.toString(),decimals:6},at,'paper-entry','paper-shadow');
    const p=l.positions.at(-1);Object.assign(p,{venue:'pumpfun',priceBasis:'sol',entryPriceSol:cost/quantity,lastPriceSol:cost/quantity,peakPriceSol:cost/quantity,nextTakeProfitPriceSol:null,modelRentSol:rent,lastNetSol:null});
    this.log('fill',a,{side:'BUY',mint:r.mint,amount:r.amount,outRaw:raw.toString(),costSol:cost,quoteAt:q.checkedAt,observedDelayMs:at-r.at,assumedNetworkFeeSol:fee,assumedRefundableRentSol:rent});a.pending=null;
   }else{
    const p=l.positions.find(p=>p.mint===r.mint);if(!p)continue;
    const full=BigInt(r.amount)===BigInt(p.rawQuantity),bps=/stop-loss|emergency|trailing|drawdown/.test(r.reason??'')?1000:150,net=Math.max(0,Number(BigInt(q.outAmount)*BigInt(10000-bps)/10000n)/1e9-fee+(full?p.modelRentSol:0));
    if(r.kind==='MARK'){
     p.lastNetSol=net;p.lastQuoteAt=q.checkedAt;const m={...market,mint:p.mint,exitQuote:{mint:p.mint,rawAmount:p.rawQuantity,netSol:net,checkedAt:q.checkedAt,provider:'paper-SDK'}};
     const plan=l.halted?{reason:'drawdown-close',fraction:1}:curveExitPlan(p,m,at);
     if(plan){const amount=plan.fraction>=1?BigInt(p.rawQuantity):BigInt(p.rawQuantity)*BigInt(Math.floor(plan.fraction*1e9))/1000000000n;if(amount>0n)a.pending={kind:'SELL',side:'SELL',mint:p.mint,poolAddress:p.pairAddress,amount:amount.toString(),reason:plan.reason,at};}
    }else{
     const remaining=BigInt(p.rawQuantity)-BigInt(r.amount);if(remaining<0n)throw Error('paper amount mismatch');const quantity=Number(r.amount)/1e6;
     recordSell(l,{mint:p.mint,priceUsd:p.lastPriceUsd,venue:'pumpfun'},p.entrySolUsd,{quantity,proceedsSol:net,priceUsd:net*p.entrySolUsd/quantity,rawBalance:remaining.toString(),closed:remaining===0n,networkFeeSol:fee},at,r.reason,'paper-shadow');
     const trade=l.trades[0];if(trade.closed){const pnl=trade.positionPnlSol,m=a.metrics;m.closed++;m.netPnl+=pnl;if(pnl>0){m.wins++;m.grossProfit+=pnl;}else if(pnl<0){m.losses++;m.grossLoss-=pnl;}}else{p.lastQuoteAt=0;p.lastNetSol=null;}
     this.log('fill',a,{side:'SELL',mint:r.mint,amount:r.amount,netSol:net,reason:r.reason,closed:trade.closed,positionPnlSol:trade.positionPnlSol,assumedNetworkFeeSol:fee,assumedRentReturnedSol:full?p.modelRentSol:0,quoteAt:q.checkedAt,observedDelayMs:at-r.at});a.pending=null;
    }
    this.markEquity(a,at);
   }
  }
  this.error=null;await this.save();
 }
}
