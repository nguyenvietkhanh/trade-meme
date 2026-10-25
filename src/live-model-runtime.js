import {ModelBotRuntime} from './paper-model-runtime.js';
import {randomUUID} from 'node:crypto';
export class LiveModelBotRuntime extends ModelBotRuntime{
 constructor(config,state,options){super(config,state,{...options,ai:{...options.ai,enabled:true,explicitRulesMode:false}});if(state.mode!=='live')throw Error('LIVE_STATE_REQUIRED');}
 id(kind){this.state.sequence++;return 'live:'+this.state.id+':'+kind+':'+randomUUID();}
 async tick(snapshot,now=snapshot.timestamp){if(this.state.livePending&&this.state.pending?.id!==this.state.livePending.id)this.state.pending={...this.state.livePending,wasSubmitted:true};return super.tick(snapshot,now);}
 mark(){} // Financial state comes from confirmed receipts and the parent's treasury.
 monitor(snapshot,now){
  const s=this.state;if(s.livePending||s.pending)return;
  const peaks=s.liveLiquidityPeaks??={};for(const id of Object.keys(peaks))if(!s.positions.some(p=>p.paperPositionId===id))delete peaks[id];
  for(const p of s.positions){const m=snapshot.markets.find(m=>m.mint===p.mint&&m.pairAddress===p.pairAddress),at=m?.priceAt??m?.updatedAt,price=m?.spotPriceSol??m?.priceUsd/snapshot.solUsd;
   if(Number.isFinite(at)&&at<=now&&now-at<=1500&&Number.isFinite(m?.liquidityUsd)){p.peakLiquidityUsd=peaks[p.paperPositionId]??m.liquidityUsd;peaks[p.paperPositionId]=Math.max(p.peakLiquidityUsd,m.liquidityUsd);}
   const fresh=Number.isFinite(at)&&now>=at&&now-at<=1500&&price>0,observed={...m,updatedAt:at,exitQuote:fresh?{mint:p.mint,rawAmount:p.rawQuantity,checkedAt:at,netSol:p.quantity*price,provider:'spot-trigger-estimate'}:null},plan=this.exitPlan(p,observed,now);
   if(plan&&this.allowExit(plan,p)){s.pending={id:this.id('protective-sell'),side:'SELL',mint:p.mint,pairAddress:p.pairAddress,symbol:p.symbol,positionId:p.paperPositionId,amount:p.rawQuantity,decisionAt:now,readyAt:now+2000,reason:plan.reason,decisionEngine:'model-safety'};break;}
  }
 }
 async fill(snapshot,now){
  const s=this.state,o=s.pending;if(!o||now<o.readyAt)return;const m=snapshot.markets.find(m=>m.mint===o.mint&&m.pairAddress===o.pairAddress)??(s.livePending||o.wasSubmitted?{mint:o.mint,pairAddress:o.pairAddress}:null);if(!m)return;
  if(!s.livePending&&!o.wasSubmitted&&o.side==='BUY'&&(!s.running||now-o.decisionAt>30000)){s.pending=null;this.recordAI(snapshot,now,'WAIT','LIVE_BUY_INTENT_EXPIRED',{mint:o.mint});return;}
  try{const result=await this.execute({...o,referencePriceSol:o.referencePriceSol??null},m);if(result.view&&result.view.id===s.id)Object.assign(s,result.view);if(result.terminal){s.pending=null;this.recordAI(snapshot,now,result.status==='confirmed'?o.side:'WAIT','LIVE_'+result.status.toUpperCase(),{mint:o.mint,signature:result.signature??null});}else{o.readyAt=now+2000;o.wasSubmitted=true;}}
  catch(e){o.readyAt=now+2000;this.error(e,now);if(o.side==='BUY'&&['LIVE_CAPITAL_CHANGED','LIVE_BUY_NOT_ADMITTED','LIVE_INTENT_EXPIRED','LIVE_SIGNER_LOCKED','LIVE_ROUNDTRIP_COST_LIMIT','LIVE_EXTERNAL_TOKEN_HOLDINGS','LIVE_PREPARE_FAILED'].includes(e.code))s.pending=null;}
 }
}
