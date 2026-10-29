import {createHash} from 'node:crypto';
import {rulesConfig} from './rules-config.js';import {preFilter,signalScore,signalTier,constantProductEstimate} from './rules-signal.js';
import {planRulesOrder} from './rules-allocation.js';
export const RULES_VERSION='pumpfun-rules-v5.0';
export const LIVE_EXIT_V5=Object.freeze({version:RULES_VERSION,stopLossPct:20,firstProfitPct:100,firstSellFraction:.5,trailingPct:15,timeExitMs:5400000,timeBandLowPct:-5,timeBandHighPct:15,maxHoldMs:null,maxQuoteAgeMs:1500});
export const LIVE_EXIT_V53=Object.freeze({...LIVE_EXIT_V5,version:'pumpfun-rules-v5.4',breakEvenTriggerPct:50,breakEvenStopPct:0});
export const EXIT_V5=Object.freeze({stop:'-20%',tp:'50% @ 2x',time_exit:'90 min if -5% to +15%',trail:'-15% from peak after 2x'});
export class RulesInputError extends Error{constructor(fields){super('RULES_DATA_MISSING');this.code='RULES_DATA_MISSING';this.fields=fields;}}
export function sizingV5(i,o={},p=rulesConfig()){
 const required=['account_equity_sol','available_capital_sol','priority_fee_sol'],missing=required.filter(k=>!Number.isFinite(i[k])||i[k]<0);if(missing.length)throw new RulesInputError(missing);
 const plan=planRulesOrder(i,o,p),min=Math.max(p.minOrderSol,i.priority_fee_sol*40),rough=constantProductEstimate(plan.size,i.quote_reserve_sol),loss=Number.isFinite(i.round_trip_quote_loss_pct)?i.round_trip_quote_loss_pct:rough?.roundtripPriceOnlyPct??Infinity;
 const friction=loss+(plan.size>0?2*i.priority_fee_sol/plan.size*100:0),possible=plan.size>=min&&friction<=p.maxRoundTripLossPct;
 return {...plan,mode:possible?'AUTO':'INFEASIBLE',min,standard:plan.target,size:possible?plan.size:0,maxPositions:possible?p.maxPositions:0,friction,frictionSol:possible?plan.size*friction/100:0,priorityPct:plan.size>0?i.priority_fee_sol/plan.size*100:null,cap:p.maxRoundTripLossPct,rough,quoteVerified:i.quote_status==='verified'};
}
export function evaluateV5(i,o={},p=rulesConfig()){
 const missing=['top10_pct','dev_wallet_pct','holder_count','quote_reserve_sol','sol_price_usd','open_positions_count'].filter(k=>!Number.isFinite(i[k]));if(missing.length)throw new RulesInputError(missing);
 if(i.top10_pct<0||i.top10_pct>100||i.dev_wallet_pct<0||i.dev_wallet_pct>100)throw new RulesInputError(['percent units/range']);
 const scored=signalScore(i,o,p),tier=signalTier(i,scored.score,p,i.softRisk),z=sizingV5({...i,entry_tier:tier.tier},o,p),cheap=preFilter(i,p);
 const rules={R1:z.size>0&&i.open_positions_count<p.maxPositions,R2:i.top10_pct<=p.maxTop10Pct,R3:i.dev_wallet_pct<=p.maxDevPct&&o.creatorSoldRecently!==true,R4:i.holder_count>=p.minHolderCount&&i.quote_reserve_sol>=p.minReserveSol,R5:true,R6:true,R7:o.suspectedBundle!==true,R8:tier.tier!=='SKIP',R9:z.mode!=='INFEASIBLE'&&cheap.ok&&(!Number.isFinite(i.round_trip_quote_loss_pct)||i.round_trip_quote_loss_pct<=p.maxRoundTripLossPct)};
 const verdict=Object.values(rules).every(Boolean)?'VALID_SETUP':'SKIP',usd=i.sol_price_usd,pct=i.account_equity_sol>0?z.size/i.account_equity_sol*100:0;
 return {token:i.token,score:scored.score,entry_tier:tier.tier,signal:tier,unknowns:scored.unknowns,score_breakdown:{positives:scored.pos,negatives:scored.neg},red_flags:Object.entries(rules).filter(([,v])=>!v).map(([k])=>k+' fail'),green_flags:[],rule_check:Object.fromEntries(Object.entries(rules).map(([k,v])=>[k,v?'pass':'fail'])),sizing_mode:z.mode,R1_detail:{account_equity:i.account_equity_sol*usd,account_equity_sol:i.account_equity_sol,available_capital:i.available_capital_sol*usd,open_positions_count:i.open_positions_count,max_concurrent_positions:z.maxPositions,standard_size:z.baseRiskSize*usd,tier_factor:z.tierFactor,max_order_sol:z.maxOrder,wallet_balance_sol:z.walletBalance,target_fraction:z.fraction,risk_fraction:z.riskFraction,assumed_loss_fraction:z.assumedLossFraction,risk_budget_sol:z.riskBudgetSol,allocation_score:z.allocationScore,softRisk:z.softRisk,exposure_remaining_sol:z.exposureRemaining,liquidity_cap_sol:z.depthCap,min_viable_size_sol:z.min,proposed_position_size:z.size*usd,proposed_size_sol:z.size,size_pct_of_equity:pct.toFixed(2)+'%'},friction_detail:{estimated_round_trip_friction_pct:z.friction,estimated_round_trip_friction_sol:z.frictionSol,friction_cap:z.cap,quoteVerified:z.quoteVerified,rough:z.rough,math:z.quoteVerified?'verified quote plus network allowance':'CPMM indication only; quote required before BUY'},position_plan:verdict==='VALID_SETUP'?{size_sol:z.size,size_usdc:z.size*usd}:null,size_warnings:[],requires_user_acknowledgment:false,dump_model:{top5_exit_drop_pct:i.graduation_dump_model??null},exit_plan:verdict==='SKIP'?null:{...EXIT_V5,breakEvenTriggerPct:p.breakEvenTriggerPct},verdict,confidence:0,reasoning_trace:p.version+'; '+tier.tier+'; no timed BUY pause',diagnostic:{volume_5m_sol:i.volume_5m_sol,buys:i.buys_5m,sells:i.sells_5m,buy_sell_ratio:tier.ratio,change_5m_pct:i.change_5m_pct,reserve:i.quote_reserve_sol,holder_count:i.holder_count,top10_pct:i.top10_pct,dev_pct:i.dev_wallet_pct,top10_unit:'percent',failed:Object.entries(rules).filter(([,v])=>!v).map(([k])=>k),signal:tier,preFilter:cheap}};
}
export function rulesFingerprint(result,pool=null){return createHash('sha256').update(JSON.stringify([rulesConfig().version,pool,result.token,result.score,result.rule_check,result.R1_detail,result.friction_detail])).digest('hex');}
export function exitV5(p,price,now,memory){
 const entry=p.entryPriceSol??p.initialCostSol/p.initialQuantity;if(!(entry>0)||!(price>0))return null;
 const move=price/entry-1;memory.peak=Math.max(memory.peak??entry,price);
 memory.breakEvenArmed ||= p.exitPolicy?.breakEvenTriggerPct>0&&memory.peak>=entry*(1+p.exitPolicy.breakEvenTriggerPct/100);
 memory.stopTriggered ||= price<=(memory.breakEvenArmed?entry:entry*.8);
 memory.tpTriggered ||= move>=1;
 memory.trailTriggered ||= memory.tpConfirmed&&price<=memory.peak*.85;
 memory.timeTriggered ||= now-p.openedAt>=90*60000&&move>=-.05-1e-10&&move<=.15+1e-10;
 if(memory.stopTriggered)return {reason:'stop-loss',fraction:1};
 if(memory.trailTriggered)return {reason:'rules-trailing-15',fraction:1};
 if(memory.timeTriggered)return {reason:'rules-time-exit',fraction:1};
 if(!memory.tpConfirmed&&memory.tpTriggered)return {reason:'rules-tp-2x',fraction:.5};return null;
}

export function latchedExitV5(memory){return memory.stopTriggered?{reason:'stop-loss',fraction:1}:memory.trailTriggered?{reason:'rules-trailing-15',fraction:1}:memory.timeTriggered?{reason:'rules-time-exit',fraction:1}:!memory.tpConfirmed&&memory.tpTriggered?{reason:'rules-tp-2x',fraction:.5}:null;}
