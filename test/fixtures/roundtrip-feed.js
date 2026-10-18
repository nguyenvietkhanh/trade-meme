// Isolated end-to-end test market: first tick enters, second tick takes profit.
// No production command imports this file.
let clock=Date.now();Date.now=()=>clock;
const sol='So11111111111111111111111111111111111111112';
let cycle=0;
const pair=(mint,symbol,price)=>({chainId:'solana',baseToken:{address:mint,symbol,name:symbol},dexId:'pumpswap',info:{imageUrl:'https://example.invalid/test.png'},priceUsd:String(price),marketCap:1000000,liquidity:{usd:250000},volume:{h24:1000000,m5:10000,h1:30000},priceChange:{m5:3,h1:10,h6:20,h24:30},txns:{m5:{buys:40,sells:5}},pairAddress:'test-pair',pairCreatedAt:Date.now()-86400000});
globalThis.fetch=async url=>{
 let data;
 if(String(url).endsWith('/token-profiles/latest/v1'))data=[];
 else if(String(url).endsWith(sol)){data={pairs:[pair(sol,'SOL',150)]};cycle++;clock+=30000;}
 else data={pairs:[pair('11111111111111111111111111111112','TEST',cycle<2?.01:.02)]};
 return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
const interval=globalThis.setInterval;
globalThis.setInterval=(callback,ms,...args)=>interval(callback,Math.min(ms,100),...args);
