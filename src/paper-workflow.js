import {createHash} from 'node:crypto';

export const PAPER_WORKFLOW_VERSION='paper-scan-verify-execute-exit-v1';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))??'null').digest('hex');
const gap=()=>Object.assign(Error('Paper order is missing a bound SCAN / VERIFY / EXECUTE / EXIT plan.'),{code:'WORKFLOW_GAP'});
const binding=o=>({id:o.id,agentId:o.agentId,agentPolicyVersion:o.agentPolicyVersion,mint:o.mint,pairAddress:o.pairAddress,amount:o.amount,entryPolicy:o.entryPolicy,riskPolicy:o.riskPolicy,exitPolicy:o.exitPolicy,benchmark:o.benchmark});
export function paperEntrySnapshotKey(agentId,m,amount){
 const e=m.evidence??{};
 return digest({agentId,mint:m.mint,pairAddress:m.pairAddress,marketObservedAt:m.updatedAt,priceUsd:m.priceUsd,liquidityUsd:m.liquidityUsd,volume5mUsd:m.volume5mUsd,buys5m:m.buys5m,sells5m:m.sells5m,change5mPct:m.change5mPct,change1hPct:m.change1hPct,amount,factsAt:e.checkedAt,quoteAt:e.quoteCheckedAt,probeSol:e.probeSol,roundTripLossPct:e.roundTripLossPct});
}
export function paperEntryWorkflow(order,m,rank,now){
 const p=order.exitPolicy,e=m.evidence,q=order.benchmark;
 if(rank?.eligible!==true||rank.agentId!==order.agentId||!order.agentId||order.mint!==m.mint||order.pairAddress!==m.pairAddress||order.decisionAt!==now||!order.entryPolicy?.version||!order.riskPolicy?.version||e?.mint!==m.mint||e?.pairAddress!==m.pairAddress||q?.mint!==m.mint||q.side!=='BUY'||q.inAmount!==order.amount||!Number.isFinite(q.checkedAt)||q.checkedAt>now||!Number.isFinite(m.updatedAt)||m.updatedAt>now||!Number.isFinite(e.checkedAt)||e.checkedAt>now||!Number.isFinite(e.quoteCheckedAt)||e.quoteCheckedAt>now||!Number.isFinite(p?.stopLossPct)||p.stopLossPct<=0||p.stopLossPct>=100||!Number.isFinite(p.firstProfitPct)||p.firstProfitPct<=0||!Number.isFinite(p.finalProfitPct)||p.finalProfitPct<=p.firstProfitPct||!Number.isFinite(p.firstSellFraction)||p.firstSellFraction<=0||p.firstSellFraction>1||!Number.isFinite(p.trailingPct)||p.trailingPct<=0||p.trailingPct>=100||!Number.isFinite(p.maxHoldMs)||p.maxHoldMs<=0)throw gap();
 return {version:PAPER_WORKFLOW_VERSION,status:'reserved',snapshotKey:paperEntrySnapshotKey(order.agentId,m,order.amount),binding:digest(binding(order)),scan:{at:now,marketObservedAt:m.updatedAt,agentId:order.agentId,mint:m.mint,pairAddress:m.pairAddress},verify:{at:now,result:'pass',certificationsRequired:order.entryPolicy.certificationsRequired!==false,certificationMode:order.entryPolicy.certificationsRequired===false?'bypassed-paper':'strict',policyVersion:order.entryPolicy.version,factsObservedAt:e.checkedAt,roundTripObservedAt:e.quoteCheckedAt,score:rank.score},execute:{intentId:order.id,reservedAt:now,amount:order.amount},exit:{declaredAt:now,policy:structuredClone(p)}};
}
export function assertPaperEntryWorkflow(order){
 const w=order.workflow;
 if(w?.version!==PAPER_WORKFLOW_VERSION||w.status!=='reserved'||w.binding!==digest(binding(order))||w.scan?.agentId!==order.agentId||w.scan.mint!==order.mint||w.scan.pairAddress!==order.pairAddress||w.verify?.result!=='pass'||w.execute?.intentId!==order.id||w.execute.amount!==order.amount||w.execute.reservedAt!==order.decisionAt||digest(w.exit?.policy)!==digest(order.exitPolicy))throw gap();
 return w;
}
export function paperEntryFilled(order,quote,filledOutput,at){
 const w=assertPaperEntryWorkflow(order);
 if(quote?.mint!==order.mint||quote.side!=='BUY'||quote.inAmount!==order.amount||!Number.isFinite(quote.checkedAt)||quote.checkedAt<order.readyAt||quote.checkedAt>at)throw gap();
 return {...structuredClone(w),status:'entry-complete',execute:{...w.execute,fillAt:at,quoteObservedAt:quote.checkedAt,contextSlot:quote.contextSlot,filledOutput}};
}
export function paperExitWorkflow(position,order,quote,filledOutput,at){
 return {...(position.workflow??{version:null,status:'legacy-entry'}),exitExecution:{intentId:order.id,positionId:position.paperPositionId,agentId:position.agentId??null,reason:order.reason,triggerAt:order.decisionAt,fillAt:at,quoteObservedAt:quote.checkedAt,contextSlot:quote.contextSlot,rawAmount:order.amount,filledOutput}};
}
export function workflowDecisionStage(stage){return ['discovery','market','score'].includes(stage)?'SCAN':stage==='portfolio'?'EXECUTE':'VERIFY';}

export function paperProfitConcentration(fills){
 const sells=fills.filter(f=>f.side==='SELL'),known=sells.filter(f=>Number.isFinite(f.pnlSol)),positive=known.filter(f=>f.pnlSol>0),top=[...positive].sort((a,b)=>b.pnlSol-a.pnlSol).slice(0,5),net=known.reduce((sum,f)=>sum+f.pnlSol,0),gross=positive.reduce((sum,f)=>sum+f.pnlSol,0),topPnl=top.reduce((sum,f)=>sum+f.pnlSol,0),complete=known.length===sells.length;
 return {sellFills:sells.length,missingPnl:sells.length-known.length,grossProfitSol:complete?gross:null,knownGrossProfitSol:gross,netRealizedPnlSol:complete?net:null,topFivePositiveSellFills:top.map(f=>({id:f.id??null,positionId:f.positionId??null,agentId:f.agentId??null,symbol:f.symbol??null,at:f.at??null,pnlSol:f.pnlSol,closed:f.closed===true})),topFivePnlSol:topPnl,topFiveShareOfGrossProfitPct:complete&&gross>0?topPnl/gross*100:null,topFiveShareOfNetProfitPct:complete&&net>0?topPnl/net*100:null,pnlWithoutTopFiveSellFillsSol:complete?net-topPnl:null,note:'SELL fills, including partial exits; not five independent closed positions. Gross-profit share is bounded by 100%; net-profit share can exceed 100% when other fills lose. This arithmetic omission is not an executable alternative backtest.'};
}
