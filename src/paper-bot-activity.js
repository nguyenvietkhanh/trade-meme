export function botActivity(agent,now=Date.now()){
 const alive=Number.isFinite(agent.heartbeatAt)&&agent.heartbeatAt<=now&&now-agent.heartbeatAt<60000;
 const signal=agent.signal,scanFresh=Number.isFinite(signal?.at)&&signal.at<=now&&now-signal.at<=Math.max(30000,(agent.scanIntervalMs??10000)*3);
 const decisions=signal?.decisions??[],counts={};for(const d of decisions)if(!d.eligible)counts[d.reason]=(counts[d.reason]??0)+1;
 const blockers=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([reason,count])=>({reason,count}));
 const hasFills=(agent.stats?.closed??0)>0||(agent.openPositions??0)>0||!!agent.stats?.lastFill;
 return {alive,scanFresh,cycle:signal?.cycle??0,evaluated:signal?.evaluated??0,eligible:signal?.eligible??0,hasFills,blockers,status:!alive?'NO_HEARTBEAT':!scanFresh?'NO_RECENT_SCAN':agent.phase==='paused'?'PAUSED':agent.openPositions?'MONITORING':agent.pending?.length?'EXECUTING':'SCANNING'};
}
