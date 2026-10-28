import {LiveModelBotRuntime} from './live-model-runtime.js';
import {validateModelDecisions,walletFingerprint} from './paper-model-context.js';
import {validAIStop} from './autonomous-policy.js';

// Parent treasury remains the authority for funds, signatures and receipts.
// This worker only keeps a durable queue of AI intents under their original IDs.
export class MultiLiveModelRuntime extends LiveModelBotRuntime{
 constructor(config,state,options){super(config,state,options);state.multiOrder=true;state.pendingOrders??=[];this.maxOrders=5;this.harvest();}
 harvest(){const s=this.state;if(s.pending&&!s.pendingOrders.some(o=>o.id===s.pending.id))s.pendingOrders.push(s.pending);s.pending=null;}
 outstanding(){const rows=new Map((this.state.livePendings??[]).map(o=>[o.id,o]));for(const o of this.state.pendingOrders)rows.set(o.id,o);return [...rows.values()];}
 canRequestModel(){return this.state.liveSigningReady!==false&&this.outstanding().length<this.maxOrders;}
 prepareDecisionContext(context){
  const orders=this.outstanding(),reserved=new Set((this.state.livePendings??[]).map(o=>o.id));
  const local=orders.filter(o=>!reserved.has(o.id)),debit=local.reduce((n,o)=>n+(o.side==='BUY'?Number(o.amount):0)+(o.side==='SET_STOP'?0:5000000),0);
  return {...context,batchOrders:true,openOrders:orders.map(o=>({id:o.id,mint:o.mint,side:o.side,status:o.status??'queued'})),candidates:context.candidates.filter(m=>!orders.some(o=>o.mint===m.mint)),positions:context.positions,limits:{...context.limits,maxPositions:Math.max(0,context.limits.maxPositions-orders.filter(o=>o.side==='BUY').length),maxOrderSol:Math.max(0,Math.floor(context.limits.maxOrderSol*1e9-debit)/1e9),maxBatchOrders:Math.max(0,this.maxOrders-orders.length),maxConcurrentOrders:this.maxOrders}};
 }
 consumeModel(snapshot,now){
  const box=this.inbox;if(!box)return;if(box.error){super.consumeModel(snapshot,now);return;}
  let decisions;try{decisions=validateModelDecisions({decisions:box.reply.decisions??[box.reply.decision]},box.context);}catch{this.inbox={error:{code:'MODEL_INVALID_DECISION'}};super.consumeModel(snapshot,now);return;}
  if(walletFingerprint(this.state)!==box.fingerprint||now>(box.reply.expiresAt??box.context.asOf+30000)){
   if(box.reply.datasetCallId)for(let i=1;i<decisions.length;i++)this.observe('decision_validation',{callId:box.reply.datasetCallId,decisionIndex:i,decision:decisions[i],applied:false,reason:walletFingerprint(this.state)!==box.fingerprint?'MODEL_WALLET_CHANGED':'MODEL_DECISION_EXPIRED',at:now});
   this.inbox={...box,reply:{...box.reply,decision:decisions[0]}};super.consumeModel(snapshot,now);return;
  }
  for(const [datasetDecisionIndex,decision] of decisions.entries()){
   if(this.outstanding().length>=this.maxOrders)break;
   this.inbox={...box,fingerprint:walletFingerprint(this.state),reply:{...box.reply,decision,datasetDecisionIndex,riskEvidence:box.reply.riskEvidenceByMint?.[decision.mint]??box.reply.riskEvidence??null}};
   super.consumeModel(snapshot,now);this.harvest();
  }
 }
 monitor(snapshot,now){
  const s=this.state;if(!s.aiOnly){super.monitor(snapshot,now);this.harvest();return;}
  for(const p of s.positions){
   if(this.outstanding().length>=this.maxOrders)break;
   if(this.outstanding().some(o=>o.mint===p.mint)||!validAIStop(p.aiStopLossPct))continue;
   const m=snapshot.markets.find(m=>m.mint===p.mint&&m.pairAddress===p.pairAddress),at=m?.priceAt??m?.updatedAt,price=m?.spotPriceSol??m?.priceUsd/snapshot.solUsd;
   if(!Number.isFinite(at)||now<at||now-at>1500||!(price>0)||!(p.costSol>0))continue;
   if(p.quantity*price<=p.costSol*(1-p.aiStopLossPct/100))s.pendingOrders.push({id:this.id('ai-stop-sell'),side:'SELL',mint:p.mint,pairAddress:p.pairAddress,symbol:p.symbol,positionId:p.paperPositionId,amount:p.rawQuantity,decisionAt:now,readyAt:now+2000,reason:'stop-loss',decisionEngine:'model-stop',stopLossPct:p.aiStopLossPct});
  }
 }
 async fillOrder(o,snapshot,now){
  const s=this.state;if(now<o.readyAt)return;
  const submitted=o.wasSubmitted||!!o.signature||(s.livePendings??[]).some(p=>p.id===o.id);
  if(!submitted&&s.liveSigningReady===false){o.readyAt=now+15000;return;}
  const drop=()=>{s.pendingOrders=s.pendingOrders.filter(p=>p.id!==o.id);};
  if(!submitted&&['SELL','SET_STOP'].includes(o.side)){
   const p=s.positions.find(p=>p.paperPositionId===o.positionId&&p.mint===o.mint);
   if(!p||o.side==='SELL'&&BigInt(o.amount)>BigInt(p.rawQuantity)){drop();this.recordAI(snapshot,now,'WAIT','LIVE_WALLET_POSITION_CHANGED',{mint:o.mint});return;}
  }
  if(!submitted&&o.side==='BUY'&&(!s.running||now-o.decisionAt>30000)){drop();this.recordAI(snapshot,now,'WAIT','LIVE_BUY_INTENT_EXPIRED',{mint:o.mint});return;}
  const m=snapshot.markets.find(m=>m.mint===o.mint&&m.pairAddress===o.pairAddress)??(submitted?{mint:o.mint,pairAddress:o.pairAddress}:null);if(!m)return;
  try{
   const result=await this.execute({...o,aiOnly:s.aiOnly===true,referencePriceSol:o.referencePriceSol??null},m);
   if(result.view?.id===s.id)Object.assign(s,result.view);
   if(result.terminal){drop();this.recordAI(snapshot,now,result.status==='confirmed'?o.side:'WAIT','LIVE_'+result.status.toUpperCase(),{mint:o.mint,signature:result.signature??null});}
   else{o.wasSubmitted=true;o.signature=result.signature??o.signature;o.readyAt=now+2000;}
  }catch(e){
   o.readyAt=now+15000;this.error(e,now);
   if(!submitted&&['LIVE_AI_RISK_ASSESSMENT_REQUIRED','LIVE_TOKEN_BALANCE_CONFLICT','LIVE_AI_TARGET_MARKET','LIVE_AI_MARKET_STALE','LIVE_SELL_LOT_MISMATCH','LIVE_AI_STOP_REQUIRED','LIVE_RETIRED_AGENT','LIVE_INVALID_INTENT','LIVE_INVALID_AMOUNT','LIVE_CAPITAL_CHANGED','LIVE_BUY_NOT_ADMITTED','LIVE_INTENT_EXPIRED','LIVE_PREPARE_FAILED'].includes(e.code))drop();
  }
 }
 async tick(snapshot,now=snapshot.timestamp){
  if(this.busy)return;this.busy=true;const s=this.state;
  try{
   s.heartbeatAt=now;this.harvest();
   for(const o of s.livePendings??(s.livePending?[s.livePending]:[]))if(!s.pendingOrders.some(p=>p.id===o.id))s.pendingOrders.push({...o,wasSubmitted:true});
   // Poll every restored order, including legacy IDs; never prune signed orders to fit a new limit.
   await Promise.all(s.pendingOrders.map(o=>this.fillOrder(o,snapshot,now)));
   this.monitor(snapshot,now);if(s.aiOnly)s.nextAt=0;
   if(now>=s.nextAt){s.nextAt=now+this.config.scanIntervalMs;this.evaluate(snapshot,now);}
   await this.save(s);
  }catch(e){this.error(e,now);await this.save(s);}finally{this.busy=false;}
 }
}
