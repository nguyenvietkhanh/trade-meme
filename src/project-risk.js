// Deterministic project policy. Pure checks: no model, network, wallet or signing access.
import {rulesConfig} from './rules-config.js';
export const PROJECT_RULES_VERSION='pumpfun-project-rules-v6';
const finite=Number.isFinite,down=n=>Math.floor(Math.max(0,n)*1e9+1e-7)/1e9;
export function projectRulesConfig(env=process.env){
 const base=rulesConfig({...env,MAX_POSITIONS:'4',RISK_PER_TRADE_PCT:'1.5',MAX_TOP10_PCT:'22',MAX_DEV_PCT:'4',SMALL_WALLET_ORDER_ENABLED:'false',QUICK_ENABLED:'false',RUNNER_ENABLED:'false'});
 const timezone=env.PROJECT_TIME_ZONE??'Asia/Ho_Chi_Minh';new Intl.DateTimeFormat('en-GB',{timeZone:timezone}).format(0);
 return {...base,version:PROJECT_RULES_VERSION,projectRules:true,timezone,pollMs:10000,riskFraction:.015,worstLoss:1,maxPositions:4,maxTop10Pct:22,maxDevPct:4,smallWalletOrderEnabled:false,maxOrderFraction:.015,quickEnabled:false,runner:{...base.runner,enabled:false},tp1Pct:100,tp1SellFraction:.4,breakEvenTriggerPct:0,projectFeeReserveSol:.0025};
}
export function projectLossPause(state,now){
 const unique=new Map();for(const t of [...(state.trades??[])].sort((a,b)=>b.at-a.at)){
  if(t.side!=='SELL'||!t.closed||!finite(t.at)||t.at>now)continue;
  const key=t.positionId??t.id??t.signature;if(!key)continue;if(!unique.has(key))unique.set(key,t);
 }
 let lossStreak=0,historyVerified=true,latestLossAt=null;
 for(const t of unique.values()){if(!finite(t.positionPnlSol)){historyVerified=false;break;}if(t.positionPnlSol>=0)break;lossStreak++;latestLossAt??=t.at;}
 const previous=state.projectRisk??{},pauseUntil=Math.max(finite(previous.pauseUntil)?previous.pauseUntil:0,lossStreak>=2?latestLossAt+3600000:0);
 state.projectRisk={version:1,pauseUntil,lossStreak,historyVerified};return {...state.projectRisk,buyPaused:now<pauseUntil};
}
export function projectEquity(balance,state,snapshot,now){
 if(!finite(balance)||balance<0)return null;let total=balance+Object.values(state.rentByMint??{}).reduce((n,r)=>n+r.lamports/1e9,0);for(const p of state.positions??[]){const m=snapshot.markets.find(m=>m.mint===p.mint&&m.pairAddress===p.pairAddress),at=m?.priceAt??m?.updatedAt,price=m?.spotPriceSol??m?.priceUsd/snapshot.solUsd;if(!finite(at)||at>now||now-at>1500||!finite(price)||price<=0||!finite(p.quantity)||p.quantity<0)return null;total+=p.quantity*price;}return finite(total)?total:null;
}
export function projectExitPolicy(){return {version:'project-rules-v6-fixed',stopLossPct:30,firstProfitPct:100,firstSellFraction:.4,trailingPct:null,timeExitMs:null,maxHoldMs:null,maxQuoteAgeMs:1500};}
export function projectExit(p,price,_now,memory){
 const entry=p.entryPriceSol??p.initialCostSol/p.initialQuantity;if(!(entry>0)||!(price>0))return null;
 memory.stopTriggered ||= price<=entry*.7;memory.tpTriggered ||= price>=entry*2;
 return memory.stopTriggered?{reason:'stop-loss',fraction:1}:!memory.tpConfirmed&&memory.tpTriggered?{reason:'rules-tp1',fraction:.4}:null;
}
export function evaluateProjectRules(i,o={},p=projectRulesConfig()){
 const now=i.current_time_ms,r=i.project_research??{},fresh=finite(r.checkedAt)&&r.checkedAt<=now&&now-r.checkedAt<=60000;
 const rules={},detail={},missing=[];
 function check(id,name,value,limit,ok,verified=true){const status=verified?(ok?'pass':'fail'):'unverified';rules[id]=status;detail[id]={name,value:value??null,limit,status};if(status==='unverified')missing.push(name);}
 const wallet=i.wallet_balance_sol,equity=i.account_equity_sol,capital=i.available_capital_sol,count=i.open_positions_count;
 const account=[wallet,equity,capital,count].every(n=>finite(n)&&n>=0)&&Number.isInteger(count),riskBudget=account?equity*.015:0,fee=p.projectFeeReserveSol??.0025;
 const exposureRemaining=account?Math.max(0,equity*p.exposureFraction-(i.open_exposure_sol??0)):0;
 const target=account?Math.min(riskBudget-fee,wallet*.015,capital-fee,wallet-p.reserveSol-p.bufferSol-fee,i.quote_reserve_sol*p.poolFraction,exposureRemaining):0;
 let size=down(target);if(finite(i.quote_selected_sol))size=down(Math.min(size,i.quote_selected_sol));
 if(size<p.minOrderSol)size=0;
 check('R1','risk_and_positions',{riskBudgetSol:riskBudget,orderSol:size,feeReserveSol:fee,openPositions:count},'risk <=1.5%; max 4',account&&size>0&&size+fee<=riskBudget+1e-12&&count<4,account);
 check('R2','top10_excluding_curve_pool_pct',i.top10_pct,'<22%',i.top10_pct>=0&&i.top10_pct<22,finite(i.top10_pct)&&fresh&&r.top10WalletsVerified===true);
 check('R3','dev_wallet_pct',i.dev_wallet_pct,'<4%',i.dev_wallet_pct>=0&&i.dev_wallet_pct<4,finite(i.dev_wallet_pct));
 check('R12','dev_first_15m_sells',r.devSoldFirst15m,'no sales in first 15m',r.devSoldFirst15m===false,fresh&&(r.devSellHistoryVerified===true||r.devSoldFirst15m===true)&&typeof r.devSoldFirst15m==='boolean');
 check('R4','curve_holder_depth',{curve:i.curve_progress_pct,holders:i.holder_count,reserveSol:i.quote_reserve_sol},'curve 15-75%; existing holder/depth protections',i.curve_progress_pct>=15&&i.curve_progress_pct<=75&&i.holder_count>=p.minHolderCount&&i.quote_reserve_sol>=p.minReserveSol,finite(i.curve_progress_pct)&&finite(i.holder_count)&&finite(i.quote_reserve_sol));
 let hour=null;try{if(finite(now))hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:p.timezone??'Asia/Ho_Chi_Minh',hour:'2-digit',hourCycle:'h23'}).format(now));}catch{}
 check('R5','local_entry_hours',hour,'no BUY 01:00-08:00',hour<1||hour>=8,finite(hour));
 check('R6','two_loss_cooldown',i.softRisk?.pauseUntil,'60m after 2 closed losses',!(i.softRisk?.buyPaused===true)&&!(finite(i.softRisk?.pauseUntil)&&now<i.softRisk.pauseUntil),i.softRisk?.historyVerified===true);
 const buyers=Array.isArray(r.creationBlockBuyers)?r.creationBlockBuyers:null,validBuyers=buyers?.every(b=>typeof b.wallet==='string'&&b.wallet.length>0&&finite(b.sol)&&b.sol>0),buyerCount=validBuyers?new Set(buyers.map(b=>b.wallet)).size:null;
 check('R7','creation_block_distinct_buyers',buyerCount,'<=3',buyerCount<=3,fresh&&(r.creationBlockComplete===true||buyerCount>3)&&finite(buyerCount));
 const volume=finite(i.volume_5m_sol)&&i.volume_5m_sol>0,activity=finite(i.buys_5m)&&finite(i.sells_5m)&&i.buys_5m>=0&&i.sells_5m>=0&&i.buys_5m+i.sells_5m>=p.preFilterMinTrades;
 check('R8','observed_market_activity',{volumeSol:i.volume_5m_sol,buys:i.buys_5m,sells:i.sells_5m},'positive volume; existing min trades',volume&&activity,finite(i.volume_5m_sol)&&finite(i.buys_5m)&&finite(i.sells_5m));
 const loss=finite(i.round_trip_quote_loss_pct)?i.round_trip_quote_loss_pct:(size>0&&i.quote_reserve_sol>0?100*(1-(i.quote_reserve_sol/(i.quote_reserve_sol+size))**2):Infinity),priority=finite(i.priority_fee_sol)?i.priority_fee_sol:.000025,friction=loss+(size>0?2*priority/size*100:Infinity);
 check('R9','execution_friction',finite(friction)?friction:null,'existing quote loss/impact limits',finite(friction)&&friction>=0&&friction<=p.maxRoundTripLossPct,finite(friction));
 const social=r.socials,socialVerified=fresh&&social?.verified===true,socialSafe=(finite(social?.ageHours)&&social.ageHours>=72)||(Number.isInteger(social?.followers)&&social.followers>=200),socialComplete=finite(social?.ageHours)&&social.ageHours>=0&&Number.isInteger(social?.followers)&&social.followers>=0;
 check('R10','social_age_followers',social?{ageHours:social.ageHours??null,followers:social.followers??null}:null,'skip if age<72h AND followers<200',socialSafe,socialVerified&&(socialSafe||socialComplete));
 check('R11','wallets_txt_matches',r.blockedWalletMatches,'no top10 match',Array.isArray(r.blockedWalletMatches)&&r.blockedWalletMatches.length===0,fresh&&r.walletsListAvailable===true&&r.top10WalletsVerified===true&&Array.isArray(r.blockedWalletMatches));
 const failures=Object.keys(rules).filter(k=>rules[k]==='fail'),unknown=Object.keys(rules).filter(k=>rules[k]==='unverified'),verdict=failures.length?'SKIP':unknown.length?'WATCH':'VALID_SETUP';
 const tokenChecks=['R2','R3','R12','R4','R7','R10','R11'],score=Math.round(tokenChecks.filter(k=>rules[k]==='pass').length/tokenChecks.length*100)/10;
 const result={policyVersion:PROJECT_RULES_VERSION,token:i.token,score,entry_tier:verdict==='VALID_SETUP'?'STANDARD':'SKIP',signal:{failed:failures,ratio:i.buys_5m/Math.max(1,i.sells_5m)},unknowns:missing,rule_check:rules,rule_details:detail,red_flags:failures.map(k=>detail[k].name),green_flags:tokenChecks.filter(k=>rules[k]==='pass').map(k=>detail[k].name),verdict,sizing_mode:size>0?'AUTO':'INFEASIBLE',requires_user_acknowledgment:false,R1_detail:{minimum_order_sol:p.minOrderSol,minimum_order_blocked:false,proposed_size_sol:size,proposed_position_size:size*(i.sol_price_usd??0),max_concurrent_positions:4,account_equity_sol:equity,risk_fraction:.015,assumed_loss_fraction:1,risk_budget_sol:riskBudget,fee_allowance_sol:fee,assumed_loss_sol:size+fee,standard_size:size*(i.sol_price_usd??0),available_capital:capital*(i.sol_price_usd??0),size_pct_of_equity:equity>0?(size/equity*100).toFixed(2)+'%':'0%'},friction_detail:{estimated_round_trip_friction_pct:finite(friction)?friction:null,friction_cap:p.maxRoundTripLossPct,quoteVerified:i.quote_status==='verified',math:'verified quote required before execution; full-principal loss plus fee allowance for sizing'},exit_plan:projectExitPolicy(),diagnostic:{failed:failures,missing,timezone:p.timezone,localHour:hour,source:'deterministic checks; score is verified coverage, not win probability'}};result.report=formatProjectReport(result);return result;
}
export function formatProjectReport(r){
 const summary=r.verdict==='VALID_SETUP'?'SETUP VALID':r.verdict;
 const flags=r.red_flags.slice(0,3).join(', ')||'none verified',green=r.green_flags.slice(0,3).join(', ')||'none verified';
 return [`SCORE: ${r.score}/10`,`RED FLAGS: ${flags}`,`GREEN FLAGS: ${green}`,`RULE CHECK: ${Object.entries(r.rule_check).map(([k,v])=>k+'='+v.toUpperCase()+'['+JSON.stringify(r.rule_details[k].value)+']').join('; ')}`,`WHAT I'M MISSING: ${r.unknowns.length?r.unknowns.join(', '):'none in required checks'}`,`VERDICT: ${summary}`].join('\n');
}
