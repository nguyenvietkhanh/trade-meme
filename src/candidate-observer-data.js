// Public allowlist only. Never serialize a market, account, receipt or error wholesale.
export const HORIZONS = [0, 1, 5, 15, 30, 60];
export const validId = x => typeof x === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x);
export const finite = x => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x)) ? Number(x) : null;
export function publicPair(p, at = Date.now()) {
 if (p?.chainId !== 'solana' || !validId(p.baseToken?.address)) return null;
 return publicMarket({mint:p.baseToken.address,pairAddress:p.pairAddress,pairCreatedAt:p.pairCreatedAt,priceUsd:p.priceUsd,marketCapUsd:p.marketCap,liquidityUsd:p.liquidity?.usd,buys5m:p.txns?.m5?.buys,sells5m:p.txns?.m5?.sells,volume5mUsd:p.volume?.m5,change5mPct:p.priceChange?.m5,change1hPct:p.priceChange?.h1,updatedAt:at}, at, 'dexscreener');
}
export function publicMarket(m, at = Date.now(), source = 'existing_feed', cached = null) {
 if (!validId(m?.mint)) return null;
 const observedAt = finite(m.updatedAt ?? m.priceAt), fresh = observedAt !== null && observedAt <= at && at-observedAt <= 15000;
 const fields = ['priceUsd','marketCapUsd','liquidityUsd','buys5m','sells5m','volume5mUsd','change5mPct','change1hPct'];
 const values = {}, provenance = {}, missing = {};
 for(const k of fields) {values[k] = fresh ? finite(m[k]) : null; provenance[k]={source,observedAt};if(values[k]===null)missing[k]=fresh?'SOURCE_NOT_PROVIDED':'STALE_OR_NO_TIMESTAMP';}
 if (!(values.priceUsd>0)) {values.priceUsd=null;missing.priceUsd='NO_POSITIVE_PRICE';}
 const f=m.strategyData?.flow, complete=f?.mint===m.mint&&f?.pairAddress===m.pairAddress&&f.walletsComplete===true&&f.windowComplete===true&&at>=f.checkedAt&&at-f.checkedAt<=15000;
 for(const [out,key] of [['uniqueBuyers5m','uniqueBuyers'],['uniqueSellers5m','uniqueSellers']]){values[out]=complete?finite(f[key]):null;provenance[out]={source:'existing_confirmed_flow',observedAt:finite(f?.checkedAt)};if(values[out]===null)missing[out]='NO_COMPLETE_CACHED_FLOW';}
 // DexScreener does not provide side-specific volume. Do not infer it from trade counts.
 for(const key of ['buyVolume5mUsd','sellVolume5mUsd']){values[key]=null;missing[key]='SOURCE_NOT_PROVIDED';provenance[key]={source:null,observedAt:null};}
 const facts=cached?.facts, factsFresh=finite(cached?.at)!==null&&at>=cached.at&&at-cached.at<=60000;
 for(const [out,key]of [['holderCount','holderCount'],['top10Pct','top10Pct'],['devPct','devPct']]){values[out]=factsFresh&&(out!=='top10Pct'||facts.top10ExcludesPool===true)?finite(facts?.[key]):null;provenance[out]={source:'existing_safety_cache',observedAt:finite(cached?.at)};if(values[out]===null)missing[out]='NO_FRESH_VERIFIED_CACHE';}
 return {mint:m.mint,pool:validId(m.pairAddress)?m.pairAddress:null,firstSeenAt:at,poolCreatedAt:finite(m.pairCreatedAt)>0?finite(m.pairCreatedAt):null,source,observedAt: fresh?observedAt:null,values,provenance,missing};
}
export function decisionCode(r) {
 const raw=r.executionBlock??r.code;
 if(raw) {if(/429|rate_limited|provider_backoff/i.test(raw)){const source=r.quoteAttempts?.at(-1)?.source;return source==='jupiter'?'JUPITER_429':source?.includes('pump')?'PUMPFUN_RATE_LIMIT':'PROVIDER_RATE_LIMIT';}if(/quote/i.test(raw))return 'NO_QUOTE';if(raw==='RULES_HOLDER_REJECTED'){const d=r.diagnostic??{};if(d.top10_pct>d.thresholds?.top10)return 'FILTER_TOP10';if(d.dev_wallet_pct>d.thresholds?.dev)return 'FILTER_DEV';return 'FILTER_HOLDERS';}return /^[a-zA-Z0-9_.:-]{1,100}$/.test(raw)?raw.toUpperCase():'OTHER_SKIP';}
 return r.result?.verdict==='VALID_SETUP'?'SETUP_PASSED':r.result?.entry_tier==='SKIP'?'SCORE_LOW':'FILTER_RULES';
}
// Pure calculation over actual sampled observations. No interpolation or stale carry-forward.
export function outcome(candidate, samples, snapshots, now = Date.now(), cadenceMs=30000) {
 const start=candidate.firstSeenAt, end=start+3600000, initial=snapshots.find(s=>s.minute===0)?.values??{}, p0=initial.priceUsd;
 const valid=samples.filter(s=>s.at>=start&&s.at<=end&&s.priceUsd>0).sort((a,b)=>a.at-b.at);
 const prices=valid.map(s=>s.priceUsd);let peak=p0>0?p0:null, dd=0;
 for(const p of prices){peak=peak===null?p:Math.max(peak,p);dd=Math.max(dd,(peak-p)/peak*100);}
 const times=[start,...valid.map(s=>s.at),end],gaps=times.slice(1).map((at,i)=>at-times[i]);
 const maxGapMs=Math.max(0,...gaps), coverageComplete=now>=end&&p0>0&&maxGapMs<=cadenceMs*2;
 const last=minute=>snapshots.find(s=>s.minute===minute&&!s.dropped)?.values?.priceUsd;
 const ret=p=>p0>0&&p>0?(p/p0-1)*100:null;
 const gain=p0>0&&prices.length?ret(Math.max(p0,...prices)):null;
 const rugPrice=p0>0&&prices.some(p=>p<p0*.1),rugLiquidity=initial.liquidityUsd>0&&samples.some(s=>s.at>=start&&s.at<=end&&finite(s.liquidityUsd)!==null&&s.liquidityUsd<initial.liquidityUsd*.2);
 const rug=rugPrice||rugLiquidity?true:coverageComplete&&samples.every(s=>s.liquidityUsd!==null)&&initial.liquidityUsd>0?false:null;
 const r60=ret(last(60));
 const label=rug===true?'RUG':rug===false&&gain>=30?'WIN':rug===false&&r60!==null?(r60<0?'LOSS':'FLAT'):null;
 return {max_gain_pct:gain,return_15m:ret(last(15)),return_60m:r60,max_drawdown_pct:prices.length?dd:null,max_loss_from_initial_pct:p0>0&&prices.length?Math.max(0,-ret(Math.min(p0,...prices))):null,is_rug:rug,label,bot_would_have_bought:candidate.wouldBuy===true,evaluation_status:candidate.evaluationStatus??'NOT_EVALUATED',coverage:{complete:coverageComplete,maxGapMs,samples:prices.length,extrema:'observed samples only; intrainterval extrema unknown',missingReason:label===null?'INSUFFICIENT_COVERAGE':null}};
}
