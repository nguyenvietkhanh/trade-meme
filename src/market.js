import {SOL} from './engine.js';
export async function fetchJson(url,options={}) {
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(12000)});
  if(!response.ok) throw Error(`Dịch vụ bên ngoài trả HTTP ${response.status}`);
  return response.json();
}
export async function loadMarkets(extraMints=[]) {
  const discoveries=await Promise.allSettled(['BONK','WIF','POPCAT','solana'].map(q=>fetchJson('https://api.dexscreener.com/latest/dex/search?q='+q)));
  const good=discoveries.filter(r=>r.status==='fulfilled');
  if(!good.length)throw Error('Không truy cập được DexScreener. Kiểm tra mạng, proxy và allowlist api.dexscreener.com.');
  let pairs=good.flatMap(r=>r.value.pairs??[]);
  if(extraMints.length) {
    const extra=await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${extraMints.join(',')}`);
    pairs.push(...(extra.pairs??[]));
  }
  const solData=await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${SOL}`);
  const solPair=(solData.pairs??[]).filter(p=>p.chainId==='solana'&&p.baseToken.address===SOL&&Number(p.priceUsd)>0).sort((a,b)=>(b.liquidity?.usd??0)-(a.liquidity?.usd??0))[0];
  const solUsd=Number(solPair?.priceUsd);if(!Number.isFinite(solUsd)||solUsd<=0) throw Error('Không lấy được giá SOL/USD.');
  const seen=new Map();
  for(const p of pairs) {
    if(p.chainId!=='solana'||p.baseToken.address===SOL||['SOL','SOLANA','WSOL','USDC','USDT'].includes(String(p.baseToken.symbol).trim().toUpperCase())||!Number.isFinite(Number(p.priceUsd))||Number(p.priceUsd)<=0) continue;
    const m={mint:p.baseToken.address,symbol:p.baseToken.symbol,name:p.baseToken.name,priceUsd:Number(p.priceUsd),liquidityUsd:Number(p.liquidity?.usd??0),volume24hUsd:Number(p.volume?.h24??0),change5mPct:Number(p.priceChange?.m5??0),buys5m:Number(p.txns?.m5?.buys??0),sells5m:Number(p.txns?.m5?.sells??0),pairAddress:p.pairAddress,pairCreatedAt:Number(p.pairCreatedAt??0),updatedAt:Date.now()};
    if(!seen.has(m.mint)||seen.get(m.mint).liquidityUsd<m.liquidityUsd) seen.set(m.mint,m);
  }
  return {solUsd,markets:[...seen.values()].sort((a,b)=>b.liquidityUsd-a.liquidityUsd).filter((m,i)=>i<60||extraMints.includes(m.mint)),updatedAt:Date.now()};
}
