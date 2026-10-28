import {evaluateV5,rulesFingerprint,RULES_VERSION,RulesInputError} from './rules-v5.js';
const failure=code=>Object.assign(Error(code),{code});
// Same local worker IPC contract, with no language model, prompt or inference request.
export class RulesClient{
 constructor({clock=Date.now}={}){this.clock=clock;this.config={enabled:true};this.reports=[];this.approvals=new Map();this.grants=new Map();}
 settings(){return {enabled:true,name:RULES_VERSION,pollMs:5000,maxCandidates:12,timeoutMs:15000,engine:'rules-v5'};}
 status(){return {configured:true,enabled:false,verified:true,name:RULES_VERSION,engine:'rules-v5',externalModelCalls:0,verification:{ok:true,status:'local-rules'},reports:this.reports};}
 async verify(){return this.status();}cancel(){}cancelAll(){}stop(){}
 acknowledge(key){const row=this.reports.find(r=>r.fingerprint===key&&r.result?.verdict==='VALID_SETUP'&&r.result.requires_user_acknowledgment);if(!row||this.clock()-row.at>30000)throw failure('RULES_ACK_EXPIRED');this.approvals.set(key,this.clock()+30000);return {acknowledged:true,expiresAt:this.clock()+30000};}
 async decide(_id,context){
  const now=this.clock(),decisions=[],reports=[];let available=context.rulesAccount?.available_capital_sol??0,slots=context.limits.maxBatchOrders??5;
  for(const c of context.candidates){
   const bundle=c.rulesEvidence,inputs={...bundle?.inputs,...context.rulesAccount,token:c.mint,available_capital_sol:available},base={mint:c.mint,pool:c.pool,symbol:c.symbol??null,at:now};
   if(!bundle||bundle.error||!Number.isFinite(bundle.checkedAt)||now<bundle.checkedAt||now-bundle.checkedAt>5000){reports.push({...base,code:bundle?.error??'RULES_EVIDENCE_UNAVAILABLE',missing:bundle?.missing??['verified token / holders / dev / block0 / global percentile'],availableInputs:bundle?.inputs??null});continue;}
   let result;try{result=evaluateV5(inputs,bundle.observations);}catch(e){if(!(e instanceof RulesInputError))throw e;reports.push({...base,code:e.code,missing:e.fields});continue;}
   const fingerprint=rulesFingerprint(result,c.pool),ack=!result.requires_user_acknowledgment||(this.approvals.get(fingerprint)??0)>=now;
   const occupied=(context.positions??[]).some(p=>p.mint===c.mint)||(context.openOrders??[]).some(o=>o.mint===c.mint)||decisions.some(d=>d.mint===c.mint);
   reports.push({...base,result,confidenceStatus:'not-estimated',decisionInputs:inputs,observedFacts:bundle.observations??{},fingerprint,executionBlock:occupied?'RULES_POSITION_ALREADY_HELD':null,awaitingAcknowledgment:result.verdict==='VALID_SETUP'&&!ack});
   if(result.verdict!=='VALID_SETUP'||occupied||!ack||!context.wallet.running||slots<=0)continue;
   const size=result.R1_detail.proposed_size_sol,amount=String(Math.floor(size*1e9)),grant={fingerprint,mint:c.mint,pool:c.pool,amount,result,inputs,observations:bundle.observations,checkedAt:bundle.checkedAt,expiresAt:now+10000,intentId:null};
   this.grants.set(fingerprint,grant);decisions.push({action:'BUY',mint:c.mint,order_sol:size,sell_percent:null,stop_loss_pct:20,position_id:null,confidence:0,reason:`${RULES_VERSION}: VALID_SETUP; score ${result.score}; friction ${result.friction_detail.estimated_round_trip_friction_pct.toFixed(3)}%; ${result.sizing_mode}`,risk_assessment:{approved:true,reason:'R1–R9 independently computed and passed',risks:['market execution can slip'],unknowns:[]},_grant:fingerprint});available=Math.max(0,available-size-.005);slots--;
  }
  this.reports=reports;try{this.audit?.enqueue({type:'rules_evaluation',at:now,policyVersion:RULES_VERSION,snapshotId:context.snapshotId,reports});}catch{}
 for(const [key,g]of this.grants)if(g.expiresAt<now)this.grants.delete(key);for(const [k,t]of this.approvals)if(t<now)this.approvals.delete(k);
  if(!decisions.length)decisions.push({action:'HOLD',mint:null,order_sol:null,sell_percent:null,stop_loss_pct:null,position_id:null,confidence:0,reason:reports[0]?.code??'Rules V5: chưa có VALID_SETUP được phép thực thi',risk_assessment:{approved:false,reason:'Rule checks or acknowledgment incomplete',risks:[],unknowns:[]}});
  const byMint=Object.fromEntries(decisions.filter(d=>d.action==='BUY').map(d=>[d.mint,{rulesGrant:d._grant}]));for(const d of decisions)delete d._grant;
  return {rulesReports:reports,decision:decisions[0],decisions,riskEvidenceByMint:byMint,modelName:null,promptVersion:null,promptSha256:null,requestSnapshotId:context.snapshotId,requestedAt:now,respondedAt:now,expiresAt:now+10000};
 }
}
