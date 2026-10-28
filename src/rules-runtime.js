import {createModelContext,walletFingerprint} from './paper-model-context.js';
import {MultiLiveModelRuntime} from './multi-live-runtime.js';
import {RULES_VERSION,exitV5,latchedExitV5} from './rules-v5.js';
// Reuse only the proven durable intent/reconciliation transport. decide() is local RulesClient IPC.
export class RulesRuntime extends MultiLiveModelRuntime{
 constructor(config,state,options){super(config,state,options);state.rulesEngine=true;state.decisionEngine='rules-v5';state.rulesExitState??={};state.ai={...state.ai,status:'disabled',modelName:null,wasEnabled:false};}
 harvest(){const o=this.state.pending;if(o?.aiRiskEvidence?.rulesGrant){o.decisionEngine='rules-v5';o.modelName=null;o.reason=o.reason.replace(/^AI: /,'Rules: ');}return super.harvest();}
 recordAI(snapshot,now,action,reason,extra={}){reason=String(reason).replace(/^MODEL_/,'RULES_');const s=this.state,row={type:'decision',id:this.id('rule'),ts:now,at:now,snapshotId:snapshot.snapshotId,bot:s.id,agentId:s.id,decisionEngine:'rules-v5',policyVersion:RULES_VERSION,action,decision:action,reason,stage:'rules',blockingStage:'rules',score:s.rulesReports?.find(r=>r.mint===extra.mint)?.result?.score??0,minScore:8,...extra,modelName:null,promptVersion:null,promptSha256:null};s.outbox.push(row);s.decisions=[row,...s.decisions].slice(0,100);return row;}
 consumeModel(snapshot,now){const reports=this.inbox?.reply?.rulesReports;if(reports)this.state.rulesReports=reports;super.consumeModel(snapshot,now);}
 evaluate(snapshot,now){
  this.consumeModel(snapshot,now);const s=this.state;s.decisionEngine='rules-v5';s.ai.status='disabled';
  if(!this.rulesTask&&now>=(s.rulesNextAt??0)){
   s.cycle++;s.rulesNextAt=now+5000;const context=this.prepareDecisionContext(createModelContext(this.config,s,snapshot,now,{maxCandidates:12})),fingerprint=walletFingerprint(s);
   if(context.candidates.length||context.positions.length)this.rulesTask=Promise.resolve().then(()=>{if(!this.decide)throw Object.assign(Error('RULES_ENGINE_NOT_CONFIGURED'),{code:'RULES_ENGINE_NOT_CONFIGURED'});return this.decide(context);}).then(reply=>{this.inbox={reply,context,fingerprint};},error=>{this.inbox={error:{code:error.code??'RULES_UNAVAILABLE'}};}).finally(()=>{this.rulesTask=null;});
  }
  const reports=s.rulesReports??[],reason=reports.find(r=>r.code)?.code??'Luật V5.0: đang kiểm tra dữ liệu và điều kiện',decisions=(snapshot.markets??[]).map(m=>({mint:m.mint,symbol:m.symbol,stage:'rules',blockingStage:'rules',eligible:false,reason,action:'SKIP',score:reports.find(r=>r.mint===m.mint)?.result?.score??0,minScore:8}));s.evaluations+=decisions.length;s.signal={at:now,cycle:s.cycle,evaluated:decisions.length,eligible:this.outstanding().filter(o=>o.side==='BUY').length,decisions,stages:{rules:decisions.length}};
 }
 async fillOrder(order,snapshot,now){
  if(order.side==='SELL'&&!snapshot.markets.some(m=>m.mint===order.mint&&m.pairAddress===order.pairAddress)){
   const p=this.state.positions.find(p=>p.paperPositionId===order.positionId&&p.mint===order.mint);if(p?.rulesPolicyVersion===RULES_VERSION&&(p.rulesStopTriggered||p.rulesTrailTriggered||p.rulesTimeTriggered||p.rulesTpTriggered))snapshot={...snapshot,markets:[...snapshot.markets,{mint:p.mint,pairAddress:p.pairAddress,dexId:p.executionVenue==='pumpfun'?'pumpfun':'pumpswap'}]};
  }
  return super.fillOrder(order,snapshot,now);
 }
 monitor(snapshot,now){
  const s=this.state;for(const p of s.positions){if(this.outstanding().length>=this.maxOrders)break;if(this.outstanding().some(o=>o.mint===p.mint))continue;
   const m=snapshot.markets.find(m=>m.mint===p.mint&&m.pairAddress===p.pairAddress),at=m?.priceAt??m?.updatedAt,price=m?.spotPriceSol??m?.priceUsd/snapshot.solUsd;const fresh=Number.isFinite(at)&&now>=at&&now-at<=1500&&price>0;
   let plan;if(p.rulesPolicyVersion===RULES_VERSION){const memory=s.rulesExitState[p.paperPositionId]??={};memory.tpConfirmed=p.rulesTakeProfitDone===true;memory.peak=Math.max(memory.peak??0,p.rulesPeakPriceSol??0);memory.stopTriggered ||= p.rulesStopTriggered===true;memory.tpTriggered ||= p.rulesTpTriggered===true;memory.trailTriggered ||= p.rulesTrailTriggered===true;memory.timeTriggered ||= p.rulesTimeTriggered===true;plan=fresh?exitV5(p,price,now,memory):latchedExitV5(memory);}else if(fresh&&p.costSol>0&&p.quantity*price<=p.costSol*(1-(p.aiStopLossPct??20)/100))plan={reason:'stop-loss',fraction:1};
   if(!plan)continue;const amount=BigInt(p.rawQuantity)*BigInt(Math.round(plan.fraction*10000))/10000n;if(amount<=0n)continue;
   s.pendingOrders.push({id:this.id('rules-exit'),side:'SELL',mint:p.mint,pairAddress:p.pairAddress,symbol:p.symbol,positionId:p.paperPositionId,amount:String(amount),decisionAt:now,readyAt:now+2000,reason:plan.reason,decisionEngine:'rules-v5',stopLossPct:p.rulesPolicyVersion===RULES_VERSION?20:p.aiStopLossPct??20});
  }
 }
}
