import {validAIStop,validAIRisk} from './autonomous-policy.js';
// Describes telemetry only; never accepts/rejects a trading decision.
export function validationNotes(raw,context){
 let value;try{value=JSON.parse(raw);}catch{return ['RAW_OUTPUT_NOT_JSON'];}
 const rows=Array.isArray(value?.decisions)?value.decisions:[value],notes=[],seen=new Set();let buy=0;
 for(const [index,d]of rows.entries()){
  if(!d||!['BUY','SELL','HOLD'].includes(d.action)){notes.push(index+':ACTION_INVALID');continue;}
  if(d.mint){if(seen.has(d.mint))notes.push(index+':DUPLICATE_MINT');seen.add(d.mint);}
  if(d.action==='BUY'){
   if(context?.aiOnly&&!validAIStop(d.stop_loss_pct))notes.push(index+':STOP_REQUIRED');
   if(context?.aiOnly&&!validAIRisk(d.risk_assessment))notes.push(index+':RISK_ASSESSMENT_INVALID');
   if(!Number.isFinite(d.order_sol))notes.push(index+':ORDER_SIZE_INVALID');else buy+=d.order_sol;
  }
 }
 if(buy>(context?.limits?.maxOrderSol??Infinity))notes.push('SHARED_BUY_BUDGET_EXCEEDED');
 return notes.length?notes:['EXISTING_VALIDATOR_REJECTED; inspect redacted output and context'];
}
