import {PAPER_MODEL} from './paper-desk.js';
import {paperOrderSol,paperCapitalSol} from './paper-sizing.js';
import {paperLotKey} from './paper-identity.js';
import {scalpExitPlan,isScalpVersion} from './paper-scalp.js';
import {exitPlan} from './engine.js';

export const LAB_EXECUTION_VERSION='paper-independent-lanes-v2';
const laneKey=o=>o.agentId??'legacy:'+(o.paperPositionId??o.positionId);
const fresh=(at,now)=>Number.isFinite(at)&&at<=now&&now-at<=30000;
const quoteKey=(mint,side,amount,reason='')=>[mint,side,amount,reason].join(':');
// Network I/O never holds the shared ledger lock. Each bot has one independent
// in-flight job; only cash reservations and ledger commits are serialized.
function launch(desk,key,work){
 const task=Promise.resolve().then(work).catch(error=>desk.serial(async()=>{
  desk.error(error,desk.clock(),{agentId:key});await desk.save();
 })).finally(()=>{if(desk.executionJobs.get(key)===task)desk.executionJobs.delete(key);});
 desk.executionJobs.set(key,task);
}
async function capture(desk,quotes,mint,side,amount,reason='',minObservedAt=0){
 const key=quoteKey(mint,side,amount,reason);
 try{const q=await desk.readQuote(mint,side,amount,reason,minObservedAt);quotes.set(key,{q});return q;}
 catch(error){quotes.set(key,{error});return null;}
}
function reader(desk,quotes){return async(mint,side,amount,reason='',minObservedAt=0)=>{
 const item=quotes.get(quoteKey(mint,side,amount,reason));
 if(!item)throw Error('Quote request changed; retry this bot with a fresh exact-size quote.');
 if(item.error)throw item.error;
 desk.quoteValid(item.q,mint,side,amount,desk.clock());
 if(item.q.checkedAt<minObservedAt)throw Object.assign(Error('Quote predates paper delay.'),{code:'QUOTE_BEFORE_DELAY'});
 return item.q;
};}
function focusOrder(desk,order){
 const s=desk.state,previous=s.pending;
 s.pendingEntries=s.pendingEntries.filter(o=>o.id!==order.id);
 s.pendingExits=s.pendingExits.filter(o=>o.id!==order.id);
 if(previous&&previous.id!==order.id)(previous.side==='SELL'?s.pendingExits:s.pendingEntries).push(previous);
 s.pending=order;
}
async function fill(desk,order){
 const quotes=new Map();await capture(desk,quotes,order.mint,order.side,order.amount,order.reason,order.readyAt);
 await desk.serial(async()=>{
  const current=desk.pendingOrders().find(o=>o.id===order.id);
  if(!current||current.readyAt>desk.clock())return;
  focusOrder(desk,current);
  await desk.fillPending(desk.executionFeed,{quoteReader:reader(desk,quotes)});
  desk.markEquity();await desk.save();
 });
}
async function enter(desk,candidate,allocation){
 const {m,agent}=candidate,amount=String(Math.round(allocation.orderSol*1e9)),quotes=new Map();
 await capture(desk,quotes,m.mint,'BUY',amount);
 await desk.serial(async()=>{
  const feed=desk.executionFeed,now=desk.clock(),latest=feed.markets.find(x=>x.mint===m.mint&&x.pairAddress===m.pairAddress);
  if(!desk.state.running||feed.error||!fresh(feed.updatedAt,now)||!(feed.solUsd>0)||!latest)return;
  const signal=desk.entrySignal(agent.id,latest,now);
  if(!signal.eligible)return;
  await desk.prepareEntries(feed,{candidates:[{...candidate,m:latest,r:signal.rank}],quoteReader:reader(desk,quotes),maxAttempts:1,allocation});
  desk.markEquity();await desk.save();
 });
}
async function monitor(desk,position){
 const quotes=new Map(),q=await capture(desk,quotes,position.mint,'SELL',position.rawQuantity);
 // A partial exit needs its OWN quote; scaling a full-size quote would invent
 // a fill on a nonlinear AMM. Plan on a copy, then recheck under the ledger lock.
 if(q){
  const feed=desk.executionFeed,now=desk.clock(),m=feed.markets.find(m=>m.mint===position.mint&&m.pairAddress===position.pairAddress),p=structuredClone(position),netSol=Math.max(0,Number(q.minOut)/1e9-PAPER_MODEL.feeSol),mark={...m,mint:p.mint,pairAddress:p.pairAddress,exitQuote:{mint:p.mint,rawAmount:p.rawQuantity,checkedAt:q.checkedAt,netSol}};
  const plan=isScalpVersion(p.exitPolicy?.version)?scalpExitPlan(p,mark,now):m&&fresh(m.updatedAt,now)&&feed.solUsd>0?exitPlan(p,{...mark,priceUsd:netSol*feed.solUsd/p.quantity},feed.solUsd,desk.state.settings,now):null;
  if(plan&&plan.fraction<1){const amount=BigInt(p.rawQuantity)*BigInt(Math.round(plan.fraction*1e6))/1000000n;if(amount>0n&&BigInt(p.rawQuantity)-amount>1n)await capture(desk,quotes,p.mint,'SELL',amount.toString(),plan.reason);}
 }
 await desk.serial(async()=>{
  const held=desk.state.positions.find(p=>p.paperPositionId===position.paperPositionId);
  if(!held||held.rawQuantity!==position.rawQuantity)return;
  await desk.monitorPosition(desk.executionFeed,{positionId:held.paperPositionId,quoteReader:reader(desk,quotes)});
  desk.markEquity();await desk.save();
 });
}
export async function stepIndependent(desk,feed,{exitsOnly=false}={}){
 desk.executionFeed=feed;desk.executionJobs??=new Map();
 await desk.serial(async()=>{
  const s=desk.state,now=desk.clock(),orders=desk.pendingOrders(),candidates=exitsOnly?[]:desk.entryCandidates(feed.markets,now),ids=[...desk.agents.map(a=>a.id),...s.positions.filter(p=>!p.agentId).map(laneKey)];
  s.executionPolicy={version:LAB_EXECUTION_VERSION,independentWorkers:true,workers:desk.agents.length,sharedCapitalSol:20};
  for(const id of ids){
   if(desk.executionJobs.has(id))continue;
   const ownOrders=orders.filter(o=>laneKey(o)===id),due=ownOrders.filter(o=>o.readyAt<=now&&(!exitsOnly||o.side==='SELL')).sort((a,b)=>Number(b.side==='SELL')-Number(a.side==='SELL')||a.decisionAt-b.decisionAt)[0];
   if(due){launch(desk,id,()=>fill(desk,structuredClone(due)));continue;}
   if(exitsOnly)continue;
   const p=s.positions.find(p=>laneKey(p)===id);
   if(p){if(!ownOrders.some(o=>o.side==='SELL'))launch(desk,id,()=>monitor(desk,structuredClone(p)));continue;}
   if(ownOrders.length||!s.running||feed.error||!fresh(feed.updatedAt,now)||!(feed.solUsd>0))continue;
   const candidate=candidates.find(c=>c.agent.id===id),allocation={orderSol:paperOrderSol(s),capitalSol:paperCapitalSol(s)};
   if(!candidate||!desk.admission({now}).allowed||!desk.probeAllowed(candidate.m,allocation.orderSol))continue;
   s.agentExecutionStatus??={};s.agentExecutionStatus[id]={at:now,code:'OWN_QUOTE_REQUESTED',message:'Bot tự lấy quote BUY; không chờ bot khác mua/bán.'};
   launch(desk,id,()=>enter(desk,candidate,allocation));
  }
  desk.markEquity();await desk.save();
 });
}
