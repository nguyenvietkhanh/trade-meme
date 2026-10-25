import {BotRuntime} from './paper-bot-runtime.js';
import {createModelContext,validateModelDecision,walletFingerprint} from './paper-model-context.js';
import {PAPER_SIZING} from './paper-sizing.js';
import {decisionOrderSol as paperOrderSol} from './decision-capital.js';
import {lamports} from './paper-bot-state.js';
import {FILL_MODEL} from './paper-bot-config.js';
import {scalpExitPlan} from './paper-scalp.js';
export class ModelBotRuntime extends BotRuntime{
 constructor(config,state,options={}){
  super(config,state,options);this.decide=options.decide;this.aiConfig={pollMs:30000,maxCandidates:8,...options.ai};
  this.aiConfig.enabled=!this.aiConfig.explicitRulesMode&&(this.aiConfig.enabled||state.ai?.wasEnabled===true);
  state.decisionEngine=this.aiConfig.enabled?'model':'rules';this.inbox=null;this.modelTask=null;
  if(this.aiConfig.enabled){state.ai={history:[],failures:0,...state.ai,wasEnabled:true,activatedAt:state.ai?.activatedAt??Date.now(),status:'idle',modelName:this.aiConfig.name??null,nextAt:Math.min(state.ai?.nextAt??Infinity,Date.now()+state.seed%this.aiConfig.pollMs)};if(state.pending?.side==='BUY'&&state.pending.decisionEngine!=='model')state.pending=null;}else if(state.pending?.side==='BUY'&&state.pending.decisionEngine==='model')state.pending=null;
 }
 allowExit(plan,position){return !this.aiConfig.enabled||position.controlMode!=='model'||['stop-loss','emergency-risk','scalp-max-hold'].includes(plan.reason);}
 exitPlan(position,m,now){
  const plan=scalpExitPlan(position,m,now);if(!this.aiConfig.enabled||position.controlMode!=='model')return plan;
  if(plan?.reason==='stop-loss')return plan;
  if(now-position.openedAt>=position.exitPolicy.maxHoldMs)return {reason:'scalp-max-hold',fraction:1};
  const fresh=Number.isFinite(m.updatedAt)&&now>=m.updatedAt&&now-m.updatedAt<=1500;
  if(fresh&&(Number.isFinite(m.liquidityUsd)&&m.liquidityUsd<(position.peakLiquidityUsd??position.entryLiquidityUsd??0)*.6||m.evidence?.lpWithdrawn===true||m.evidence?.largeHolderDump===true||m.evidence?.sellSimulationOk===false))return {reason:'emergency-risk',fraction:1};
  return null;
 }
 recordAI(snapshot,now,action,reason,extra={}){
  const s=this.state,row={type:'decision',id:this.id('model'),ts:now,at:now,snapshotId:snapshot.snapshotId,bot:s.id,agentId:s.id,decisionEngine:'model',action,decision:action,stage:'model',blockingStage:'model',reason,minScore:0,score:extra.confidence==null?0:Math.round(extra.confidence*100),scoreParts:{confidence:extra.confidence??null,uncalibrated:true},checks:[],...extra};s.outbox.push(row);s.decisions=[row,...s.decisions].slice(0,100);return row;
 }
 consumeModel(snapshot,now){
  if(!this.inbox)return;const box=this.inbox;this.inbox=null;const s=this.state,a=s.ai;
  if(box.error){a.failures++;a.status='error';a.lastError={at:now,code:box.error.code??'MODEL_UNAVAILABLE'};a.nextAt=Math.max(now+this.aiConfig.pollMs,box.error.retryAt??0);this.recordAI(snapshot,now,'WAIT',a.lastError.code);return;}
  const {reply,context,fingerprint}=box;let decision;
  try{decision=validateModelDecision(reply.decision,context);}catch{a.status='error';a.lastError={at:now,code:'MODEL_INVALID_DECISION'};this.recordAI(snapshot,now,'WAIT','MODEL_INVALID_DECISION');return;}
  let reason=decision.reason,applied=false;
  if(now>(reply.expiresAt??context.asOf+30000)||now-context.asOf>30000)reason='MODEL_DECISION_EXPIRED';
  else if(walletFingerprint(s)!==fingerprint)reason='MODEL_WALLET_CHANGED';
  else if(s.pending)reason='MODEL_OWN_ORDER_PENDING';
  else if(decision.action==='HOLD'){if(s.aiOnly&&decision.mint){const p=s.positions.find(p=>p.mint===decision.mint&&(!decision.position_id||p.paperPositionId===decision.position_id));s.pending={id:this.id('ai-stop'),side:'SET_STOP',mint:p.mint,pairAddress:p.pairAddress,positionId:p.paperPositionId,aiStopLossPct:decision.stop_loss_pct,decisionAt:now,readyAt:now,reason:decision.reason};}applied=true;}
  else if(decision.action==='BUY'){
   const m=snapshot.markets.find(m=>m.mint===decision.mint&&context.candidates.some(c=>c.mint===m.mint&&c.pool===m.pairAddress)),reference=context.candidates.find(c=>c.mint===decision.mint),size=Math.floor(decision.order_sol*1e9)/1e9;
   if(!s.running||(!s.aiOnly&&s.positions.length)||s.positions.some(p=>p.mint===decision.mint)||size<PAPER_SIZING.minOrderSol||size>paperOrderSol(s,now)+1e-9)reason='MODEL_BUY_CAPITAL_LIMIT';
   else if(!s.aiOnly&&(s.cooldowns[decision.mint]??0)>now)reason='MODEL_OWN_COOLDOWN';
   else if(!m||!(m.priceUsd>0)||now-m.updatedAt>5000||now<m.updatedAt||now-(m.marketObservedAt??m.updatedAt)>5000||now<(m.marketObservedAt??m.updatedAt))reason='MODEL_MARKET_STALE';
   else if(!(reference?.priceSol>0))reason='MODEL_REFERENCE_PRICE_MISSING';
   else{const current=Number.isFinite(m.priceAt)&&now>=m.priceAt&&now-m.priceAt<=1500?m.spotPriceSol:m.priceUsd/snapshot.solUsd;if(!(current>0)||current/reference.priceSol>1.04)reason='MODEL_BUY_PRICE_MOVED';else{s.pending={id:this.id('ai-buy'),side:'BUY',mint:m.mint,pairAddress:m.pairAddress,symbol:m.symbol,amount:String(lamports(size)),decisionAt:now,readyAt:now+FILL_MODEL.delayMs,aiStopLossPct:decision.stop_loss_pct??null,aiRiskAssessment:decision.risk_assessment??null,aiRiskEvidence:reply.riskEvidence??null,reason:'AI: '+decision.reason,decisionEngine:'model',modelName:reply.modelName??this.aiConfig.name,referencePriceSol:reference.priceSol,confidence:decision.confidence,signal:{score:decision.confidence*100,scoreParts:{confidence:decision.confidence,uncalibrated:true},checks:[],modelReason:decision.reason},attempts:0};applied=true;}}
  }else if(decision.action==='SELL'){
   const p=s.positions.find(p=>p.mint===decision.mint&&(!decision.position_id||p.paperPositionId===decision.position_id)),amount=p?BigInt(p.rawQuantity)*BigInt(Math.floor(decision.sell_percent*100))/10000n:0n;
   if(!p||amount<=0n)reason='MODEL_SELL_POSITION_CHANGED';else{s.pending={id:this.id('ai-sell'),side:'SELL',mint:p.mint,pairAddress:p.pairAddress,symbol:p.symbol,positionId:p.paperPositionId,amount:String(amount),decisionAt:now,readyAt:now+FILL_MODEL.delayMs,aiStopLossPct:decision.stop_loss_pct??null,aiRiskAssessment:decision.risk_assessment??null,aiRiskEvidence:reply.riskEvidence??null,reason:'AI: '+decision.reason,decisionEngine:'model',modelName:reply.modelName??this.aiConfig.name,confidence:decision.confidence,attempts:0};applied=true;}
  }
  a.status=applied?decision.action==='HOLD'?'holding':'decision-ready':'rejected';a.lastError=null;a.failures=0;a.lastDecision={...decision,at:now,applied,reason,requestSnapshotId:context.snapshotId};a.history=[...a.history,a.lastDecision].slice(-12);this.recordAI(snapshot,now,applied?decision.action:'WAIT',reason,{mint:decision.mint,token:decision.mint,confidence:decision.confidence,applied,modelName:reply.modelName??this.aiConfig.name,requestSnapshotId:context.snapshotId});
 }
 evaluate(snapshot,now){
  if(!this.aiConfig.enabled)return super.evaluate(snapshot,now);
  const s=this.state,a=s.ai;this.consumeModel(snapshot,now);s.cycle++;
  if(!this.modelTask&&!s.pending&&now>=a.nextAt&&(s.running||s.positions.length)){
   const context=createModelContext(this.config,s,snapshot,now,{maxCandidates:this.aiConfig.maxCandidates});
   if(!context.candidates.length&&!context.positions.length){a.status='waiting-data';a.nextAt=now+5000;}
   else{a.nextAt=now+this.aiConfig.pollMs;a.status='thinking';a.lastRequestedAt=now;a.candidateCount=context.candidates.length;const fingerprint=walletFingerprint(s);
    this.modelTask=Promise.resolve().then(()=>{if(!this.decide)throw Object.assign(Error('MODEL_NOT_CONFIGURED'),{code:'MODEL_NOT_CONFIGURED'});return this.decide(context);}).then(reply=>{this.inbox={reply,context,fingerprint};},error=>{this.inbox={error:{code:error.code??'MODEL_UNAVAILABLE',retryAt:error.retryAt??null}};}).finally(()=>{this.modelTask=null;});
   }
  }
  const reason=a.lastError?.code??(a.status==='thinking'?'AI đang phân tích ngữ cảnh riêng':a.lastDecision?.reason??(a.status==='waiting-data'?'AI chờ dữ liệu thị trường thật':'AI chờ lượt phân tích tiếp theo'));
  const decisions=snapshot.markets.map(m=>({mint:m.mint,symbol:m.symbol,stage:'model',blockingStage:'model',eligible:false,reason,action:'WAIT',score:0,minScore:0}));s.evaluations+=decisions.length;s.signal={at:now,cycle:s.cycle,evaluated:decisions.length,eligible:s.pending?.side==='BUY'?1:0,decisions,stages:{model:decisions.length}};
 }
 async fill(snapshot,now){
  const s=this.state,o=s.pending;
  if(o?.decisionEngine==='model'&&o.side==='BUY'){
   const m=snapshot.markets.find(m=>m.mint===o.mint&&m.pairAddress===o.pairAddress),size=Number(o.amount)/1e9;
   if(!s.running||s.positions.length||!m||now-m.updatedAt>5000||now<m.updatedAt||now-(m.marketObservedAt??m.updatedAt)>5000||now<(m.marketObservedAt??m.updatedAt)||size>paperOrderSol(s,now)+1e-9||(s.cooldowns[o.mint]??0)>now){this.recordAI(snapshot,now,'WAIT','MODEL_BUY_RECHECK_FAILED',{mint:o.mint});s.pending=null;return;}
  }
  return super.fill(snapshot,now);
 }
}
