import {TRADE_RULES} from './desk-rules.js';
import {decideMarket} from './strategy.js';
import {exitPlan} from './engine.js';
/** JSON contract for analysis only. Neither this function nor a prompt can submit transactions. */
export function analyzeDecision({market={},position=null,solUsd=market.solUsd,settings=TRADE_RULES,now=Date.now()}={}){
 const skip=reason=>({action:'SKIP',token:market.mint??'',sell_percent:0,score:0,reasons:[reason],red_flags:['MISSING_OR_CONFLICTING_DATA']});
 if(!position)return decideMarket(market,settings,now);
 if(position.mint!==market.mint||![position.quantity,position.initialQuantity,position.costSol,position.initialCostSol,position.costUsd,position.initialCostUsd,position.entryPriceUsd,solUsd,market.priceUsd].every(x=>Number.isFinite(x)&&x>0)||!['initial','runner'].includes(position.phase)||!Number.isFinite(position.openedAt)||position.openedAt>now||!Number.isFinite(market.updatedAt)||market.updatedAt>now||now-market.updatedAt>settings.maxPriceAgeMs)return skip('Thiếu hoặc mâu thuẫn dữ liệu vị thế/giá');
 const plan=exitPlan({...position},market,solUsd,settings,now);
 return {action:plan?'SELL':'HOLD',token:market.mint,sell_percent:plan?Math.round(plan.fraction*1000000)/10000:0,score:0,reasons:[plan?.reason??'Chưa đạt điều kiện thoát'],red_flags:plan?.reason.startsWith('emergency-')?['EMERGENCY_EXIT']:[]};
}
