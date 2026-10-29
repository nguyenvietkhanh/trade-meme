import {rulesConfig} from './rules-config.js';import {evaluateV5,rulesFingerprint,RulesInputError} from './rules-v5.js';import {RulesFunnel} from './rules-funnel.js';
export class RulesClient{
 constructor({clock=Date.now,policy=rulesConfig(),quoteSelector=null}={}){this.clock=clock;this.policy=policy;this.quoteSelector=quoteSelector;this.config={enabled:true};this.reports=[];this.grants=new Map();this.funnel=new RulesFunnel();}
 settings(){return {enabled:true,name:this.policy.version,pollMs:this.policy.pollMs,maxCandidates:this.policy.maxCandidates,timeoutMs:60000,engine:'rules-v5',rulesPolicy:this.policy};}
 status(){return {configured:true,enabled:false,verified:true,name:this.policy.version,engine:'rules-v5',externalModelCalls:0,verification:{ok:true,status:'local-rules'},reports:this.reports,funnel:this.funnel.snapshot()};}
 async verify(){return this.status();}cancel(){}cancelAll(){}stop(){}acknowledge(){return {automatic:true,acknowledgmentRequired:false};}
 async decide(_id,context){
  const requestedAt=this.clock(),p=this.policy,reports=[],decisions=[];let available=context.rulesAccount?.available_capital_sol??0,exposure=context.rulesAccount?.open_exposure_sol??0,slots=Math.max(0,Math.min(context.limits.maxBatchOrders??p.maxPositions,p.maxPositions-(context.rulesAccount?.open_positions_count??0)));
  for(const c of context.candidates){const b=c.rulesEvidence,inputs={...b?.inputs,...context.rulesAccount,token:c.mint,pool:c.pool,current_time_ms:this.clock()},row={mint:c.mint,pool:c.pool,at:this.clock(),availableInputs:inputs,diagnostic:b?.diagnostic};reports.push(row);this.funnel.add('seen',row.at);
   if(b&&b.error!=='pre_filter_dead')this.funnel.add('pre_filter',row.at);
   if(b?.error){row.code=b.error;row.missing=b.missing;this.funnel.add('none',row.at,row.code);continue;}
   if(!b||!Number.isFinite(b.checkedAt)||this.clock()-b.checkedAt>5000){row.code='RULES_EVIDENCE_UNAVAILABLE';continue;}
   try{row.result=evaluateV5(inputs,b.observations,p);row.decisionInputs=inputs;row.observedFacts=b.observations??{};row.researchUnknowns=row.result.unknowns;row.awaitingAcknowledgment=false;}catch(e){if(!(e instanceof RulesInputError))throw e;row.code=e.code;row.missing=e.fields;continue;}
   const r=row.result;if(['R2','R3','R4','R7'].every(k=>r.rule_check[k]==='pass'))this.funnel.add('safety',row.at);if(r.verdict==='VALID_SETUP')this.funnel.add('signal',row.at);else this.funnel.add('none',row.at,'signal_or_safety');
  }
  this.reports=reports;
  for(const row of [...reports].filter(r=>r.result?.verdict==='VALID_SETUP').sort((a,b)=>b.result.score-a.result.score)){
   if(!slots||!context.wallet.running||p.killSwitch){row.executionBlock=p.killSwitch?'MANUAL_KILL_SWITCH':!context.wallet.running?'BUY_MANUALLY_STOPPED':'POSITION_LIMIT';continue;}
   if((context.positions??[]).some(x=>x.mint===row.mint)||(context.openOrders??[]).some(x=>x.mint===row.mint)||decisions.some(x=>x.mint===row.mint)){row.executionBlock='RULES_POSITION_ALREADY_HELD';continue;}
   const inputs={...row.decisionInputs,available_capital_sol:available,open_exposure_sol:exposure},candidate=evaluateV5(inputs,row.observedFacts,p);if(candidate.verdict!=='VALID_SETUP'){row.result=candidate;continue;}
   if(!this.quoteSelector){row.executionBlock='RULES_QUOTE_NOT_CONFIGURED';continue;}
   row.executionStage='QUOTE';const choice=await this.quoteSelector({mint:row.mint,pool:row.pool},{size:candidate.R1_detail.proposed_size_sol});row.quoteAttempts=choice.attempts;row.executionStage='EVALUATED';
   if(!choice.ok){row.code='quote_'+choice.reason;this.funnel.add('none',this.clock(),row.code);continue;}
   const chosen={...inputs,quote_selected_sol:choice.size,quote_status:'verified',round_trip_quote_loss_pct:choice.quote.roundTripLossPct,quote_probe_sol:choice.size,current_time_ms:this.clock()},r=evaluateV5(chosen,row.observedFacts,p);row.result=r;row.decisionInputs=chosen;if(r.verdict!=='VALID_SETUP'){row.code='quote_loss_too_high';continue;}
   this.funnel.add('quote',this.clock());const fingerprint=rulesFingerprint(r,row.pool),now=this.clock(),size=r.R1_detail.proposed_size_sol;row.fingerprint=fingerprint;
   this.grants.set(fingerprint,{fingerprint,mint:row.mint,pool:row.pool,amount:String(Math.round(size*1e9)),result:r,inputs:chosen,observations:row.observedFacts,checkedAt:now,expiresAt:now+15000,intentId:null});
   decisions.push({action:'BUY',mint:row.mint,order_sol:size,sell_percent:null,stop_loss_pct:20,position_id:null,confidence:0,reason:p.version+': '+r.entry_tier+'; score '+r.score,risk_assessment:{approved:true,reason:'Verified safety, tier, quote and risk sizing',risks:['gap/rug losses can exceed assumptions'],unknowns:r.unknowns.slice(0,8).map(x=>String(x).slice(0,100))},_grant:fingerprint});available=Math.max(0,available-size-p.bufferSol);exposure+=size;slots--;
  }
  this.reports=reports;for(const [k,g]of this.grants)if(g.expiresAt<this.clock())this.grants.delete(k);this.audit?.enqueue({type:'rules_evaluation',at:this.clock(),policyVersion:p.version,snapshotId:context.snapshotId,reports});
  if(!decisions.length)decisions.push({action:'HOLD',mint:null,order_sol:null,sell_percent:null,stop_loss_pct:null,position_id:null,confidence:0,reason:p.killSwitch?'MANUAL_KILL_SWITCH':reports.find(r=>r.code?.startsWith('quote_'))?.code??reports.find(r=>r.code&&r.code!=='pre_filter_dead')?.code??reports.find(r=>r.code)?.code??reports.find(r=>r.executionBlock)?.executionBlock??'RULES_NO_ENTRY_TIER',risk_assessment:{approved:false,reason:'No executable tier',risks:[],unknowns:[]}});
  const byMint=Object.fromEntries(decisions.filter(d=>d.action==='BUY').map(d=>[d.mint,{rulesGrant:d._grant}]));for(const d of decisions)delete d._grant;const respondedAt=this.clock();return {rulesReports:reports,decision:decisions[0],decisions,riskEvidenceByMint:byMint,modelName:null,promptVersion:null,promptSha256:null,requestSnapshotId:context.snapshotId,requestedAt,respondedAt,expiresAt:respondedAt+15000};
 }
}
