export function independenceMetrics(fills,ids,from,to){
 const buys=id=>fills.filter(f=>f.agentId===id&&f.side==='BUY'&&f.at>=from&&f.at<to),pairs=[];
 const corr=(a,b)=>{if(a.length<8)return null;const mean=x=>x.reduce((n,v)=>n+v,0)/x.length,ma=mean(a),mb=mean(b),va=a.reduce((n,x)=>n+(x-ma)**2,0),vb=b.reduce((n,x)=>n+(x-mb)**2,0);return va>0&&vb>0?a.reduce((n,x,i)=>n+(x-ma)*(b[i]-mb),0)/Math.sqrt(va*vb):null;};
 for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
  const a=ids[i],b=ids[j],aa=buys(a),bb=buys(b),sa=new Set(aa.map(f=>f.mint)),sb=new Set(bb.map(f=>f.mint)),intersection=[...sa].filter(t=>sb.has(t)),union=new Set([...sa,...sb]),jaccard=sa.size&&sb.size?intersection.length/union.size:null;
  const offsets=intersection.map(mint=>{const timesA=aa.filter(f=>f.mint===mint).map(f=>f.at),timesB=bb.filter(f=>f.mint===mint).map(f=>f.at);return Math.min(...timesA.flatMap(at=>timesB.map(bt=>Math.abs(at-bt))));}).sort((a,b)=>a-b);
  const hours=Math.floor((to-from)/3600000),series=id=>Array.from({length:hours},(_,h)=>fills.filter(f=>f.agentId===id&&f.side==='SELL'&&f.at>=from+h*3600000&&f.at<from+(h+1)*3600000&&Number.isFinite(f.pnlSol)).reduce((n,f)=>n+f.pnlSol,0)),correlation=corr(series(a),series(b));
  pairs.push({a,b,buysA:aa.length,buysB:bb.length,uniqueTokensA:sa.size,uniqueTokensB:sb.size,jaccard,sharedTokens:intersection,medianEntryOffsetMs:offsets.length?offsets[Math.floor(offsets.length/2)]:null,hourlyPnlCorrelation:correlation,hourBins:hours,warning:jaccard>.5||correlation>.7,insufficientSample:aa.length<20||bb.length<20});
 }
 return pairs;
}
