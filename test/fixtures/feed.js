// Test-process only. Never loaded by npm start.
const sol='So11111111111111111111111111111111111111112';
const pair=(mint,symbol,price)=>({chainId:'solana',baseToken:{address:mint,symbol,name:symbol},priceUsd:String(price),liquidity:{usd:250000},volume:{h24:1000000},priceChange:{m5:2},txns:{m5:{buys:30,sells:10}},pairAddress:'test-pair',pairCreatedAt:Date.now()-86400000});
globalThis.fetch=async url=>new Response(JSON.stringify({pairs:String(url).endsWith(sol)?[pair(sol,'SOL',150)]:[pair('TestMintForIsolatedTestsOnly','TEST',.01)]}),{status:200,headers:{'Content-Type':'application/json'}});
