import {scoreRules} from './rules-score.js';
import {planRulesOrder,AUTO_SIZING} from './rules-allocation.js';
import {ENTRY_RULES_VERSION,MIN_RULES_SCORE,momentumChecks} from './rules-momentum.js';
import {createHash} from 'node:crypto';
export const RULES_VERSION='pumpfun-rules-v5.0';
export const LIVE_EXIT_V5=Object.freeze({version:RULES_VERSION,stopLossPct:20,firstProfitPct:100,firstSellFraction:.5,trailingPct:15,timeExitMs:5400000,timeBandLowPct:-5,timeBandHighPct:15,maxHoldMs:null,maxQuoteAgeMs:1500});
export const EXIT_V5=Object.freeze({stop:'-20%',tp:'50% @ 2x',time_exit:'90 min if -5% to +15%',trail:'-15% from peak after 2x'});
export class RulesInputError extends Error{constructor(fields){super('RULES_DATA_MISSING');this.code='RULES_DATA_MISSING';this.fields=fields;}}
const finite=Number.isFinite;
export function sizingV5(i,observed={}){
 const quoteBased=finite(i.round_trip_quote_loss_pct);const required=['account_equity_sol','available_capital_sol','priority_fee_sol',...(quoteBased?[]:['protocol_fee_pct','expected_slippage_pct'])],missing=required.filter(k=>!finite(i[k])||i[k]<0);if(quoteBased&&i.round_trip_quote_loss_pct<0)missing.push('round_trip_quote_loss_pct');if(missing.length)throw new RulesInputError(missing);
 const plan=planRulesOrder(i,observed),min=Math.max(AUTO_SIZING.minOrderSol,i.priority_fee_sol*40),friction=size=>quoteBased?i.round_trip_quote_loss_pct+2*i.priority_fee_sol/size*100:2*i.priority_fee_sol/size*100+2*i.protocol_fee_pct+2*i.expected_slippage_pct;
 const possible=plan.size>=min&&friction(plan.size)<=AUTO_SIZING.frictionCapPct,mode=possible?'AUTO':'INFEASIBLE',size=possible?plan.size:0,denominator=possible?size:Math.max(min,plan.size),total=denominator>0?friction(denominator):null;
 return {...plan,mode,min,standard:plan.target,size,maxPositions:possible?5:0,friction:total,frictionSol:total===null?null:size*total/100,priorityPct:denominator>0?i.priority_fee_sol/denominator*100:null,denominator,cap:AUTO_SIZING.frictionCapPct};
}
export function evaluateV5(i,observed={}){
 const core=observed.evidenceProfile==='onchain-momentum';
 const required=['sol_price_usd','top10_pct','dev_wallet_pct','token_age_minutes','current_utc_hour','open_positions_count',...(core?['holder_count','quote_reserve_sol','change_5m_pct','buys_5m','sells_5m','volume_5m_sol','round_trip_quote_loss_pct']:['block0_buyer_count','graduation_dump_model'])];
 const missing=required.filter(k=>!finite(i[k]));for(const k of [...(core?[]:['dev_sell_history','bundle_clusters']),'open_positions_detail'])if(!Array.isArray(i[k]))missing.push(k);
 for(const k of ['top10_pct','dev_wallet_pct','global_pumpfun_volume_24h_percentile','graduation_dump_model'])if(finite(i[k])&&(i[k]<0||i[k]>100))missing.push(k);
 if(!Number.isInteger(i.open_positions_count)||i.open_positions_count<0||!core&&(!Number.isInteger(i.block0_buyer_count)||i.block0_buyer_count<0))missing.push('integer_counts');
 if(core&&(['holder_count','buys_5m','sells_5m'].some(k=>!Number.isInteger(i[k])||i[k]<0)||i.volume_5m_sol<0||i.quote_reserve_sol<0||i.round_trip_quote_loss_pct<0))missing.push('invalid_momentum_counts_or_quote');
 if(i.token_age_minutes<0||finite(i.narrative_heat)&&(i.narrative_heat<0||i.narrative_heat>10))missing.push('age_or_narrative_range');
 if(!Number.isInteger(i.current_utc_hour)||i.current_utc_hour<0||i.current_utc_hour>23)missing.push('current_utc_hour');
 if(Array.isArray(i.dev_sell_history)&&i.dev_sell_history.some(t=>!finite(t.age_minutes)||t.age_minutes<0))missing.push('dev_sell_history.age_minutes');
 if(i.sol_price_usd<=0||i.account_equity_sol<0)missing.push('positive_equity_and_conversion');if(missing.length)throw new RulesInputError(missing);
 const z=sizingV5(i,observed),{pos,neg,score}=scoreRules(i,observed,z),red=[],green=[];
 if(z.mode!=='INFEASIBLE'&&z.size<=0)throw new RulesInputError(['positive_spendable_for_F5']);
 const sizeBound=z.maxOrder;
 const checks={a_size_within_bound:z.size<=sizeBound,b_positions_below_max:i.open_positions_count<z.maxPositions,c_capital_sufficient:i.available_capital_sol>=z.size,d_positions_valued:i.open_positions_detail.every(p=>finite(p.current_value_sol)&&p.current_value_sol>=0)};
 const rules={R1:Object.values(checks).every(Boolean)&&z.size>0,R2:i.top10_pct<=25,R3:i.dev_wallet_pct<=5&&observed.creatorSoldRecently!==true&&!(i.dev_sell_history??[]).some(t=>finite(t.age_minutes)&&t.age_minutes<=10),R4:core?Object.values(momentumChecks(i,observed)).every(Boolean):i.token_age_minutes<=360||observed.newAthWithin120m===true&&observed.volume1hDeclining===false&&finite(i.holder_growth_rate)&&i.holder_growth_rate>0,R5:true,R6:true,R7:observed.suspectedBundle!==true&&(!finite(i.block0_buyer_count)||i.block0_buyer_count<=3)&&!(i.bundle_clusters??[]).some(c=>(c.wallet_count??c.wallets?.length??0)>=3),R8:score>=MIN_RULES_SCORE,R9:(!core||i.round_trip_quote_loss_pct<=6)&&(!core||Number.isFinite(i.quote_probe_sol)&&Math.round(i.quote_probe_sol*1e9)===Math.round(z.size*1e9))&&z.friction!==null&&z.friction<=z.cap&&z.mode!=='INFEASIBLE'};
 // V5.2: no clock/percentile gate, score >=6; unavailable research never earns a bonus.
 const verdict=z.mode!=='INFEASIBLE'&&Object.values(rules).every(Boolean)?'VALID_SETUP':'SKIP';
 for(const [r,ok]of Object.entries(rules))(ok?green:red).push(`${r} ${ok?'pass':'fail'}`);
 const pct=i.account_equity_sol>0?z.size/i.account_equity_sol*100:0,warnings=[];
 const infeasibleReason=z.mode==='INFEASIBLE'?`INFEASIBLE: size below ${z.min} SOL or friction exceeds ${z.cap}%; `:'';
 const p=z.priorityPct,protocol=i.protocol_fee_pct??null,slip=i.expected_slippage_pct??null,usd=i.sol_price_usd;
 const out={token:i.token,score,score_breakdown:{positives:pos,negatives:neg},red_flags:red,green_flags:green,rule_check:Object.fromEntries(Object.entries(rules).map(([k,v])=>[k,v?'pass':'fail'])),sizing_mode:z.mode,R1_detail:{account_equity:i.account_equity_sol*usd,account_equity_sol:i.account_equity_sol,available_capital:i.available_capital_sol*usd,open_positions_count:i.open_positions_count,max_concurrent_positions:z.maxPositions,standard_size:z.standard*usd,max_order_sol:z.maxOrder,wallet_balance_sol:z.walletBalance,target_fraction:z.fraction,allocation_score:z.allocationScore,liquidity_cap_sol:Number.isFinite(z.depthCap)?z.depthCap:null,min_viable_size_sol:z.min,proposed_position_size:z.size*usd,proposed_size_sol:z.size,size_pct_of_equity:pct.toFixed(2)+'%',checks},friction_detail:{entry_priority_fee_sol:i.priority_fee_sol,exit_priority_fee_sol:i.priority_fee_sol,entry_protocol_fee_pct:protocol,exit_protocol_fee_pct:protocol,entry_slippage_pct:slip,exit_slippage_pct:slip,entry_priority_fee_pct:p===null?null:p.toFixed(4)+'%',exit_priority_fee_pct:p===null?null:p.toFixed(4)+'%',estimated_round_trip_friction_pct:z.friction,estimated_round_trip_friction_sol:z.frictionSol,friction_cap:z.cap,math:finite(i.round_trip_quote_loss_pct)?`verified roundtrip quote ${i.round_trip_quote_loss_pct}% + network fee allowance ${2*i.priority_fee_sol/z.denominator*100}% = ${z.friction}%`:`entry_prio ${i.priority_fee_sol}/${z.denominator}=${p}% + exit_prio ${i.priority_fee_sol}/${z.denominator}=${p}% + protocol ${protocol}+${protocol} + slip ${slip}+${slip} = ${z.friction}%`},position_plan:verdict==='VALID_SETUP'?{size_usdc:z.size*usd,size_sol:z.size,size_pct:pct.toFixed(2)+'%',mode:z.mode,rationale:`R1 ${z.size} SOL; friction ${z.friction}% <= ${z.cap}%`}:null,size_warnings:warnings,requires_user_acknowledgment:false,dump_model:{top5_exit_drop_pct:i.graduation_dump_model??null,math:observed.dumpMath??(finite(i.graduation_dump_model)?`provided input ${i.graduation_dump_model}%`:'not verified')},exit_plan:verdict==='SKIP'?null:{...EXIT_V5},verdict,confidence:0,reasoning_trace:`${ENTRY_RULES_VERSION}; profile ${core?'onchain-momentum':'full-research'}; min score ${MIN_RULES_SCORE}; ${core?'dev launch history, full bundles, global percentile, funding and socials NOT verified; ':''}${infeasibleReason}equity ${i.account_equity_sol} SOL; min viable ${z.min}; wallet ${z.walletBalance} SOL; per-order cap ${z.maxOrder} SOL; auto fraction ${z.fraction}; size ${z.size}; friction ${z.friction}%; max_concurrent_positions ${z.maxPositions}; score ${score}.`};
 return out;
}
export function rulesFingerprint(result,pool=null){return createHash('sha256').update(JSON.stringify([ENTRY_RULES_VERSION,pool,result.token,result.score,result.rule_check,result.R1_detail,result.friction_detail])).digest('hex');}
export function exitV5(p,price,now,memory){
 const entry=p.entryPriceSol??p.initialCostSol/p.initialQuantity;if(!(entry>0)||!(price>0))return null;
 const move=price/entry-1;memory.peak=Math.max(memory.peak??entry,price);
 memory.stopTriggered ||= price<=entry*.8;
 memory.tpTriggered ||= move>=1;
 memory.trailTriggered ||= memory.tpConfirmed&&price<=memory.peak*.85;
 memory.timeTriggered ||= now-p.openedAt>=90*60000&&move>=-.05-1e-10&&move<=.15+1e-10;
 if(memory.stopTriggered)return {reason:'stop-loss',fraction:1};
 if(memory.trailTriggered)return {reason:'rules-trailing-15',fraction:1};
 if(memory.timeTriggered)return {reason:'rules-time-exit',fraction:1};
 if(!memory.tpConfirmed&&memory.tpTriggered)return {reason:'rules-tp-2x',fraction:.5};return null;
}

export function latchedExitV5(memory){return memory.stopTriggered?{reason:'stop-loss',fraction:1}:memory.trailTriggered?{reason:'rules-trailing-15',fraction:1}:memory.timeTriggered?{reason:'rules-time-exit',fraction:1}:!memory.tpConfirmed&&memory.tpTriggered?{reason:'rules-tp-2x',fraction:.5}:null;}
