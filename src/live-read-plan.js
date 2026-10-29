// Prices for owned positions retain the fast exit lane; discovery consumes a bounded background budget.
export class LiveReadPlan{
 constructor({intervalMs=10000,maxWatch=12}={}){this.intervalMs=intervalMs;this.maxWatch=maxWatch;this.nextAt=0;this.cursor=0;}
 plan(snapshot,positions,now=Date.now()){
  const key=m=>m.mint+':'+m.pairAddress;
  const held=[...new Map(positions.map(p=>{const m=snapshot.markets.find(m=>m.mint===p.mint&&m.pairAddress===p.pairAddress)??{...p,dexId:p.executionVenue==='pumpfun'?'pumpfun':'pumpswap'};return [key(m),m];})).values()];
  if(now<this.nextAt)return {held,watch:[]};this.nextAt=now+this.intervalMs;
  const heldKeys=new Set(held.map(key)),rows=snapshot.markets.filter(m=>!heldKeys.has(key(m))&&m.change5mPct>0&&m.change5mPct<=100);
  const offset=rows.length?this.cursor%rows.length:0,watch=[...rows.slice(offset),...rows.slice(0,offset)].slice(0,this.maxWatch);this.cursor+=watch.length;
  return {held,watch};
 }
}
