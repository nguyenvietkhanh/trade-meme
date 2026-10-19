import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {writeDurable} from './persistence.js';
import {freshState,recordBuy,recordSell,exitPlan,event} from './engine.js';
import {TRADE_RULES,STRATEGY_VERSION,walletOrderSol,executionSlippageBps,canFundBuy} from './desk-rules.js';
import {rankPaperMarket as rankMarket,PAPER_ENTRY_POLICY} from './paper-policy.js';
import {recordEvaluation} from './scanner.js';
import {entryFeatures} from './training-records.js';
import {reportEnd} from './training-archive.js';
import {withRpcPriority} from './rpc-priority.js';
export const PAPER_MODEL=Object.freeze({initialSol:20,delayMs:2000,feeSol:.000025,rentSol:.00203928,normalFillSlippageBps:150,fill:'fresh quote after 2s; modeled 1.5% slippage (emergency 10%), bounded by quote and original intent; no MEV/inclusion simulation'});
const round=n=>Math.round(n*1e9)/1e9;
const fresh=(t,now)=>Number.isFinite(t)&&t<=now&&now-t<=30000;
export function newPaperState(now=Date.now()){
 const s=freshState(now);return {...s,mode:'paper',paperVersion:1,session:randomUUID(),generation:0,startedAt:now,running:true,automationRequested:true,cashSol:20,peakEquity:20,dayStartEquity:20,strategyVersion:STRATEGY_VERSION,settings:{...TRADE_RULES,initialSol:20,requireExecutableQuote:true},model:PAPER_MODEL,entryPolicy:PAPER_ENTRY_POLICY,pending:null,marks:{},rentLockedSol:0,archiveOutbox:[],telegramOutbox:[],periods:{},reportLastEnd:reportEnd(now),executionErrors:0};
}
export function validPaperState(s){
 return s?.paperVersion===1&&s.mode==='paper'&&typeof s.session==='string'&&Number.isSafeInteger(s.generation)&&s.generation>=0&&Number.isFinite(s.cashSol)&&s.cashSol>=0&&Array.isArray(s.positions)&&Array.isArray(s.trades)&&Array.isArray(s.archiveOutbox)&&s.settings?.initialSol===20&&s.positions.every(p=>typeof p.rawQuantity==='string'&&/^[1-9]\d*$/.test(p.rawQuantity)&&p.quantity>0&&p.costSol>0);
}
export class PaperDesk{
 constructor(dir,quotes,{clock=Date.now}={}){this.dir=dir;this.quotes=quotes;this.clock=clock;this.chain=Promise.resolve();this.busy=false;this.cursor=0;}
 serial(fn){const p=this.chain.then(fn);this.chain=p.catch(()=>{});return p;}
 async load(){
  await mkdir(this.dir,{recursive:true,mode:0o700});const docs=[];let exists=false;
  for(const name of ['ledger.json','ledger.backup.json'])try{const raw=await readFile(path.join(this.dir,name),'utf8');exists=true;const doc=JSON.parse(raw);if(validPaperState(doc))docs.push(doc);}catch(e){if(e.code!=='ENOENT')exists=true;}
  if(!docs.length&&exists)throw Error('Sổ paper bị lỗi; dừng, không tự cấp lại 20 SOL.');
  this.state=docs.sort((a,b)=>b.generation-a.generation)[0]??newPaperState(this.clock());
  // Software rules remain the deployed version; virtual capital is never read from a wallet.
  this.state.settings={...TRADE_RULES,initialSol:20,requireExecutableQuote:true};this.state.model=PAPER_MODEL;this.state.entryPolicy=PAPER_ENTRY_POLICY;this.state.strategyVersion=STRATEGY_VERSION;
  await this.save();
 }
 async save(){if(!validPaperState(this.state))throw Error('Paper ledger invariant failed');this.state.generation++;await writeDurable(path.join(this.dir,'ledger.json'),this.state);await writeDurable(path.join(this.dir,'ledger.backup.json'),this.state);}
 bucket(now=this.clock()){
  const key=reportEnd(now)+86400000;return this.state.periods[key]??=( {evaluations:0,ready:0,skips:0,stages:{},flags:{},providerMessages:{},executionErrors:{},equitySamples:0,maxDrawdownPct:0});
 }
 error(error,now=this.clock()){
  const b=this.bucket(now),text=String(error?.message??error),code=/429/.test(text)?'HTTP_429':/403/.test(text)?'HTTP_403':/NO_ROUTE/.test(text)?'NO_ROUTE':/RPC|slot/i.test(text)?'RPC':/timeout|hết thời gian/i.test(text)?'TIMEOUT':'QUOTE_OR_POLICY';
  b.executionErrors[code]=(b.executionErrors[code]??0)+1;this.state.executionErrors++;event(this.state,`PAPER · chưa khớp: ${code}`,now);
 }
 evaluate(markets,now=this.clock()){
  const b=this.bucket(now);for(const m of markets){const r=rankMarket(m,this.state.settings,now);b.evaluations++;b.baselineReady=(b.baselineReady??0)+(r.baseline.eligible?1:0);b.paperAdditionalReady=(b.paperAdditionalReady??0)+(r.eligible&&!r.baseline.eligible?1:0);b[r.eligible?'ready':'skips']++;b.stages[r.blockingStage]=(b.stages[r.blockingStage]??0)+1;
   for(const flag of r.primaryFlags)b.flags[flag]=(b.flags[flag]??0)+1;
   if(m.verificationError){const text=String(m.verificationError).slice(0,240);b.providerMessages[text]=(b.providerMessages[text]??0)+1;}
   recordEvaluation(this.state,{at:now,mint:m.mint,pairAddress:m.pairAddress,symbol:m.symbol,score:r.score,minScore:r.minScore,blockingStage:r.blockingStage,primaryFlags:r.primaryFlags,missingData:r.missingData,blockingCategory:r.blockingCategory,baseline:r.baseline,relaxedFlags:r.relaxedFlags,action:r.eligible?'WATCH':'SKIP',reason:r.primaryReasons.join('; ')});
  }this.state.lastEvaluationAt=now;
 }
 valuation(now=this.clock()){
  const s=this.state,missing=s.positions.filter(p=>{const q=s.marks[p.mint];return !q||q.rawAmount!==p.rawQuantity||!fresh(q.checkedAt,now);}).map(p=>p.mint);
  const estimate=s.cashSol+s.rentLockedSol+s.positions.reduce((sum,p)=>sum+(s.marks[p.mint]?.rawAmount===p.rawQuantity?s.marks[p.mint].netSol:p.costSol),0);
  return {equitySol:missing.length?null:round(estimate),lastKnownEquitySol:round(estimate),staleMints:missing};
 }
 markEquity(now=this.clock()){
  const s=this.state,v=this.valuation(now);if(v.equitySol===null)return;
  s.peakEquity=Math.max(s.peakEquity,v.equitySol);const dd=Math.max(0,(1-v.equitySol/s.peakEquity)*100);s.maxDrawdownObservedPct=Math.max(s.maxDrawdownObservedPct,dd);
  const b=this.bucket(now);b.equitySamples++;b.maxDrawdownPct=Math.max(b.maxDrawdownPct,dd);s.curve.push({at:now,equitySol:v.equitySol});s.curve=s.curve.slice(-1440);
 }
 quoteValid(q,mint,side,amount,now){if(q?.mint!==mint||q.side!==side||q.inAmount!==amount||!fresh(q.checkedAt,now)||!/^\d+$/.test(q.minOut??'')||BigInt(q.minOut)<=0n||!/^\d+$/.test(q.outAmount??'')||BigInt(q.minOut)>BigInt(q.outAmount)||!Number.isFinite(q.impactPct)||q.impactPct<0||!Number.isSafeInteger(q.contextSlot))throw Error('Quote paper thiếu/không khớp/đã cũ.');}
 async readQuote(mint,side,amount,reason=''){
  const q=await withRpcPriority(side==='SELL'?'exit':'background',()=>this.quotes.quote({mint,side,amount,slippageBps:executionSlippageBps(side,reason)}));this.quoteValid(q,mint,side,amount,this.clock());return q;
 }
 async step(feed){
  if(this.busy)return;this.busy=true;
  try{await this.serial(async()=>{
   const now=this.clock(),s=this.state;
   // Outstanding paper intentions survive restart, but require a new quote; never fabricate fills.
   if(s.pending){if(now>=s.pending.readyAt)await this.fillPending(feed);this.markEquity();await this.save();return;}
   const p=s.positions.length?s.positions[this.cursor++%s.positions.length]:null;
   if(p){const m=feed.markets.find(m=>m.mint===p.mint&&m.pairAddress===p.pairAddress),q=await this.readQuote(p.mint,'SELL',p.rawQuantity);const netSol=Math.max(0,Number(q.minOut)/1e9-PAPER_MODEL.feeSol);
    s.marks[p.mint]={rawAmount:p.rawQuantity,checkedAt:q.checkedAt,netSol,provider:q.provider};
    const roi=(netSol/p.costSol-1)*100;p.paperMfePct=Math.max(p.paperMfePct??roi,roi);p.paperMaePct=Math.min(p.paperMaePct??roi,roi);this.research?.enqueue({type:'paper_position_mark',at:now,mint:p.mint,rawAmount:p.rawQuantity,netSol,checkedAt:q.checkedAt,remainingCostSol:p.costSol,roiPct:roi});
    if(m&&fresh(m.updatedAt,now)&&feed.solUsd>0){const exitQuote={mint:p.mint,rawAmount:p.rawQuantity,checkedAt:q.checkedAt,netSol},mark={...m,priceUsd:netSol*feed.solUsd/p.quantity,exitQuote},plan=exitPlan(p,mark,feed.solUsd,s.settings,now);
     if(plan){let amount=BigInt(p.rawQuantity)*BigInt(Math.round(plan.fraction*1e6))/1000000n;if(plan.fraction===1||BigInt(p.rawQuantity)-amount<=1n)amount=BigInt(p.rawQuantity);
      if(amount>0n){const sellQuote=amount.toString()===p.rawQuantity?q:await this.readQuote(p.mint,'SELL',amount.toString(),plan.reason);s.pending={id:randomUUID(),side:'SELL',mint:p.mint,pairAddress:p.pairAddress,amount:amount.toString(),reason:plan.reason,decisionAt:now,readyAt:this.clock()+PAPER_MODEL.delayMs,benchmark:sellQuote,triggerNetSol:netSol*Number(amount)/Number(p.rawQuantity),openedAt:p.openedAt,entryFeatures:p.entryFeatures};}
     }
    }
   }
   this.markEquity();
   if(!s.pending&&s.running&&fresh(feed.updatedAt,now)&&!feed.error&&feed.solUsd>0&&this.valuation().staleMints.length===0){
    const size=walletOrderSol(s.cashSol);
    if(size>0){const candidates=feed.markets.map(m=>({m,r:rankMarket(m,s.settings,now)})).filter(({m,r})=>r.eligible&&!s.positions.some(p=>p.mint===m.mint)&&!(s.cooldowns[m.mint]>now)).sort((a,b)=>b.r.score-a.r.score);
     for(const {m,r}of candidates){if(Math.abs((m.evidence.probeSol??0)-size)>1e-9||size>m.evidence.quoteReserveSol*.02||!Number.isInteger(m.evidence.decimals))continue;
      const amount=String(Math.round(size*1e9)),q=await this.readQuote(m.mint,'BUY',amount);if(q.impactPct>2)throw Error('Paper BUY impact >2%.');
      s.pending={id:randomUUID(),side:'BUY',mint:m.mint,pairAddress:m.pairAddress,amount,reason:`auto-score:${r.score}`,decisionAt:now,readyAt:this.clock()+PAPER_MODEL.delayMs,benchmark:q,entryFeatures:entryFeatures(m,feed.solUsd),baseline:r.baseline,relaxedFlags:r.relaxedFlags,decimals:m.evidence.decimals};break;
     }
    }
   }await this.save();
  });}catch(e){await this.serial(async()=>{this.error(e);await this.save();});}finally{this.busy=false;}
 }
 async fillPending(feed){
  const s=this.state,o=s.pending,now=this.clock();
  if(now-o.decisionAt>30000){s.pending=null;this.error(Error('timeout pending paper'));return;}
  try{
   const m=feed.markets.find(m=>m.mint===o.mint&&m.pairAddress===o.pairAddress);
   if(!m||!fresh(m.updatedAt,now)||!(feed.solUsd>0))throw Error('Dữ liệu market/giá SOL cũ.');
   if(o.side==='BUY'&&(!s.running||!rankMarket(m,s.settings,now).eligible||Math.abs(walletOrderSol(s.cashSol)-Number(o.amount)/1e9)>1e-9))throw Error('BUY gate changed before paper fill.');
   const q=await this.readQuote(o.mint,o.side,o.amount,o.reason),fillNow=this.clock();
   if(q.checkedAt<o.readyAt)throw Error('Quote chưa mới sau độ trễ paper.');
   if(o.side==='BUY'&&(!fresh(m.updatedAt,fillNow)||!fresh(feed.updatedAt,fillNow)||!rankMarket(m,s.settings,fillNow).eligible))throw Error('BUY evidence expired while waiting for the quote.');
   const limit=executionSlippageBps(o.side,o.reason),benchmark=BigInt(o.benchmark.outAmount),minAllowed=benchmark*BigInt(10000-limit)/10000n;
   if(BigInt(q.outAmount)<minAllowed)throw Error('Giá sau độ trễ vượt slippage cho phép.');
   const haircut=limit===1000?1000:PAPER_MODEL.normalFillSlippageBps,modeledMin=BigInt(q.outAmount)*BigInt(10000-haircut)/10000n;
   const fillOut=[BigInt(q.minOut),modeledMin,minAllowed].reduce((a,b)=>a>b?a:b).toString();
   let costOrNet,position,closed=false;
   if(o.side==='BUY'){
    const size=Number(o.amount)/1e9;if(q.impactPct>2||size>m.evidence.quoteReserveSol*.02||Math.abs(m.evidence.probeSol-size)>1e-9||!canFundBuy(s.cashSol,size,s.settings.reserveSol)||m.evidence.roundTripLossPct+2*PAPER_MODEL.feeSol/size*100>8)throw Error('Paper size/depth/cost limit.');
    const quantity=Number(fillOut)/10**o.decimals;costOrNet=round(size+PAPER_MODEL.feeSol);
    recordBuy(s,m,feed.solUsd,{quantity,costSol:costOrNet,priceUsd:size*feed.solUsd/quantity,rawQuantity:fillOut,decimals:o.decimals,networkFeeSol:PAPER_MODEL.feeSol},fillNow,o.reason,'paper');
    s.cashSol=round(s.cashSol-PAPER_MODEL.rentSol);s.rentLockedSol=round(s.rentLockedSol+PAPER_MODEL.rentSol);
    position=s.positions.at(-1);position.entryFeatures=o.entryFeatures;position.paperBaseline=o.baseline;position.relaxedFlags=o.relaxedFlags;position.rentSol=PAPER_MODEL.rentSol;position.venue='pumpswap';s.decisionStats.bought++;
   }else{
    position=s.positions.find(p=>p.mint===o.mint);if(!position||BigInt(o.amount)>BigInt(position.rawQuantity))throw Error('Paper SELL balance mismatch');
    const remaining=(BigInt(position.rawQuantity)-BigInt(o.amount)).toString(),quantity=Number(o.amount)/10**position.decimals;closed=remaining==='0';costOrNet=round(Math.max(0,Number(fillOut)/1e9-PAPER_MODEL.feeSol));
    const mark={...m,priceUsd:costOrNet*feed.solUsd/quantity};
    recordSell(s,mark,feed.solUsd,{quantity,proceedsSol:costOrNet,priceUsd:mark.priceUsd,closed,rawBalance:remaining,networkFeeSol:PAPER_MODEL.feeSol},fillNow,o.reason,'paper');
    if(closed){s.cashSol=round(s.cashSol+position.rentSol);s.rentLockedSol=round(s.rentLockedSol-position.rentSol);}delete s.marks[o.mint];
   }
   s.cashSol=round(s.cashSol);const trade=s.trades[0];trade.id=o.id;trade.mode='paper';trade.networkFeeSol=null;trade.modeledFeeSol=PAPER_MODEL.feeSol;
   const fill={...trade,session:s.session,pairAddress:o.pairAddress,rawAmount:o.amount,rawOutput:fillOut,decisionAt:o.decisionAt,fillAt:fillNow,holdingMs:o.side==='SELL'?fillNow-position.openedAt:null,benchmark:o.benchmark,fillQuote:q,latencyMs:fillNow-o.decisionAt,quoteAgeAtFillMs:fillNow-q.checkedAt,marketAgeAtFillMs:fillNow-m.updatedAt,outputVsDecisionPct:(Number(fillOut)/Number(o.benchmark.outAmount)-1)*100,netVsTriggerPct:o.side==='SELL'&&o.triggerNetSol>0?(costOrNet/o.triggerNetSol-1)*100:null,entryFeatures:o.entryFeatures??position.entryFeatures,entryPolicy:PAPER_ENTRY_POLICY,baselineAtEntry:o.baseline??position.paperBaseline,relaxedFlagsAtEntry:o.relaxedFlags??position.relaxedFlags,paperMfePct:position.paperMfePct??null,paperMaePct:position.paperMaePct??null,cashAfterSol:s.cashSol,rentLockedSol:s.rentLockedSol,assumptions:PAPER_MODEL};
   s.archiveOutbox.push(fill);s.pending=null;
   event(s,`PAPER · ${o.side} ${m.symbol}: ${costOrNet.toFixed(6)} SOL · ${o.reason}`,fillNow);
  }catch(e){o.attempts=(o.attempts??0)+1;this.error(e);o.readyAt=this.clock()+PAPER_MODEL.delayMs;if(o.attempts>=TRADE_RULES.maxRetries)s.pending=null;}
 }
}
