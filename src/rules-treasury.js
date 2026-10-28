import {treasuryAvailable} from './live-treasury.js';
import {reservedAIProfit} from './automatic-profit.js';
import {aiBuyLimit} from './autonomous-policy.js';
import {AutomaticTreasury} from './automatic-treasury.js';
import {RULES_VERSION,evaluateV5,exitV5,rulesFingerprint} from './rules-v5.js';
const fail=code=>Object.assign(Error(code),{code});
export class RulesTreasury extends AutomaticTreasury{
 constructor(dir,execution,options){super(dir,execution,options);this.rulesClient=options.rulesClient;this.rulesEvidence=options.rulesEvidence;}
 checkBuyMarket(input,m){const current=this.marketSnapshot?.().markets.find(r=>r.mint===input.mint&&r.pairAddress===input.pairAddress)??m;if(!current||!['pumpfun','pumpswap'].includes(current.dexId))throw fail('RULES_MARKET_UNSUPPORTED');const at=current.marketObservedAt??current.updatedAt;if(!Number.isFinite(at)||at>this.clock()||this.clock()-at>5000)throw fail('RULES_MARKET_STALE');}
 request(input,m,id){const p=this.s.positions.find(p=>p.paperPositionId===input.positionId&&p.mint===input.mint);if(input.side==='SET_STOP'&&p?.rulesPolicyVersion===RULES_VERSION)throw fail('RULES_EXIT_POLICY_IMMUTABLE');return super.request(input,m,id);}
 validateRuleExit(input){
  const p=this.s.positions.find(p=>p.paperPositionId===input.positionId&&p.mint===input.mint);if(!p||p.rulesPolicyVersion!==RULES_VERSION)return;
  const snap=this.marketSnapshot(),m=snap.markets.find(m=>m.mint===p.mint&&m.pairAddress===p.pairAddress),at=m?.priceAt??m?.updatedAt,price=m?.spotPriceSol??m?.priceUsd/snap.solUsd,now=this.clock();
  const memory={peak:p.rulesPeakPriceSol,tpConfirmed:p.rulesTakeProfitDone===true,stopTriggered:p.rulesStopTriggered===true,tpTriggered:p.rulesTpTriggered===true,trailTriggered:p.rulesTrailTriggered===true,timeTriggered:p.rulesTimeTriggered===true};
  if(Number.isFinite(at)&&at<=now&&now-at<=1500&&price>0)exitV5(p,price,now,memory);
  Object.assign(p,{rulesPeakPriceSol:memory.peak,rulesStopTriggered:memory.stopTriggered,rulesTpTriggered:memory.tpTriggered,rulesTrailTriggered:memory.trailTriggered,rulesTimeTriggered:memory.timeTriggered});
  const plan=memory.stopTriggered?{reason:'stop-loss',fraction:1}:memory.trailTriggered?{reason:'rules-trailing-15',fraction:1}:memory.timeTriggered?{reason:'rules-time-exit',fraction:1}:!memory.tpConfirmed&&memory.tpTriggered?{reason:'rules-tp-2x',fraction:.5}:null;
  if(!plan||input.reason!==plan.reason||BigInt(input.amount)!==BigInt(p.rawQuantity)*BigInt(plan.fraction===1?10000:5000)/10000n)throw fail('RULES_EXIT_REEVALUATE');
 }
 async finalSizing(order,grant){
  const now=this.clock(),balance=await this.execution.balance(this.owner,this.s.lastReceiptSlot||undefined),snapshot=this.marketSnapshot(),others=Object.fromEntries(Object.entries(this.s.orders).filter(([id])=>id!==order.id)),detail=[];let equity=balance+Object.values(this.s.rentByMint).reduce((n,r)=>n+r.lamports/1e9,0);
  for(const p of this.s.positions){const m=snapshot.markets.find(m=>m.mint===p.mint&&m.pairAddress===p.pairAddress),at=m?.priceAt??m?.updatedAt,price=m?.spotPriceSol??m?.priceUsd/snapshot.solUsd;if(!Number.isFinite(at)||at>this.clock()||this.clock()-at>1500||!(price>0))throw fail('RULES_EQUITY_UNVERIFIED');const value=p.quantity*price;equity+=value;detail.push({current_value_sol:value});}
  const lamports=Math.round(balance*1e9),available=aiBuyLimit(lamports,Math.max(0,treasuryAvailable(lamports,others)-reservedAIProfit(this.s)))/1e9;
  const result=evaluateV5({...grant.recheckedInputs,account_equity_sol:equity,available_capital_sol:available,open_positions_count:this.s.positions.length+Object.values(others).filter(o=>!o.terminal&&o.side==='BUY').length,open_positions_detail:detail,current_utc_hour:new Date(this.clock()).getUTCHours()},grant.recheckedObservations);
  if(result.verdict!=='VALID_SETUP'||result.sizing_mode!==grant.result.sizing_mode||Math.floor(result.R1_detail.proposed_size_sol*1e9)!==Number(order.amount))throw fail('RULES_CAPITAL_CHANGED');grant.preSignResult=result;
 }
 async execute(input,m,id){
  if(input.side==='SELL'&&!Object.hasOwn(this.s.orders,input.id))this.validateRuleExit(input);
  if(input.side==='BUY'&&!Object.hasOwn(this.s.orders,input.id)){
   const grant=this.rulesClient.grants.get(input.aiRiskEvidence?.rulesGrant),now=this.clock();if(!grant||grant.mint!==input.mint||grant.pool!==input.pairAddress||grant.amount!==input.amount||grant.expiresAt<now||grant.intentId&&grant.intentId!==input.id)throw fail('RULES_GRANT_REQUIRED');
   if(grant.result.requires_user_acknowledgment&&(this.rulesClient.approvals.get(grant.fingerprint)??0)<this.clock())throw fail('RULES_ACK_EXPIRED');
   const balance=await this.execution.balance(this.owner),snapshot=this.marketSnapshot(),pending=Object.values(this.s.orders).filter(o=>!o.terminal&&o.side==='BUY'),detail=[];let equity=balance+Object.values(this.s.rentByMint).reduce((n,r)=>n+r.lamports/1e9,0);
   for(const p of this.s.positions){const market=snapshot.markets.find(x=>x.mint===p.mint&&x.pairAddress===p.pairAddress),at=market?.priceAt??market?.updatedAt,price=market?.spotPriceSol??market?.priceUsd/snapshot.solUsd;if(!Number.isFinite(at)||at>now||now-at>1500||!(price>0))throw fail('RULES_EQUITY_UNVERIFIED');const value=p.quantity*price;equity+=value;detail.push({current_value_sol:value});}
   const fresh=await this.rulesEvidence?.read({mint:input.mint,pool:input.pairAddress,probeSol:Number(input.amount)/1e9,solUsd:snapshot.solUsd,rawMarket:snapshot.markets.find(x=>x.mint===input.mint&&x.pairAddress===input.pairAddress)??m});if(!fresh||fresh.error||!Number.isFinite(fresh.checkedAt)||fresh.checkedAt>this.clock()||this.clock()-fresh.checkedAt>5000)throw fail('RULES_EVIDENCE_UNVERIFIED');
   const facts=await (m.dexId==='pumpfun'?this.execution.inspectCurveMarket(m,input.amount):this.execution.inspectMarketFacts(m));if(!facts.top10ExcludesPool||facts.top10Pct>25||!(facts.devPct<=5))throw fail('RULES_ONCHAIN_HOLDER_REJECTED');
   const observations={...fresh.observations};if(Number.isFinite(facts.curveProgressPct)&&facts.curveProgressPct<fresh.inputs.curve_progress_pct)observations.curveMonotonic=false;
   const checkedInputs={...grant.inputs,...fresh.inputs,top10_pct:facts.top10Pct,dev_wallet_pct:facts.devPct,...(fresh.observations?.evidenceProfile==='onchain-momentum'?{holder_count:facts.holderCount,quote_reserve_sol:facts.quoteReserveSol}:{}),...(Number.isFinite(facts.curveProgressPct)?{curve_progress_pct:facts.curveProgressPct}:{}),account_equity_sol:equity,available_capital_sol:this.availableLamports(Math.round(balance*1e9))/1e9,open_positions_count:this.s.positions.length+pending.length,open_positions_detail:detail,current_utc_hour:new Date(this.clock()).getUTCHours(),sol_price_usd:snapshot.solUsd??grant.inputs.sol_price_usd};const result=evaluateV5(checkedInputs,observations);
   if(result.verdict!=='VALID_SETUP'||result.sizing_mode!==grant.result.sizing_mode||result.friction_detail.estimated_round_trip_friction_pct>grant.result.friction_detail.estimated_round_trip_friction_pct+.005||Math.floor(result.R1_detail.proposed_size_sol*1e9)!==Number(input.amount))throw fail('RULES_RECHECK_REJECTED');
   grant.lastEvidenceAt=fresh.checkedAt;grant.recheckedInputs=checkedInputs;grant.recheckedObservations=observations;
   if(grant.expiresAt<this.clock())throw fail('RULES_GRANT_EXPIRED');grant.intentId=input.id;input={...input,rulesPolicyVersion:RULES_VERSION,rulesScore:result.score,aiOnly:true};
  }
  return super.execute(input,m,id);
 }
 async authorizePrepared(order,prepared){
  if(order.side==='SELL')this.validateRuleExit(order);
  if(order.side==='BUY'&&order.rulesPolicyVersion===RULES_VERSION){const grant=this.rulesClient.grants.get(order.aiRiskEvidence?.rulesGrant);if(!grant||grant.expiresAt<this.clock())throw fail('RULES_GRANT_EXPIRED');await this.finalSizing(order,grant);if(grant.expiresAt<this.clock()||!Number.isFinite(prepared.quote?.quotedAt)||prepared.quote.quotedAt>this.clock()||this.clock()-prepared.quote.quotedAt>5000)throw fail('RULES_GRANT_EXPIRED');if(!Number.isFinite(grant.lastEvidenceAt)||this.clock()-grant.lastEvidenceAt>5000)throw fail('RULES_EVIDENCE_EXPIRED');let proof=prepared.entryQuoteProof;if(!proof){const market=this.marketSnapshot().markets.find(m=>m.mint===order.mint&&m.pairAddress===order.pairAddress);proof=await this.execution.roundTripQuote(order.mint,order.amount,market);if(proof.roundTripQuoteOk!==true||proof.probeSol!==Number(order.amount)/1e9||!Number.isFinite(proof.quoteCheckedAt)||proof.quoteCheckedAt>this.clock()||this.clock()-proof.quoteCheckedAt>5000)throw fail('RULES_EXECUTION_FRICTION_UNVERIFIED');}if(grant.expiresAt<this.clock()||this.clock()-prepared.quote.quotedAt>5000||this.clock()-grant.lastEvidenceAt>5000)throw fail('RULES_GRANT_EXPIRED');const loss=proof.roundTripLossPct;if(!Number.isFinite(loss)||loss>grant.result.friction_detail.friction_cap||loss>grant.result.friction_detail.estimated_round_trip_friction_pct+.5)throw fail('RULES_EXECUTION_FRICTION_UNVERIFIED');}
  if(order.rulesPolicyVersion===RULES_VERSION&&order.side==='BUY'){const key=order.aiRiskEvidence?.rulesGrant,grant=this.rulesClient.grants.get(key);if(grant?.result.requires_user_acknowledgment&&(this.rulesClient.approvals.get(key)??0)<this.clock())throw fail('RULES_ACK_EXPIRED');order.rulesScore=grant.preSignResult.score;order.rulesResultHash=rulesFingerprint(grant.preSignResult,order.pairAddress);try{this.rulesClient.audit?.enqueue({type:'rules_pre_sign',at:this.clock(),intentId:order.id,mint:order.mint,resultHash:order.rulesResultHash,result:grant.preSignResult});}catch{}this.rulesClient.approvals.delete(key);}
  return super.authorizePrepared(order,prepared);
 }
 status(){return {...super.status(),decisionEngine:'rules-v5',aiOnly:false};}
}
