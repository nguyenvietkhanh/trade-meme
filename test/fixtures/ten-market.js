export const TEN_AT=Date.parse('2026-10-25T05:00:10Z');
export function tenMarket(id='nova',now=TEN_AT){
 const start=Math.floor(now/60000)*60-35*60,bars=Array.from({length:35},(_,i)=>[start+i*60,100,101,99.5,100.5,100]);
 let price=100.5;
 if(id==='orin'){bars.splice(-1,1,[start+34*60,100,104,99.5,103,600]);price=103;}
 if(id==='vela'){Object.assign(bars.at(-1),[start+34*60,100,104,99.5,103,600]);price=103;}
 if(id==='kade'){bars.splice(-3,3,[start+32*60,100,101.1,99.5,101,100],[start+33*60,101,102.3,100.5,102.2,100],[start+34*60,102.2,103.7,101.8,103.6,100]);price=103.6;}
 if(id==='rune'){bars[10]=[start+10*60,100,101,98,100.5,100];bars[15]=[start+15*60,110,120,109,111,100];for(let i=20;i<35;i++)bars[i]=[start+i*60,105,107,104,106,100];bars[27][3]=102;price=106;}
 if(id==='nyx'){bars.splice(-2,2,[start+33*60,110,111,102,103,100],[start+34*60,103,109,102.5,108,100]);price=108;}
 const m={mint:'token-'+id,pairAddress:'pool-'+id,symbol:id.toUpperCase(),dexId:'pumpswap',priceUsd:price,updatedAt:now,liquidityUsd:100000,valuationUsd:100000,change5mPct:10,change1hPct:20,volume5mUsd:5000,volume1hUsd:15000,buys5m:30,sells5m:10,pairCreatedAt:now-600000,strategyData:{mint:'token-'+id,pairAddress:'pool-'+id,bars}};
 m.strategyData.flow={mint:m.mint,pairAddress:m.pairAddress,checkedAt:now,lastTenComplete:true,lastTen:Array.from({length:10},(_,i)=>({id:'trade-'+i,at:now-i*1000,side:i<6?'BUY':'SELL'})),windowComplete:true,walletsComplete:true,uniqueBuyers:12,uniqueSellers:5,largestBuySharePct:10,smallBuyFraction:.8};
 m.evidence={mint:m.mint,pairAddress:m.pairAddress,certificationMode:'bypassed-paper',roundTripQuoteOk:true,quoteCheckedAt:now,checkedAt:now,probeSol:.5,decimals:6,roundTripLossPct:1};
 return m;
}
export function tenContext(m,now=TEN_AT){return {liquidityCutoff:90000,prior:{at:now-6000,sourceAt:now-6000,priceUsd:m.priceUsd*.999,liquidityUsd:m.liquidityUsd}};}
