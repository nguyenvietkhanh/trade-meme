import {jitterDelay} from './scalp-queue.js';
// PAPER-only entry locks and quote retry state. No wallet or transaction capability.
export function recordMintOutcome(state,t,c){
 if(t.side!=='SELL'||!t.closed||!Number.isFinite(t.positionPnlSol)||!t.mint||!Number.isFinite(t.at))return;
 const risks=state.scalp.mintRisk??={},old=risks[t.mint];
 if(old&&t.at<=old.lastClosedAt)return; // Replay/restart must not count a close twice.
 if(!old&&Object.keys(risks).length>=c.cacheLimit){
  const stale=Object.entries(risks).filter(([,r])=>r.blockedUntil<=t.at&&t.at-r.lastClosedAt>=c.mintLossCooldownMs).sort((a,b)=>a[1].lastClosedAt-b[1].lastClosedAt)[0];
  if(stale)delete risks[stale[0]];else{state.scalp.riskRegistryFull=true;return;}
 }
 const expired=old?.blockedUntil>0&&t.at>=old.blockedUntil;
 let lossStreak=expired?0:old?.lossStreak??0,blockedUntil=expired?0:old?.blockedUntil??0;
 if(t.positionPnlSol<0){lossStreak++;if(lossStreak>=c.mintLossLimit)blockedUntil=t.at+c.mintLossCooldownMs;}
 else if(t.positionPnlSol>0){lossStreak=0;blockedUntil=0;}
 risks[t.mint]={lossStreak,blockedUntil,lastClosedAt:t.at,lastPositionId:t.positionId,lastClosedPnlSol:t.positionPnlSol};
}
export function mintIsLocked(state,mint,c,now){
 const r=state.scalp?.mintRisk?.[mint];if(!r)return false;
 if(r.blockedUntil>now)return true;
 if((r.lossStreak??0)<c.mintLossLimit)return false;
 if(r.blockedUntil>0&&Number.isFinite(r.lastClosedAt)&&r.blockedUntil>=r.lastClosedAt){r.lossStreak=0;r.blockedUntil=0;r.lastLockReleasedAt=now;return false;}
 // Repair corrupted/missing deadlines (including a stale lossStreak=18).
 r.blockedUntil=now+c.mintLossCooldownMs;r.lockRepairedAt=now;return true;
}
export function entryGuard(m,state,c,now,signalId){
 const locked=mintIsLocked(state,m.mint,c,now),risk=state.scalp?.mintRisk?.[m.mint],lock=state.scalp?.consumed?.[m.mint];
 const metrics={mint:m.mint,blockedUntil:risk?.blockedUntil??0,lossStreak:risk?.lossStreak??0,quoteBlockedUntil:state.scalp?.quoteBlockedUntil??0};
 const fail=reason_code=>({stage_reached:'E',reason_code,pass:false,metrics});
 if(metrics.quoteBlockedUntil>now)return fail('E_QUOTE_BACKOFF');
 if(state.pending?.side==='SELL'||state.positions.some(p=>p.memory?.sellRetry||p.memory?.stopTriggered||p.memory?.trailingTriggered||p.memory?.timeStopTriggered||p.exitPolicy?.maxHoldMs&&now-p.openedAt>=p.exitPolicy.maxHoldMs))return fail('E_EXIT_PRIORITY');
 if(locked)return fail('E_MINT_LOSS_LOCK');
 if(!risk&&Object.keys(state.scalp?.mintRisk??{}).length>=c.cacheLimit)return fail('E_RISK_REGISTRY_FULL');
 if(state.positions.some(p=>p.mint===m.mint))return fail('E_HELD');
 if(lock?.signalId===signalId)return fail('E_CONSUMED');
 if(lock&&now-lock.at<c.reentryMs)return fail('E_REENTRY');
 return {stage_reached:'E',reason_code:'E_PASS',pass:true,metrics};
}
export function quoteFailure(state,o,error,code,c,now,random=Math.random){
 const rateLimited=code==='HTTP_429'||code==='BACKOFF';
 const p=o.side==='SELL'?state.positions.find(p=>p.id===o.positionId):null,previous=p?.memory?.sellRetry;
 const attempts=(previous?.attempts??0)+1;
 const base=rateLimited?c.quoteRateBackoffMs:c.sellRetryBaseMs;
 const advertised=Math.max(Number(error?.retryMs??error?.retryAfterMs)||0,Number.isFinite(error?.retryAt)?error.retryAt-now:0);
 const delay=Math.max(jitterDelay(Math.min(c.sellRetryMaxMs,base*2**Math.min(attempts-1,10)),random,c.retryJitterPct),Number.isFinite(advertised)?Math.min(600000,Math.max(0,advertised)):0);
 if(rateLimited)state.scalp.quoteBlockedUntil=Math.max(state.scalp.quoteBlockedUntil??0,now+delay);
 if(p){
  p.memory??={};p.memory.sellRetry={attempts,nextAt:now+delay,firstTriggeredAt:previous?.firstTriggeredAt??o.decidedAt,lastCode:code,lastFailedAt:now};
  o.nextAttemptAt=p.memory.sellRetry.nextAt;
 }else if(rateLimited)o.nextAttemptAt=state.scalp.quoteBlockedUntil;
 state.scalp.lastQuoteFailure={at:now,side:o.side,code,nextAt:Math.max(o.nextAttemptAt??0,state.scalp.quoteBlockedUntil??0)};
 return p?.memory?.sellRetry??null;
}
