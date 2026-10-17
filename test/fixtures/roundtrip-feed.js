// Isolated end-to-end test market: first tick enters, second tick takes profit.
// No production command imports this file.
const sol='So11111111111111111111111111111111111111112';
let cycle=0;
const pair=(mint,symbol,price)=>({chainId:'solana',baseToken:{address:mint,symbol,name:symbol},priceUsd:String(price),liquidity:{usd:250000},volume:{h24:1000000},priceChange:{m5:2},txns:{m5:{buys:30,sells:10}},pairAddress:'test-pair',pairCreatedAt:Date.now()-86400000});
globalThis.fetch=async url=>{
 let data;
 if(String(url).endsWith('/token-profiles/latest/v1'))data=[];
 else if(String(url).endsWith(sol)){data={pairs:[pair(sol,'SOL',150)]};cycle++;}
 else data={pairs:[pair('TestMintForIsolatedTestsOnly','TEST',cycle===0?.01:.014)]};
 return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
const interval=globalThis.setInterval;
globalThis.setInterval=(callback,ms,...args)=>interval(callback,Math.min(ms,100),...args);
