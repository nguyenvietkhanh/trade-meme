import {createHash} from 'node:crypto';
export const RULES_VERSION='pumpfun-rules-v5.0';
export const LIVE_EXIT_V5=Object.freeze({version:RULES_VERSION,stopLossPct:20,firstProfitPct:100,firstSellFraction:.5,trailingPct:15,timeExitMs:5400000,timeBandLowPct:-5,timeBandHighPct:15,maxHoldMs:null,maxQuoteAgeMs:1500});
export const EXIT_V5=Object.freeze({stop:'-20%',tp:'50% @ 2x',time_exit:'90 min if -5% to +15%',trail:'-15% from peak after 2x'});
export class RulesInputError extends Error{constructor(fields){super('RULES_DATA_MISSING');this.code='RULES_DATA_MISSING';this.fields=fields;}}
const finite=Number.isFinite,down=x=>Math.floor(x*1e9)/1e9;
export function sizingV5(i){
 const required=['account_equity_sol','available_capital_sol','priority_fee_sol','protocol_fee_pct','expected_slippage_pct'],missing=required.filter(k=>!finite(i[k])||i[k]<0);if(missing.length)throw new RulesInputError(missing);
 const equity=i.account_equity_sol,min=Math.max(.05,i.priority_fee_sol*40),standard=.02*equity,friction=size=>2*i.priority_fee_sol/size*100+2*i.protocol_fee_pct+2*i.expected_slippage_pct;
 const mode=min>.15*equity||friction(min)>12?'INFEASIBLE':standard<min?'ADAPTIVE':'STANDARD',size=mode==='INFEASIBLE'?0:down(Math.min(mode==='STANDARD'?standard:min,i.available_capital_sol)),denominator=mode==='INFEASIBLE'?min:size;
 const total=denominator>0?friction(denominator):null;
 return {mode,min,standard,size,maxPositions:mode==='INFEASIBLE'?0:Math.min(5,Math.floor(equity/(mode==='STANDARD'?standard:min)+1e-10)),friction:total,frictionSol:total===null?null:size*total/100,priorityPct:denominator>0?i.priority_fee_sol/denominator*100:null,denominator,cap:mode==='STANDARD'?8:12};
}
export function evaluateV5(i,observed={}){
 const required=['sol_price_usd','top10_pct','dev_wallet_pct','token_age_minutes','current_utc_hour','global_pumpfun_volume_24h_percentile','block0_buyer_count','graduation_dump_model','open_positions_count'];
 const missing=required.filter(k=>!finite(i[k]));for(const k of ['dev_sell_history','bundle_clusters','open_positions_detail'])if(!Array.isArray(i[k]))missing.push(k);
 for(const k of ['top10_pct','dev_wallet_pct','global_pumpfun_volume_24h_percentile','graduation_dump_model'])if(finite(i[k])&&(i[k]<0||i[k]>100))missing.push(k);
 if(!Number.isInteger(i.open_positions_count)||i.open_positions_count<0||!Number.isInteger(i.block0_buyer_count)||i.block0_buyer_count<0)missing.push('integer_counts');
 if(i.token_age_minutes<0||finite(i.narrative_heat)&&(i.narrative_heat<0||i.narrative_heat>10))missing.push('age_or_narrative_range');
 if(!Number.isInteger(i.current_utc_hour)||i.current_utc_hour<0||i.current_utc_hour>23)missing.push('current_utc_hour');
 if(Array.isArray(i.dev_sell_history)&&i.dev_sell_history.some(t=>!finite(t.age_minutes)||t.age_minutes<0))missing.push('dev_sell_history.age_minutes');
 if(i.sol_price_usd<=0||i.account_equity_sol<0)missing.push('positive_equity_and_conversion');if(missing.length)throw new RulesInputError(missing);
 const z=sizingV5(i),pos=[],neg=[],red=[],green=[],add=(points,reason)=>{(points>0?pos:neg).push({points,reason});},number=k=>finite(i[k]),curve=number('curve_progress_pct')&&i.curve_progress_pct>=15&&i.curve_progress_pct<=80;
 if(curve&&observed.curveMonotonic===true)add(1.5,'curve 15–80%, monotonic');
 if(i.dev_wallet_pct<3&&i.dev_sell_history.length===0)add(1.5,'dev <3%, no sells');
 if(i.top10_pct<15)add(1.5,'top10 <15%');
 if(number('holder_growth_rate')&&i.holder_growth_rate>0&&i.bundle_clusters.length===0)add(1,'organic holder growth');
 if(number('buy_sell_ratio')&&i.buy_sell_ratio>1.2&&observed.volume5mStable===true)add(1,'buy/sell >1.2, stable volume');
 if(number('narrative_heat')&&i.narrative_heat>=7&&i.token_age_minutes<360)add(.5,'narrative >=7');
 if(i.funding_source_trace?.status==='clean')add(.5,'funding verified clean');
 if(observed.liquidityHealthy===true)add(.5,'liquidity criterion verified');
 const socials=i.socials,ages=socials?.account_age_days;
 if(socials?.presence===true&&Array.isArray(ages)&&ages.length&&ages.every(a=>finite(a)&&a>=30))add(.5,'socials >=30d');
 if(i.bundle_clusters.length||i.block0_buyer_count>=3)add(-3,'bundle or block0 >=3');
 if(i.graduation_dump_model>40)add(-2,'graduation dump >40');
 if(z.friction>6)add(-2,'roundtrip >6%');
 if(socials?.presence===false||Array.isArray(ages)&&ages.some(a=>finite(a)&&a<2))add(-1.5,'missing socials or age <48h');
 if(number('holder_growth_rate')&&i.holder_growth_rate<=0)add(-1,'non-positive holder growth');
 if(i.token_age_minutes>360&&observed.newAthWithin120m===false)add(-1,'old token, no recent ATH');
 if(i.expected_slippage_pct>8)add(-1,'slippage >8%');if(z.mode==='ADAPTIVE')add(-.5,'ADAPTIVE sizing');
 if(z.mode!=='INFEASIBLE'&&z.size<=0)throw new RulesInputError(['positive_spendable_for_F5']);
 const score=Math.max(0,Math.min(10,[...pos,...neg].reduce((n,p)=>n+p.points,0))),sizeBound=Math.max(z.standard,z.min),driftLimit=z.mode==='ADAPTIVE'?z.min:z.standard;
 const checks={a_size_within_bound:z.size<=sizeBound,b_positions_below_max:i.open_positions_count<z.maxPositions,c_capital_sufficient:i.available_capital_sol>=z.size,d_no_position_drift:i.open_positions_detail.every(p=>finite(p.current_value_sol)&&p.current_value_sol>=0&&p.current_value_sol<=driftLimit+1e-9)};
 const rules={R1:Object.values(checks).every(Boolean)&&z.size>0,R2:i.top10_pct<=25,R3:i.dev_wallet_pct<=5&&!i.dev_sell_history.some(t=>finite(t.age_minutes)&&t.age_minutes<=10),R4:i.token_age_minutes<=360||observed.newAthWithin120m===true&&observed.volume1hDeclining===false&&number('holder_growth_rate')&&i.holder_growth_rate>0,R5:true,R6:Number.isInteger(i.current_utc_hour)&&i.current_utc_hour>=3&&i.current_utc_hour<=17&&i.global_pumpfun_volume_24h_percentile>=30,R7:i.block0_buyer_count<=3&&!i.bundle_clusters.some(c=>(c.wallet_count??c.wallets?.length??0)>=3),R8:score>=8,R9:z.friction!==null&&z.friction<=z.cap&&z.mode!=='INFEASIBLE'};
 // R8 is hard. WATCH is unreachable under the supplied V5 rules and is not fabricated.
 const verdict=z.mode!=='INFEASIBLE'&&Object.values(rules).every(Boolean)?'VALID_SETUP':'SKIP';
 for(const [r,ok]of Object.entries(rules))(ok?green:red).push(`${r} ${ok?'pass':'fail'}`);
 const pct=i.account_equity_sol>0?z.size/i.account_equity_sol*100:0,warnings=z.mode==='ADAPTIVE'?[`SIZE_DEVIATION: ${pct.toFixed(2)}% of equity exceeds 2% rule`]:[];
 const infeasibleReason=z.mode==='INFEASIBLE'?(z.min>.15*i.account_equity_sol?`INFEASIBLE: min viable ${z.min} SOL > 15% equity ${.15*i.account_equity_sol} SOL; `:`INFEASIBLE: friction at min viable ${z.friction}% > 12%; `):'';
 const p=z.priorityPct,protocol=i.protocol_fee_pct,slip=i.expected_slippage_pct,usd=i.sol_price_usd;
 const out={token:i.token,score,score_breakdown:{positives:pos,negatives:neg},red_flags:red,green_flags:green,rule_check:Object.fromEntries(Object.entries(rules).map(([k,v])=>[k,v?'pass':'fail'])),sizing_mode:z.mode,R1_detail:{account_equity:i.account_equity_sol*usd,account_equity_sol:i.account_equity_sol,available_capital:i.available_capital_sol*usd,open_positions_count:i.open_positions_count,max_concurrent_positions:z.maxPositions,standard_size:z.standard*usd,min_viable_size_sol:z.min,proposed_position_size:z.size*usd,proposed_size_sol:z.size,size_pct_of_equity:pct.toFixed(2)+'%',checks},friction_detail:{entry_priority_fee_sol:i.priority_fee_sol,exit_priority_fee_sol:i.priority_fee_sol,entry_protocol_fee_pct:protocol,exit_protocol_fee_pct:protocol,entry_slippage_pct:slip,exit_slippage_pct:slip,entry_priority_fee_pct:p===null?null:p.toFixed(4)+'%',exit_priority_fee_pct:p===null?null:p.toFixed(4)+'%',estimated_round_trip_friction_pct:z.friction,estimated_round_trip_friction_sol:z.frictionSol,friction_cap:z.cap,math:`entry_prio ${i.priority_fee_sol}/${z.denominator}=${p}% + exit_prio ${i.priority_fee_sol}/${z.denominator}=${p}% + protocol ${protocol}+${protocol} + slip ${slip}+${slip} = ${z.friction}%`},position_plan:verdict==='VALID_SETUP'?{size_usdc:z.size*usd,size_sol:z.size,size_pct:pct.toFixed(2)+'%',mode:z.mode,rationale:`R1 ${z.size} SOL; friction ${z.friction}% <= ${z.cap}%`}:null,size_warnings:warnings,requires_user_acknowledgment:z.mode==='ADAPTIVE',dump_model:{top5_exit_drop_pct:i.graduation_dump_model,math:observed.dumpMath??`provided input ${i.graduation_dump_model}%`},exit_plan:verdict==='SKIP'?null:{...EXIT_V5},verdict,confidence:0,reasoning_trace:`${infeasibleReason}${warnings.length?'SIZE_DEVIATION; ':''}equity ${i.account_equity_sol} SOL; min viable ${z.min}; 15% equity ${.15*i.account_equity_sol}; size ${z.size}; friction ${z.friction}%; max_concurrent_positions ${z.maxPositions}; score ${score}.`};
 return out;
}
export function rulesFingerprint(result,pool=null){return createHash('sha256').update(JSON.stringify([RULES_VERSION,pool,result.token,result.score,result.rule_check,result.R1_detail,result.friction_detail])).digest('hex');}
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
