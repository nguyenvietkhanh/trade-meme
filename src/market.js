import {SOL} from './engine.js';
export async function fetchJson(url,options={}) {
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(12000)});
  if(!response.ok) throw Error(`Dịch vụ bên ngoài trả HTTP ${response.status}`);
  return response.json();
}
export async function loadMarkets(extraMints=[]) {
  const queries=['BONK','WIF','POPCAT','solana'];
  const discoveries=await Promise.allSettled([
    ...queries.map(q=>fetchJson('https://api.dexscreener.com/latest/dex/search?q='+q)),
    fetchJson('https://api.dexscreener.com/token-profiles/latest/v1')
  ]);
  const good=discoveries.slice(0,queries.length).filter(r=>r.status==='fulfilled');
  const warnings=[];
  let pairs=good.flatMap(r=>r.value.pairs??[]);
  const profileResult=discoveries.at(-1);
  const profiles=profileResult.status==='fulfilled'&&Array.isArray(profileResult.value)?profileResult.value:[];
  if(profileResult.status==='rejected'||!Array.isArray(profileResult.value))warnings.push('Nguồn token mới chưa khả dụng; vẫn quét kết quả tìm kiếm và vị thế mở.');
  const profileMints=[...new Set(profiles.filter(p=>p.chainId==='solana'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(p.tokenAddress)).map(p=>p.tokenAddress))].slice(0,30);
  const mints=[...new Set([...extraMints,...profileMints])];
  const batches=[];
  for(let i=0;i<mints.length;i+=30)batches.push(mints.slice(i,i+30));
  const tokenResults=await Promise.allSettled(batches.map(batch=>fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${batch.join(',')}`)));
  for(let i=0;i<tokenResults.length;i++){
    const result=tokenResults[i];
    if(result.status==='fulfilled')pairs.push(...(result.value.pairs??[]));
    else if(batches[i].some(m=>extraMints.includes(m)))throw Error('Không cập nhật được token theo dõi/vị thế mở. Tạm ngừng khớp lệnh.');
    else warnings.push('Không lấy được giá một nhóm token mới; nhóm này không được xét mua.');
  }
  if(!good.length&&!tokenResults.some(r=>r.status==='fulfilled'))throw Error('Không truy cập được DexScreener. Kiểm tra mạng, proxy và allowlist api.dexscreener.com.');
  const solData=await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${SOL}`);
  const solPair=(solData.pairs??[]).filter(p=>p.chainId==='solana'&&p.baseToken?.address===SOL&&Number.isFinite(Number(p.priceUsd))&&Number(p.priceUsd)>0).sort((a,b)=>(b.liquidity?.usd??0)-(a.liquidity?.usd??0))[0];
  const solUsd=Number(solPair?.priceUsd);if(!Number.isFinite(solUsd)||solUsd<=0) throw Error('Không lấy được giá SOL/USD.');
  const seen=new Map();
  for(const p of pairs) {
    if(p.chainId!=='solana'||!p.baseToken?.address||p.baseToken.address===SOL||['SOL','SOLANA','WSOL','USDC','USDT'].includes(String(p.baseToken.symbol).trim().toUpperCase())||!Number.isFinite(Number(p.priceUsd))||Number(p.priceUsd)<=0) continue;
    const m={mint:p.baseToken.address,symbol:String(p.baseToken.symbol??'?'),name:String(p.baseToken.name??''),priceUsd:Number(p.priceUsd),liquidityUsd:Number(p.liquidity?.usd??0),volume24hUsd:Number(p.volume?.h24??0),change5mPct:Number(p.priceChange?.m5??0),buys5m:Number(p.txns?.m5?.buys??0),sells5m:Number(p.txns?.m5?.sells??0),pairAddress:p.pairAddress,pairCreatedAt:Number(p.pairCreatedAt??0),updatedAt:Date.now()};
    if(!seen.has(m.mint)||seen.get(m.mint).liquidityUsd<m.liquidityUsd) seen.set(m.mint,m);
  }
  return {solUsd,markets:[...seen.values()].sort((a,b)=>b.liquidityUsd-a.liquidityUsd).filter((m,i)=>i<60||extraMints.includes(m.mint)),updatedAt:Date.now(),warnings,sources:{searches:good.length,newSolanaProfiles:profileMints.length}};
}
