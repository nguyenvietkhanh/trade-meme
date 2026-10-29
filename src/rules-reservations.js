// Non-financial quote holds. Durable orders remain the source of truth once accepted.
export class RulesReservations {
 constructor({clock=Date.now,ttlMs=120000,max=32}={}){this.clock=clock;this.ttlMs=ttlMs;this.max=max;this.rows=new Map();}
 prune(){for(const [id,r]of this.rows)if(r.expiresAt<=this.clock())this.rows.delete(id);}
 totals(exclude=null){this.prune();const rows=[...this.rows].filter(([id])=>id!==exclude).map(([,r])=>r);return {amountSol:rows.reduce((n,r)=>n+r.amountSol,0),cashSol:rows.reduce((n,r)=>n+r.amountSol+r.bufferSol,0),slots:rows.length,mints:rows.map(r=>r.mint),groupAmount:group=>rows.filter(r=>(r.group??'SCALP')===group).reduce((n,r)=>n+r.amountSol,0),groupSlots:group=>rows.filter(r=>(r.group??'SCALP')===group).length};}
 reserve(id,{mint,group='SCALP',tier=null,amountSol,bufferSol=0,availableSol,exposureSol,equitySol,maxPositions,positionsCount,exposureFraction}){
  this.prune();const t=this.totals(),own=[...this.rows.values()].filter(r=>(r.group??'SCALP')===group),groupAmount=own.reduce((n,r)=>n+r.amountSol,0);if(this.rows.has(id)||this.rows.size>=this.max||t.mints.includes(mint)||![amountSol,bufferSol,availableSol,exposureSol,equitySol,positionsCount,maxPositions,exposureFraction].every(Number.isFinite)||amountSol<=0||amountSol+bufferSol+t.cashSol>availableSol+1e-10||amountSol+exposureSol+groupAmount>equitySol*exposureFraction+1e-10||positionsCount+own.length>=maxPositions)return false;
  this.rows.set(id,{mint,group,tier,amountSol,bufferSol,expiresAt:this.clock()+this.ttlMs});return true;
 }
 resize(id,amountSol){const r=this.rows.get(id);if(!r||!Number.isFinite(amountSol)||amountSol<=0||amountSol>r.amountSol+1e-10)return false;r.amountSol=amountSol;return true;}
 release(id){this.rows.delete(id);}
}
