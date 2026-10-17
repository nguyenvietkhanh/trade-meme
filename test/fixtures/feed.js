// Test-process only. Never loaded by npm start.
let clock=Date.now();Date.now=()=>clock;
const interval=globalThis.setInterval;globalThis.setInterval=(fn,ms,...args)=>interval(fn,Math.min(ms,500),...args);
const sol='So11111111111111111111111111111111111111112';
const pair=(mint,symbol,price)=>({chainId:'solana',baseToken:{address:mint,symbol,name:symbol},dexId:'pumpswap',info:{imageUrl:'https://example.invalid/test.png'},priceUsd:String(price),marketCap:1000000,liquidity:{usd:250000},volume:{h24:1000000,m5:10000,h1:30000},priceChange:{m5:3,h1:10,h6:20,h24:30},txns:{m5:{buys:40,sells:5}},pairAddress:'test-pair',pairCreatedAt:Date.now()-7200000});
globalThis.fetch=async url=>{if(String(url).endsWith(sol))clock+=30000;return new Response(JSON.stringify({pairs:String(url).endsWith(sol)?[pair(sol,'SOL',150)]:[pair('TestMintForIsolatedTestsOnly','TEST',.01)]}),{status:200,headers:{'Content-Type':'application/json'}});};
