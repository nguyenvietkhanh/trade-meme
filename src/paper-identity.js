// Each paper sleeve owns its lot, cooldown and quote mark. Sharing a mint is
// allowed; a quote/SELL for another sleeve must never mutate this lot.
export const paperLotKey=p=>p.agentId?`${p.agentId}:${p.mint}`:p.mint;
export const samePaperLot=(a,b)=>a.mint===b.mint&&(a.agentId??null)===(b.agentId??null);
export const paperMark=(state,p)=>state.marks?.[paperLotKey(p)];
