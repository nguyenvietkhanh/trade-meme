import path from 'node:path';
import {readFile,mkdir} from 'node:fs/promises';
import {freshState} from './engine.js';
import {STRATEGY_VERSION} from './desk-rules.js';
import {writeDurable} from './persistence.js';
export const PAPER_CONFIG=Object.freeze({version:1,initialSol:1,minDelayMs:2000,quoteIntervalMs:10000,feeAllowanceSol:.000025,refundableRentSol:.003,minimumClosedPerArm:100,arms:[{id:'baseline-5pct',fraction:.05,maxExposure:null},{id:'candidate-2pct',fraction:.02,maxExposure:.1}]});
const fresh=(at,now,ms=30000)=>Number.isFinite(at)&&at<=now&&now-at<=ms;
const initial=()=>({version:1,createdAt:Date.now(),arms:PAPER_CONFIG.arms.map(config=>({config:{...config},ledger:{...freshState(),strategyVersion:STRATEGY_VERSION,cashSol:1,peakEquity:1,settings:{...freshState().settings,initialSol:1}},pending:null,metrics:{closed:0,wins:0,losses:0,grossProfit:0,grossLoss:0,netPnl:0},gaps:0}))});
/** Read-only runtime archive of the retired curve study; no quote worker or new fills. */
export class PaperResearch{
 constructor(dir,quoteReadOnly,journal){this.dir=path.join(dir,'research');this.file=path.join(this.dir,'paper-state.json');this.journal=journal;this.state=initial();this.busy=null;this.lastQuoteAt=0;this.error=null;this.storageFailed=false;this.pausedForLive=false;}
 async load(){try{const s=JSON.parse(await readFile(this.file,'utf8'));if(s.version!==1||s.arms?.length!==2||s.arms.some((a,i)=>JSON.stringify(a.config)!==JSON.stringify(PAPER_CONFIG.arms[i])||!Number.isFinite(a.ledger?.cashSol)||a.ledger.cashSol<0||!Array.isArray(a.ledger.positions)||!Number.isSafeInteger(a.metrics?.closed)))throw Error('invalid');this.state=s;}catch(e){if(e.code!=='ENOENT'){this.storageFailed=true;this.error='Sổ paper không đọc được; không ghi đè, cần kiểm tra.';}}}
 async save(){await mkdir(this.dir,{recursive:true,mode:0o700});await writeDurable(this.file,this.state);}
 status(){return {mode:'archived',disabled:true,reason:'pre-migration-disabled',initialSol:PAPER_CONFIG.initialSol,minimumClosedPerArm:100,readyForLive:false,requiresReplayValidation:true,error:this.error,pausedForLive:this.pausedForLive,limitations:['model-fees-and-rent','no-counterfactual-reserve-path','migration-not-modeled','failed-transaction-costs-not-modeled','quotes-not-guaranteed-fills'],arms:this.state.arms.map(a=>{const m=a.metrics;return {id:a.config.id,fraction:a.config.fraction,closed:m.closed,wins:m.wins,losses:m.losses,open:a.ledger.positions.length,netPnlSol:m.netPnl,expectancySol:m.closed?m.netPnl/m.closed:null,profitFactor:m.grossLoss?m.grossProfit/m.grossLoss:null,winRate:m.closed?m.wins/m.closed:null,maxDrawdownPct:a.ledger.maxDrawdownObservedPct,valuationFresh:a.ledger.positions.every(p=>fresh(p.lastQuoteAt,Date.now())),pending:!!a.pending,dataGaps:a.gaps};})};}
 log(type,arm,extra={}){this.journal?.enqueue({type:'paper_'+type,at:Date.now(),arm:arm.config.id,model:'sdk-quote-shadow',...extra});}
 markEquity(a,now){const l=a.ledger;if(l.positions.some(p=>!fresh(p.lastQuoteAt,now)))return null;const value=l.cashSol+l.positions.reduce((n,p)=>n+(p.lastNetSol??p.costSol),0);l.peakEquity=Math.max(l.peakEquity,value);l.maxDrawdownObservedPct=Math.max(l.maxDrawdownObservedPct,(1-value/l.peakEquity)*100);if(value<=l.peakEquity*.85)l.halted='paper-drawdown-15';return value;}
 tick(feed,{liveBusy=false}={}){return Promise.resolve();}
}
