// Isolated HTTP fixture; deliberately keep the real clock and real timer cadence.
const sol='So11111111111111111111111111111111111111112';
const pair=mint=>({chainId:'solana',dexId:'pumpswap',baseToken:{address:mint,symbol:mint===sol?'SOL':'TEST',name:'Test'},priceUsd:mint===sol?'150':'.01',marketCap:1000000,liquidity:{usd:250000},volume:{h24:1000000,m5:10000,h1:30000},priceChange:{m5:3,h1:10},txns:{m5:{buys:40,sells:20},h1:{buys:120,sells:60}},pairAddress:'test-pair',pairCreatedAt:Date.now()-7200000});
globalThis.fetch=async url=>{
 const u=String(url);
 const data=u.endsWith('/token-profiles/latest/v1')?[]:u.includes('geckoterminal.com')?{data:[]}:{pairs:[pair(u.endsWith(sol)?sol:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')]};
 return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
