import {independentSignal} from './paper-score.js';
import {FILL_MODEL,INDEPENDENT_VERSION,breakEvenScenarios} from './paper-bot-config.js';
import {paperOrderSol} from './paper-sizing.js';
import {scalpExitPlan} from './paper-scalp.js';
import {sol,lamports} from './paper-bot-state.js';
import {updateAgentMetrics} from './paper-agent-metrics.js';
const fresh=(at,now,max)=>Number.isFinite(at)&&at<=now&&now-at<=max;
export class BotRuntime{
 constructor(config,state,{execute,save=async()=>{},log=()=>{}}={}){this.config=config;this.state=state;this.execute=execute;this.save=save;this.log=log;this.busy=false;this.breakEven=breakEvenScenarios(config,paperOrderSol(state));}
 random(){let x=this.state.seed;x^=x<<13;x^=x>>>17;x^=x<<5;this.state.seed=x>>>0;return this.state.seed/4294967296;}
 id(kind){return this.state.id+':'+INDEPENDENT_VERSION+':'+kind+':'+(++this.state.sequence);}
 error(error,now){const s=this.state;s.failures++;s.lastError={at:now,code:error.code??'BOT_ERROR',message:String(error.message).slice(0,250)};s.outbox.push({type:'error',id:this.id('error'),bot:s.id,ts:now,...s.lastError});if(s.failures>=3)s.breakerUntil=now+Math.min(60000,1000*2**Math.min(s.failures,6));this.log(s.lastError);}
 async tick(snapshot,now=snapshot.timestamp){
  if(this.busy)return;this.busy=true;const s=this.state;
  try{
   s.heartbeatAt=now;const markets=snapshot.markets??[];
   this.mark(markets,snapshot.solUsd,now);
   if(s.pending&&now>=s.pending.readyAt)await this.fill(snapshot,now);
   if(!s.pending)this.monitor(snapshot,now);
   if(now>=s.nextAt){s.nextAt=now+Math.round(this.config.scanIntervalMs*(.9+.2*this.random()));this.evaluate(snapshot,now);}
   await this.save(s);
  }catch(error){this.error(error,now);await this.save(s);}finally{this.busy=false;}
 }
 evaluate(snapshot,now){
  const s=this.state,c=this.config,depths=snapshot.markets.filter(m=>Number.isFinite(m.liquidityUsd)).map(m=>m.liquidityUsd).sort((a,b)=>a-b),cutoff=depths[Math.floor(depths.length*.75)],decisions=[];
  s.signalLiquidityCutoff=cutoff??null;s.cycle++;for(const m of [...snapshot.markets].sort((a,b)=>a.mint.localeCompare(b.mint))){
   const k=m.mint+':'+m.pairAddress,prior=s.anchors[k];const d=independentSignal(c,m,now,{prior,snapshotId:snapshot.snapshotId,liquidityCutoff:cutoff,cooldownUntil:s.cooldowns[m.mint]??0});
   if(d.structural){if(!prior||now-prior.at>60000)s.anchors[k]={structural:true,at:now,sourceAt:m.updatedAt,snapshotId:snapshot.snapshotId,priceUsd:m.priceUsd,liquidityUsd:m.liquidityUsd};}else delete s.anchors[k];
   let action=d.eligible?'BUY':d.stage==='strategy-data'||d.stage==='confirmation'||d.stage==='discovery'?'WAIT':'SKIP',reason=d.reason,stage=d.stage;
   if(d.eligible&&(!s.running||s.positions.length||s.pending||now<s.breakerUntil||!paperOrderSol(s))){action='WAIT';stage='wallet';reason=!s.running?'BUY tạm dừng':s.positions.length?'Đang theo dõi vị thế riêng':s.pending?'Ý định riêng đang chờ':now<s.breakerUntil?'Circuit breaker riêng':'Không đủ vốn ví riêng';}
   const row={type:'decision',id:this.id('decision'),ts:now,at:now,snapshotId:snapshot.snapshotId,bot:c.id,agentId:c.id,token:m.mint,mint:m.mint,pairAddress:m.pairAddress,symbol:m.symbol,action,decision:action,reason,stage,blockingStage:stage,eligible:action==='BUY',score:d.score,minScore:d.minScore,scoreParts:d.scoreParts,checks:d.checks,conditionRatio:d.conditionRatio,quoteSource:null,configVersion:c.version};
   s.scoreHistogram[d.score]++;s.evaluations++;s.outbox.push(row);decisions.push(row);
  }
  s.decisions=[...decisions,...s.decisions].slice(0,100);s.signal={at:now,cycle:s.cycle,evaluated:decisions.length,eligible:decisions.filter(d=>d.eligible).length,decisions,stages:Object.fromEntries([...new Set(decisions.map(d=>d.stage))].map(k=>[k,decisions.filter(d=>d.stage===k).length]))};
  const best=decisions.filter(d=>d.eligible).sort((a,b)=>b.score-a.score||a.mint.localeCompare(b.mint))[0];
  if(best&&!s.pending&&!s.positions.length){const m=snapshot.markets.find(m=>m.mint===best.mint&&m.pairAddress===best.pairAddress),size=paperOrderSol(s);s.pending={id:this.id('buy'),side:'BUY',mint:m.mint,pairAddress:m.pairAddress,symbol:m.symbol,amount:String(lamports(size)),decisionAt:now,readyAt:now+FILL_MODEL.delayMs,reason:'signal:'+c.id,signal:best,attempts:0};}
  for(const [k,a]of Object.entries(s.anchors))if(now-a.at>60000)delete s.anchors[k];
 }
 monitor(snapshot,now){
  const s=this.state;for(const p of s.positions){const m=snapshot.markets.find(m=>m.mint===p.mint&&m.pairAddress===p.pairAddress),price=m?.spotPriceSol??(m?.priceUsd/snapshot.solUsd),at=m?.priceAt??m?.updatedAt;
   const valid=fresh(at,now,FILL_MODEL.maxPriceAgeMs)&&price>0,net=valid?Math.max(0,p.quantity*price*.985-FILL_MODEL.feeSol):null;
   const observed={...m,updatedAt:at,exitQuote:valid?{mint:p.mint,rawAmount:p.rawQuantity,checkedAt:at,netSol:net,provider:m.priceSource??'spot-model'}:null};const plan=this.exitPlan?this.exitPlan(p,observed,now):scalpExitPlan(p,observed,now);
   if(!plan||this.allowExit?.(plan,p)===false)continue;const raw=BigInt(p.rawQuantity),amount=plan.fraction===1?raw:raw*BigInt(Math.round(plan.fraction*10000))/10000n;if(amount<=0n)continue;
   s.pending={id:this.id('sell'),side:'SELL',mint:p.mint,pairAddress:p.pairAddress,symbol:p.symbol,positionId:p.paperPositionId,amount:String(amount),decisionAt:now,readyAt:now+FILL_MODEL.delayMs,reason:plan.reason,trigger:plan.trigger,stopLossPct:p.exitPolicy.stopLossPct,decisionEngine:p.controlMode==='model'?'model-safety':'rules',modelName:p.modelName??null,attempts:0};break;
  }
 }
 async fill(snapshot,now){
  const s=this.state,o=s.pending,m=snapshot.markets.find(m=>m.mint===o.mint&&m.pairAddress===o.pairAddress);if(!m)return;
  if(o.side==='BUY'&&(now-o.decisionAt>30000||!s.running)){s.pending=null;return;}
  // Recheck signal/lanes at execution, without requiring a new confirmation anchor.
  if(o.side==='BUY'&&o.decisionEngine!=='model'){
   const signal=independentSignal(this.config,m,now,{snapshotId:snapshot.snapshotId,prior:s.anchors[o.mint+':'+o.pairAddress],liquidityCutoff:s.signalLiquidityCutoff,cooldownUntil:s.cooldowns[o.mint]??0});
   if(!signal.structural){s.pending=null;return;}
  }
  try{
   const result=await this.execute({...o,minObservedAt:o.readyAt},m),q=result.quote,fillNow=result.observedNow??now;
   if(q.mint!==o.mint||q.side!==o.side||q.inAmount!==o.amount||!fresh(q.checkedAt,fillNow,5000)||q.checkedAt<o.readyAt||!/^\d+$/.test(q.outAmount))throw Error('Invalid fresh exact-size execution');
   if(o.side==='BUY'&&(!Number.isFinite(result.roundTripLossPct)||result.roundTripLossPct>this.config.entryRules.maxRoundTripLossPct))throw Error('Round trip exceeds configured cost gate');
   const haircut=o.reason==='emergency-risk'?FILL_MODEL.emergencyHaircutBps:FILL_MODEL.normalHaircutBps,out=BigInt(q.outAmount)*BigInt(10000-haircut)/10000n;
   if(out<=0n)throw Error('Empty modeled output');
   if(o.side==='BUY'&&o.decisionEngine==='model'){const expected=Number(o.amount)/1e9/o.referencePriceSol*10**result.decimals;if(!(expected>0)||Number(out)<expected*.96)throw Error('MODEL_BUY_SLIPPAGE_LIMIT');}
   const f={type:'fill',id:o.id,at:fillNow,ts:fillNow,agentId:s.id,bot:s.id,mint:o.mint,pairAddress:o.pairAddress,symbol:o.symbol,side:o.side,reason:o.reason,mode:'paper',agentPolicyVersion:INDEPENDENT_VERSION,decisionEngine:o.decisionEngine??'rules',modelName:o.modelName??null,modelConfidence:o.confidence??null,modeledFeeSol:FILL_MODEL.feeSol,quoteSource:result.quoteSource,execution:{decisionAt:o.decisionAt,fillAt:fillNow,quoteObservedAt:q.checkedAt,quotedOutput:q.outAmount,filledOutput:String(out),assumedHaircutBps:haircut,trigger:o.trigger??null},gapLoss:false};
   if(o.side==='BUY'){
    const spend=Number(o.amount)/1e9,cost=sol(spend+FILL_MODEL.feeSol),total=sol(cost+FILL_MODEL.rentSol);if(total>s.cashSol||s.positions.length)throw Error('Own wallet insufficient');
    if(!Number.isInteger(result.decimals)||result.decimals<0||result.decimals>18)throw Error('Missing token decimals');
    const quantity=Number(out)/10**result.decimals;s.cashSol=sol(s.cashSol-total);s.rentLockedSol=sol(s.rentLockedSol+FILL_MODEL.rentSol);
    s.positions.push({mint:o.mint,pairAddress:o.pairAddress,symbol:o.symbol,agentId:s.id,paperPositionId:o.id,quantity,rawQuantity:String(out),decimals:result.decimals,costSol:cost,initialCostSol:cost,openedAt:fillNow,rentSol:FILL_MODEL.rentSol,realizedPnlSol:0,controlMode:o.decisionEngine??'rules',modelName:o.modelName??null,exitPolicy:this.config.exitPolicy,entryPolicy:this.config.entryRules,entrySignal:o.signal,entryLiquidityUsd:m.liquidityUsd,peakLiquidityUsd:m.liquidityUsd,phase:'open'});
    f.sol=cost;f.positionId=o.id;f.initialCostSol=cost;f.entryDecisionEngine=o.decisionEngine??'rules';
   }else{
    const p=s.positions.find(p=>p.paperPositionId===o.positionId);if(!p||BigInt(o.amount)>BigInt(p.rawQuantity))throw Error('Own position unavailable');
    const amount=BigInt(o.amount),previous=BigInt(p.rawQuantity),closed=amount===previous,fraction=Number(amount)/Number(previous),allocatedCost=closed?p.costSol:sol(p.costSol*fraction),net=sol(Math.max(0,Number(out)/1e9-FILL_MODEL.feeSol)),pnl=sol(net-allocatedCost);
    s.cashSol=sol(s.cashSol+net);s.realizedPnlSol=sol(s.realizedPnlSol+pnl);p.realizedPnlSol=sol((p.realizedPnlSol??0)+pnl);p.costSol=sol(p.costSol-allocatedCost);p.rawQuantity=String(previous-amount);p.quantity=Number(previous-amount)/10**p.decimals;
    Object.assign(f,{sol:net,pnlSol:pnl,closed,positionId:p.paperPositionId,initialCostSol:p.initialCostSol,positionPnlSol:closed?p.realizedPnlSol:null,holdingMs:fillNow-p.openedAt,entryDecisionEngine:p.controlMode??'rules'});
    const roi=(net/allocatedCost-1)*100;f.gapLoss=o.reason==='stop-loss'&&roi<-(o.stopLossPct??p.exitPolicy.stopLossPct);f.execution.actualRoiPct=roi;f.execution.stopLossPct=o.stopLossPct;
    if(closed){s.cashSol=sol(s.cashSol+(p.rentSol??0));s.rentLockedSol=sol(s.rentLockedSol-(p.rentSol??0));s.positions=s.positions.filter(x=>x!==p);}else p.scalpFirstTaken=true;
   }
   const g=s.metrics={fills:0,buys:0,sells:0,closed:0,wins:0,closedPnlSol:0,grossProfitSol:0,grossLossSol:0,...s.metrics};g.fills++;g[f.side==='BUY'?'buys':'sells']++;
   if(f.side==='SELL'&&f.closed){g.closed++;g.closedPnlSol=sol(g.closedPnlSol+f.positionPnlSol);if(f.positionPnlSol>0){g.wins++;g.grossProfitSol=sol(g.grossProfitSol+f.positionPnlSol);}else g.grossLossSol=sol(g.grossLossSol-f.positionPnlSol);}updateAgentMetrics(g,f);g.lastFill=f;
   s.outbox.push({type:'decision',id:this.id('execution'),ts:fillNow,at:fillNow,snapshotId:snapshot.snapshotId,bot:s.id,agentId:s.id,token:o.mint,mint:o.mint,pairAddress:o.pairAddress,action:o.side,decision:o.side,reason:o.reason,stage:'execution-filled',score:o.signal?.score??null,scoreParts:o.signal?.scoreParts??null,minScore:this.config.entryRules.minScore,checks:o.signal?.checks??[],quoteSource:f.quoteSource,orderId:o.id});
   s.cooldowns[o.mint]=fillNow+this.config.entryRules.reentryMs;s.trades=[f,...s.trades].slice(0,500);s.outbox.push(f);s.pending=null;s.failures=0;s.breakerUntil=0;
  }catch(error){o.attempts++;o.lastError=String(error.message).slice(0,150);o.readyAt=now+FILL_MODEL.delayMs;this.error(error,now);if(o.side==='BUY'&&o.attempts>=3)s.pending=null;}
 }
 mark(markets,solUsd,now){
  const s=this.state,values=s.positions.map(p=>{const m=markets.find(m=>m.mint===p.mint&&m.pairAddress===p.pairAddress),price=m?.spotPriceSol??m?.priceUsd/solUsd;return fresh(m?.priceAt??m?.updatedAt,now,FILL_MODEL.maxPriceAgeMs)&&price>0?Math.max(0,p.quantity*price*.985-FILL_MODEL.feeSol):null;});
  s.equitySol=values.some(v=>v===null)?null:sol(s.cashSol+s.rentLockedSol+values.reduce((n,v)=>n+v,0));
  if(s.equitySol!==null){s.peakEquity=Math.max(s.peakEquity,s.equitySol);s.maxDrawdownPct=Math.max(s.maxDrawdownPct,(1-s.equitySol/s.peakEquity)*100);if(!s.curve.length||now-s.curve.at(-1).at>=10000)s.curve=[...s.curve,{at:now,equitySol:s.equitySol}].slice(-8640);}
 }
}
