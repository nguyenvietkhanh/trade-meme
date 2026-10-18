import {SOL} from './engine.js';
import {coarseMarket,rankMarket} from './strategy.js';
export async function fetchJson(url,{timeoutMs=12000,...options}={}) {
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(timeoutMs)});
  if(!response.ok) throw Error(`Dịch vụ bên ngoài trả HTTP ${response.status}`);
  return response.json();
}
export async function loadMarkets(extraMints=[],preferredPools={},discovery=null) {
  const queries=['pumpswap','pump','solana'];
  const discover=()=>Promise.allSettled([
    ...queries.map(q=>fetchJson('https://api.dexscreener.com/latest/dex/search?q='+q)),
    fetchJson('https://api.dexscreener.com/token-profiles/latest/v1'),
    fetchJson('https://api.geckoterminal.com/api/v2/networks/solana/new_pools')
  ]);
  const discoveries=discovery?await discovery.discover(discover):await discover();
  const good=discoveries.slice(0,queries.length).filter(r=>r.status==='fulfilled');
  const warnings=[];
  let pairs=good.flatMap(r=>r.value.pairs??[]);
  const profileResult=discoveries[queries.length],newPoolResult=discoveries[queries.length+1];
  const profiles=profileResult.status==='fulfilled'&&Array.isArray(profileResult.value)?profileResult.value:[];
  if(profileResult.status==='rejected'||!Array.isArray(profileResult.value))warnings.push('Nguồn token mới chưa khả dụng; vẫn quét kết quả tìm kiếm và vị thế mở.');
  const profileMints=[...new Set(profiles.filter(p=>p.chainId==='solana'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(p.tokenAddress)).map(p=>p.tokenAddress))].slice(0,30);
  const newPoolMints=newPoolResult.status==='fulfilled'&&Array.isArray(newPoolResult.value.data)?newPoolResult.value.data.filter(p=>p.relationships?.dex?.data?.id==='pumpswap').map(p=>String(p.relationships?.base_token?.data?.id??'').replace(/^solana_/,'' )).filter(m=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)).slice(0,20):[];
  if(newPoolResult.status==='rejected')warnings.push('Nguồn pool mới chưa khả dụng; tiếp tục tìm PumpSwap qua DexScreener.');
  discovery?.remember(pairs.filter(p=>p.chainId==='solana'&&p.dexId==='pumpswap').map(p=>({mint:p.baseToken?.address,pairCreatedAt:p.pairCreatedAt})));
  discovery?.remember([...newPoolMints,...profileMints].map(mint=>({mint})));
  // Cached discovery identifies mints only. Never relabel cached search prices as fresh prices.
  const searchMints=discovery?[...new Set(pairs.filter(p=>p.chainId==='solana'&&p.baseToken?.address!==SOL&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(p.baseToken?.address)).map(p=>p.baseToken.address))].slice(0,90):[];
  const current=[...new Set([...extraMints,...newPoolMints,...profileMints,...searchMints])];
  const revisited=discovery?.nextBatch(current)??[];
  const mints=[...new Set([...current,...revisited])];discovery?.queried(mints);
  if(discovery)pairs=[];
  const batches=[];
  for(let i=0;i<mints.length;i+=30)batches.push(mints.slice(i,i+30));
  const tokenResults=await Promise.allSettled(batches.map(batch=>fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${batch.join(',')}`,{timeoutMs:4000})));
  for(let i=0;i<tokenResults.length;i++){
    const result=tokenResults[i];
    if(result.status==='fulfilled')pairs.push(...(result.value.pairs??[]));
    else if(batches[i].some(m=>extraMints.includes(m)))throw Error('Không cập nhật được token theo dõi/vị thế mở. Tạm ngừng khớp lệnh.');
    else warnings.push('Không lấy được giá một nhóm token mới; nhóm này không được xét mua.');
  }
  if(!good.length&&!tokenResults.some(r=>r.status==='fulfilled'))throw Error('Không truy cập được DexScreener. Kiểm tra mạng, proxy và allowlist api.dexscreener.com.');
  const solData=await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${SOL}`,{timeoutMs:4000});
  const solPair=(solData.pairs??[]).filter(p=>p.chainId==='solana'&&p.baseToken?.address===SOL&&Number.isFinite(Number(p.priceUsd))&&Number(p.priceUsd)>0).sort((a,b)=>(b.liquidity?.usd??0)-(a.liquidity?.usd??0))[0];
  const solUsd=Number(solPair?.priceUsd);if(!Number.isFinite(solUsd)||solUsd<=0) throw Error('Không lấy được giá SOL/USD.');
  const seen=new Map();
  for(const p of pairs) {
    if(p.chainId!=='solana'||!p.baseToken?.address||p.baseToken.address===SOL||['SOL','SOLANA','WSOL','USDC','USDT'].includes(String(p.baseToken.symbol).trim().toUpperCase())||!Number.isFinite(Number(p.priceUsd))||Number(p.priceUsd)<=0) continue;
    const m={solUsd,mint:p.baseToken.address,symbol:String(p.baseToken.symbol??'?'),name:String(p.baseToken.name??''),priceUsd:Number(p.priceUsd),liquidityUsd:Number(p.liquidity?.usd??0),liquidityQuoteSol:p.quoteToken?.address===SOL&&p.liquidity?.quote!=null?Number(p.liquidity.quote):null,volume24hUsd:p.volume?.h24==null?null:Number(p.volume.h24),volume5mUsd:p.volume?.m5==null?null:Number(p.volume.m5),volume1hUsd:p.volume?.h1==null?null:Number(p.volume.h1),volume6hUsd:p.volume?.h6==null?null:Number(p.volume.h6),buys1h:p.txns?.h1?.buys==null?null:Number(p.txns.h1.buys),sells1h:p.txns?.h1?.sells==null?null:Number(p.txns.h1.sells),buys6h:p.txns?.h6?.buys==null?null:Number(p.txns.h6.buys),sells6h:p.txns?.h6?.sells==null?null:Number(p.txns.h6.sells),change1hPct:p.priceChange?.h1==null?null:Number(p.priceChange.h1),change6hPct:Number(p.priceChange?.h6??0),change24hPct:Number(p.priceChange?.h24??0),dexId:String(p.dexId??''),hasProfile:p.info==null?null:!!(p.info.websites?.length||p.info.socials?.length),boosted:!!p.boosts?.active,change5mPct:p.priceChange?.m5==null?null:Number(p.priceChange.m5),buys5m:p.txns?.m5?.buys==null?null:Number(p.txns.m5.buys),sells5m:p.txns?.m5?.sells==null?null:Number(p.txns.m5.sells),valuationUsd:Number(p.marketCap)>0?Number(p.marketCap):Number(p.fdv??0),valuationSource:Number(p.marketCap)>0?'marketCap':p.fdv&&p.baseToken.address.endsWith('pump')?'pump-fdv':p.fdv?'fdv':'unknown',pairAddress:p.pairAddress,pairCreatedAt:Number(p.pairCreatedAt??0),updatedAt:Date.now()};
    if(preferredPools[m.mint]&&m.pairAddress!==preferredPools[m.mint])continue;
    const prior=seen.get(m.mint);
    if(!prior||(m.dexId==='pumpswap'&&prior.dexId!=='pumpswap')||((m.dexId==='pumpswap')===(prior.dexId==='pumpswap')&&prior.liquidityUsd<m.liquidityUsd))seen.set(m.mint,m);
  }
  const all=[...seen.values()].filter(m=>m.dexId==='pumpswap'||extraMints.includes(m.mint));discovery?.remember(all.filter(m=>m.dexId==='pumpswap'));
  const priority=new Map(all.map(m=>[m,rankMarket(m).roughEligible?2:coarseMarket(m).eligible?1:0]));
  const markets=all.sort((a,b)=>priority.get(b)-priority.get(a)||b.liquidityUsd-a.liquidityUsd).filter((m,i)=>i<60||extraMints.includes(m.mint));
  return {solUsd,markets,updatedAt:Date.now(),warnings,sources:{searches:good.length,newSolanaProfiles:profileMints.length,newPumpSwapPools:newPoolMints.length,revisitedTokens:revisited.length,discoveryQueue:discovery?.entries.size??0,preMigrationEnabled:false,discoveredCandidates:all.length,shortlistedCandidates:markets.length}};
}
