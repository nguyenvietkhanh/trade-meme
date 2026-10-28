import {ENTRY_RULES_VERSION} from './rules-momentum.js';
import {evaluateV5,rulesFingerprint,RulesInputError} from './rules-v5.js';
// Same local worker IPC contract, with no language model, prompt or inference request.
export class RulesClient{
 constructor({clock=Date.now}={}){this.clock=clock;this.config={enabled:true};this.reports=[];this.grants=new Map();}
 settings(){return {enabled:true,name:ENTRY_RULES_VERSION,pollMs:5000,maxCandidates:12,timeoutMs:15000,engine:'rules-v5'};}
 status(){return {configured:true,enabled:false,verified:true,name:ENTRY_RULES_VERSION,engine:'rules-v5',externalModelCalls:0,verification:{ok:true,status:'local-rules'},reports:this.reports};}
 async verify(){return this.status();}cancel(){}cancelAll(){}stop(){}
 acknowledge(){return {automatic:true,acknowledgmentRequired:false};}
 async decide(_id,context){
  const now=this.clock(),decisions=[],reports=[];let available=context.rulesAccount?.available_capital_sol??0,slots=Math.max(0,Math.min(context.limits.maxBatchOrders??5,5-(context.rulesAccount?.open_positions_count??0)));
  for(const c of context.candidates){
   const bundle=c.rulesEvidence,inputs={...bundle?.inputs,...context.rulesAccount,token:c.mint,available_capital_sol:available},base={mint:c.mint,pool:c.pool,symbol:c.symbol??null,at:now};
   if(!bundle||bundle.error||!Number.isFinite(bundle.checkedAt)||now<bundle.checkedAt||now-bundle.checkedAt>5000){reports.push({...base,code:bundle?.error??'RULES_EVIDENCE_UNAVAILABLE',missing:bundle?.missing??['verified token / holders / dev / block0 / global percentile'],availableInputs:bundle?.inputs??null});continue;}
   let result;try{result=evaluateV5(inputs,bundle.observations);}catch(e){if(!(e instanceof RulesInputError))throw e;reports.push({...base,code:e.code,missing:e.fields});continue;}
   const fingerprint=rulesFingerprint(result,c.pool);
   const occupied=(context.positions??[]).some(p=>p.mint===c.mint)||(context.openOrders??[]).some(o=>o.mint===c.mint)||decisions.some(d=>d.mint===c.mint);
   reports.push({...base,result,confidenceStatus:'not-estimated',decisionInputs:inputs,observedFacts:bundle.observations??{},researchUnknowns:bundle.researchUnknowns??[],fingerprint,executionBlock:occupied?'RULES_POSITION_ALREADY_HELD':null,awaitingAcknowledgment:false});
   if(result.verdict!=='VALID_SETUP'||occupied||!context.wallet.running||slots<=0)continue;
   const size=result.R1_detail.proposed_size_sol,amount=String(Math.floor(size*1e9)),grant={fingerprint,mint:c.mint,pool:c.pool,amount,result,inputs,observations:bundle.observations,checkedAt:bundle.checkedAt,expiresAt:now+10000,intentId:null};
   this.grants.set(fingerprint,grant);decisions.push({action:'BUY',mint:c.mint,order_sol:size,sell_percent:null,stop_loss_pct:20,position_id:null,confidence:0,reason:`${ENTRY_RULES_VERSION}: VALID_SETUP; score ${result.score}; friction ${result.friction_detail.estimated_round_trip_friction_pct.toFixed(3)}%; ${result.sizing_mode}`,risk_assessment:{approved:true,reason:'R1–R9 independently computed and passed',risks:['market execution can slip'],unknowns:[]},_grant:fingerprint});available=Math.max(0,available-size-.005);slots--;
  }
  this.reports=reports;try{this.audit?.enqueue({type:'rules_evaluation',at:now,policyVersion:ENTRY_RULES_VERSION,snapshotId:context.snapshotId,reports});}catch{}
 for(const [key,g]of this.grants)if(g.expiresAt<now)this.grants.delete(key);
  if(!decisions.length)decisions.push({action:'HOLD',mint:null,order_sol:null,sell_percent:null,stop_loss_pct:null,position_id:null,confidence:0,reason:reports.find(r=>r.code)?.code??(reports.some(r=>r.executionBlock)?'RULES_POSITION_ALREADY_HELD':reports.some(r=>r.result)?'RULES_FILTER_REJECTED: '+Object.entries(reports.find(r=>r.result).result.rule_check).filter(([,v])=>v==='fail').map(([k])=>k).join(', '):'RULES_NO_CANDIDATES'),risk_assessment:{approved:false,reason:'Rule checks incomplete',risks:[],unknowns:[]}});
  const byMint=Object.fromEntries(decisions.filter(d=>d.action==='BUY').map(d=>[d.mint,{rulesGrant:d._grant}]));for(const d of decisions)delete d._grant;
  return {rulesReports:reports,decision:decisions[0],decisions,riskEvidenceByMint:byMint,modelName:null,promptVersion:null,promptSha256:null,requestSnapshotId:context.snapshotId,requestedAt:now,respondedAt:now,expiresAt:now+10000};
 }
}
