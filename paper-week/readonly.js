import path from 'node:path';
import {PublicKey} from '@solana/web3.js';
import {PUMP_AMM_SDK,PUMP_AMM_PROGRAM_ID} from '@pump-fun/pump-swap-sdk';
import {SolanaExecution} from '../src/solana.js';
import {RulesEvidence} from '../src/rules-evidence.js';
import {boundedProjectText} from '../src/project-research.js';
import {paperMarketQuote} from '../src/sell-quote.js';
import {withRpcPriority} from '../src/rpc-priority.js';
import {projectRulesConfig} from '../src/project-risk.js';
import {curveState,quoteCurve} from '../src/pump-curve.js';
import {bondingCurvePda} from '@pump-fun/pump-sdk';
import {getAssociatedTokenAddressSync} from '@solana/spl-token';
const SOL='So11111111111111111111111111111111111111112';
const TOKENS=new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']);
export function poolReservePrice(amounts, tokenIndex, solIndex, decimals, virtualQuoteReserves = '0') {
 if(![tokenIndex,solIndex].every(i=>i===0||i===1)||tokenIndex===solIndex||!Number.isInteger(decimals)||decimals<0||decimals>18)throw Error('PAPER_RESERVE_PRICE_INVALID');
 const reserves=amounts.map(n=>BigInt(n));
 // PumpSwap V2 pricing adds virtual reserves to the pool's quote side, which
 // is not necessarily WSOL when the pool is reversed. Matches SDK math.
 reserves[1]+=BigInt(virtualQuoteReserves);
 if(reserves.some(n=>n<0n)||reserves[tokenIndex]===0n)return null;
 return Number(reserves[solIndex])/1e9/(Number(reserves[tokenIndex])/10**decimals);
}
export function readOnlyRpc(rpc){return new Proxy(Object.create(null),{get(_target,key){if(key==='commitment')return 'confirmed';if(typeof key!=='string'||!(/^(get[A-Z]|rpcDiagnostics$)/.test(key)))throw Error('PAPER_RPC_READ_ONLY');const fn=rpc[key];if(typeof fn!=='function')throw Error('PAPER_RPC_METHOD_UNAVAILABLE');return fn.bind(rpc);}});}
export function createPaperAdapter(dir,{env=process.env,policy=projectRulesConfig({})}={}){
 const raw=new SolanaExecution();raw.rpc=readOnlyRpc(raw.rpc);
 const execution=Object.freeze({rpc:raw.rpc,curveMarketData:(...a)=>raw.curveMarketData(...a),inspectCurveMarket:(m)=>raw.inspectCurveMarket(m,undefined,{includeQuote:false}),inspectMarketFacts:m=>raw.inspectMarketFacts(m)});
 const supplyCache=new Map();
 const facts=policy.momentumOnly?null:new RulesEvidence({execution,policy,walletsFile:path.resolve(env.PAPER_WEEK_WALLETS_FILE??path.join(dir,'wallets.txt'))});
 async function mintDecimals(mint){let cached=supplyCache.get(mint);if(!cached||Date.now()-cached.at>60000){const decimals=(await raw.rpc.getTokenSupply(new PublicKey(mint),'confirmed')).value.decimals;if(!Number.isInteger(decimals)||decimals<0||decimals>18)throw Error('PAPER_MINT_DECIMALS_UNVERIFIED');cached={decimals,at:Date.now()};supplyCache.set(mint,cached);while(supplyCache.size>256)supplyCache.delete(supplyCache.keys().next().value);}return cached.decimals;}
 // The public owner address may be used by SDK readers; no account secret is read.
 async function poolPrice(m,poolAddress){const decimals=await mintDecimals(m.mint),priceAt=Date.now(),account=await raw.rpc.getAccountInfo(new PublicKey(poolAddress),'confirmed');if(!account?.owner.equals(PUMP_AMM_PROGRAM_ID))throw Error('PAPER_POOL_OWNER_UNVERIFIED');const p=PUMP_AMM_SDK.decodePool(account),mints=[p.baseMint.toBase58(),p.quoteMint.toBase58()];if(!mints.includes(m.mint)||!mints.includes(SOL))throw Error('PAPER_POOL_MINT_MISMATCH');const accounts=await raw.rpc.getMultipleAccountsInfo([p.poolBaseTokenAccount,p.poolQuoteTokenAccount],'confirmed');const amounts=accounts.map((a,i)=>{if(!a||!TOKENS.has(a.owner.toBase58())||a.data.length<165||new PublicKey(a.data.subarray(0,32)).toBase58()!==mints[i])throw Error('PAPER_RESERVE_UNVERIFIED');return a.data.readBigUInt64LE(64);});const tokenIndex=mints.indexOf(m.mint),quoteIndex=mints.indexOf(SOL);const spotPriceSol=poolReservePrice(amounts,tokenIndex,quoteIndex,decimals,String(p.virtualQuoteReserves??0));if(!Number.isFinite(spotPriceSol)||spotPriceSol<=0)throw Error('PAPER_POOL_PRICE_UNAVAILABLE');return {spotPriceSol,priceAt,liquidityQuoteSol:Number(amounts[quoteIndex])/1e9,priceSource:'RPC effective reserves including virtual quote'};}
 async function quoteLeg(order,m){
  const curve=m.dexId==='pumpfun'&&!m.migratedPool,decimals=curve?6:await mintDecimals(m.mint);const legSlip=policy.scalpEntry?(/stop-loss|trailing|time-stop|max-hold/.test(order.reason??'')?policy.emergencySlippageBps:policy.slippageBps):order.side==='BUY'?400:300;
let q;if(m.dexId==='pumpfun'&&!m.migratedPool){
    if(policy.momentumOnly){const state=await curveState(raw.rpc,m.mint,m.pairAddress),priced=quoteCurve(state,order.side,order.amount,{maxReserveFraction:1});q={outAmount:priced.out.toString(),checkedAt:state.checkedAt,impactPct:priced.impact*100};}
    else{const rows=await raw.paperCurveQuotes([{id:order.id,mint:m.mint,poolAddress:m.pairAddress,side:order.side,amount:order.amount,reason:order.reason}]);q=rows[0];}
   if(q&&!q.failed)q={...q,minOut:(BigInt(q.outAmount)*BigInt(10000-legSlip)/10000n).toString()};} else q=await paperMarketQuote({mint:m.mint,side:order.side,amount:order.amount,slippageBps:legSlip,minObservedAt:order.readyAt},raw.quoteFetch);
   if(q?.failed)throw Error('PAPER_QUOTE_UNAVAILABLE');
   return {out:q.minOut??q.outAmount,expectedOut:q.outAmount,at:q.checkedAt,decimals,roundTripLossPct:q.roundTripLossPct??null,impactPct:q.impactPct??null,source:m.dexId==='pumpfun'&&!m.migratedPool?'pump-sdk-read-only':'jupiter-quote-only',slippageAssumptionBps:legSlip};}
 return Object.freeze({execution,
  async scalpSafety(m){return withRpcPriority('research',async()=>{
   const identity={mint:m.mint,pool:m.pairAddress,checkedAt:Date.now()};
   if(!env.PAPER_SCALP_RISK_URL)return {...identity,coverage:{},missing:['RUG_SOURCE_NOT_CONFIGURED']};
   const u=new URL(env.PAPER_SCALP_RISK_URL);if(u.protocol!=='https:'||u.username||u.password)throw Error('RISK_SOURCE_HTTPS_REQUIRED');u.searchParams.set('mint',m.mint);
   const response=await fetch(u,{headers:env.PAPER_SCALP_RISK_KEY?{Authorization:'Bearer '+env.PAPER_SCALP_RISK_KEY}:{},redirect:'error',signal:AbortSignal.timeout(policy.sourceTimeoutMs)});if(!response.ok)throw Error('RISK_SOURCE_UNAVAILABLE');
   const text=await boundedProjectText(response,policy.sourceMaxBytes);if(text.length>policy.sourceMaxBytes)throw Error('RISK_SOURCE_TOO_LARGE');const risk=JSON.parse(text);
   if(risk.mint!==m.mint||risk.verified!==true||typeof risk.danger!=='boolean'||!Number.isFinite(risk.checkedAt)||risk.checkedAt>Date.now()||Date.now()-risk.checkedAt>policy.safetyTtlMs||(typeof risk.source!=='string'||risk.source.length>256))return {...identity,coverage:{},missing:['RUG_SOURCE_UNVERIFIED']};
   if(risk.danger)return {...identity,rejected:true,reason_code:'B_RUG',rugDanger:true,rugSource:risk.source};
   const key=new PublicKey(m.mint),account=(await raw.rpc.getParsedAccountInfo(key,'confirmed')).value,parsed=account?.data?.parsed?.info,program=account?.owner?.toBase58();
   const reject=reason_code=>({...identity,rejected:true,reason_code});
   if(!account||!program)return {...identity,coverage:{}};if(!TOKENS.has(program))return reject('B_TOKEN');if(!parsed||!('mintAuthority'in parsed)||!('freezeAuthority'in parsed))return {...identity,coverage:{}};
   if(!Number.isInteger(parsed.decimals)||parsed.decimals<0||parsed.decimals>9)return reject('B_TOKEN');
   if(parsed.mintAuthority!==null||parsed.freezeAuthority!==null)return reject('B_AUTHORITY');
   const extensions=parsed.extensions??(account.data.space===82?[]:null);
   if(program!=='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'&&(!Array.isArray(extensions)||extensions.some(e=>['transferfeeconfig','transferfeeamount','permanentdelegate','nontransferable','nontransferableaccount'].includes(String(e.extension).toLowerCase())||!policy.safeToken2022Extensions.includes(String(e.extension).toLowerCase()))))return reject('B_TOKEN');
   const curve=bondingCurvePda(key),excluded=new Set([m.pairAddress,curve.toBase58(),...policy.burnOwners]),vaults=new Set();let creator;
   if(m.dexId==='pumpfun'){const state=await curveState(raw.rpc,m.mint,m.pairAddress);creator=state.curve.creator.toBase58();vaults.add(getAssociatedTokenAddressSync(key,curve,true,account.owner).toBase58());}
   else{const poolAccount=await raw.rpc.getAccountInfo(new PublicKey(m.pairAddress),'confirmed');if(!poolAccount?.owner.equals(PUMP_AMM_PROGRAM_ID))return {...identity,coverage:{}};const p=PUMP_AMM_SDK.decodePool(poolAccount),mints=[String(p.baseMint),String(p.quoteMint)];if(!mints.includes(m.mint)||!mints.includes(SOL))return {...identity,coverage:{}};creator=String(p.coinCreator);vaults.add(String(mints[0]===m.mint?p.poolBaseTokenAccount:p.poolQuoteTokenAccount));}
   if(!creator||creator===PublicKey.default.toBase58()||!PublicKey.isOnCurve(new PublicKey(creator).toBuffer()))return {...identity,coverage:{},missing:['DEV_IDENTITY_UNVERIFIED']};
   const holders=await raw.holderFacts(key,account.owner,excluded,vaults,creator);
   return {...identity,checkedAt:Date.now(),...holders,tokenProgram:program==='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'?'spl-token':'spl-token-2022',mintRevoked:true,freezeRevoked:true,extensionsSafe:true,rugDanger:risk.danger,rugSource:risk.source,coverage:{program:true,authorities:true,holders:true,exclusions:true,rug:true}};
  });},
  async refreshCandidate(m){return withRpcPriority('background',async()=>{
   const now=Date.now(),activityAt=m.activityCheckedAt??m.marketObservedAt??m.updatedAt;
   if(!Number.isFinite(activityAt)||activityAt>now||now-activityAt>(policy.momentumOnly?45000:30000)||!(m.solUsd>0)||!Number.isFinite(m.solUsdAt)||m.solUsdAt>now||now-m.solUsdAt>60000)return null;
   const rows=await this.refreshHeld([{mint:m.mint,pool:m.pairAddress,symbol:m.symbol}],[m],m.solUsd);
   // A new reserve read refreshes price only; it cannot refresh old flow/social evidence.
   return rows[0]?{...rows[0],activityCheckedAt:activityAt}:null;
  });},
  evidence:m=>facts.read({mint:m.mint,pool:m.pairAddress,solUsd:m.solUsd,rawMarket:m}),
  async quote(order,m){return withRpcPriority(order.side==='SELL'?'exit':'background',async()=>{
   const q=await quoteLeg(order,m);
   if((policy.guardedEntry||policy.scalpEntry)&&order.side==='BUY'){
    const reverse=await quoteLeg({...order,side:'SELL',amount:q.out,readyAt:q.at,reason:'entry-roundtrip-proof'},m);
    q.roundTrip={mint:m.mint,pool:m.pairAddress,inAmount:order.amount,sellInput:q.out,sellOut:reverse.out,at:reverse.at,impactPct:reverse.impactPct,source:reverse.source};
    q.roundTripLossPct=(1-(Number(reverse.out)-50000)/Number(order.amount))*100;
   }
   return q;
  });},
  async refreshHeld(positions,markets,solUsd){const out=[];await Promise.all(positions.slice(0,4).map(async p=>{let m=markets.find(m=>m.mint===p.mint&&m.pairAddress===p.pool)??{mint:p.mint,pairAddress:p.pool,dexId:p.venue??'pumpfun',symbol:p.symbol,solUsd};try{if(m.dexId==='pumpfun'){const route=await raw.curveRoute(p.mint,'SELL',p.pool);if(route.venue==='pumpfun'){const curves=await raw.curveMarketData([p.mint],solUsd);if(!curves[0])return;m={...m,...curves[0],spotPriceSol:curves[0].priceUsd/solUsd,priceAt:curves[0].updatedAt};}else{const price=await poolPrice(m,route.poolAddress);m={...m,...price,migratedPool:route.poolAddress};}}else m={...m,...await poolPrice(m,m.pairAddress)};out.push(m);}catch{/* Missing marks remain unavailable; never synthesize an exit. */}}));return out;},
  status:()=>({mode:'read-only',heliusConfigured:raw.heliusConfigured,rpcMode:raw.rpcMode,scalpRiskConfigured:!!env.PAPER_SCALP_RISK_URL,research:facts?.projectResearch?.status()??{enabled:false,reason:'momentum strategy: holder/dev/socials do not gate paper orders'}})
 });
}
