import {PublicKey} from '@solana/web3.js';
import {OFFLINE_PUMP_AMM_PROGRAM as program,PUMP_AMM_PROGRAM_ID} from '@pump-fun/pump-swap-sdk';
import bs58 from 'bs58';
import {SOL} from './engine.js';
const PROGRAM=PUMP_AMM_PROGRAM_ID.toBase58(),CPI_TAG=Buffer.from([228,69,165,46,81,203,154,29]);
const number=x=>{const n=Number(x?.toString());return Number.isSafeInteger(n)?n:null;};
/** Decode actual PumpSwap events, accepting only the real program's CPI/log context. */
export function decodeSwapTrades(tx,m,signature){
 if(!tx||!tx.meta||tx.meta.err)return {complete:!!tx?.meta,events:[]};if(Array.isArray(tx.transaction?.signatures)&&tx.transaction.signatures[0]!==signature)return {complete:false,events:[]};
 const message=tx.transaction?.message,keys=[...(message?.staticAccountKeys??message?.accountKeys??[]),...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])].map(k=>k.toBase58?.()??k.pubkey?.toBase58?.()??String(k.pubkey??k));
 const signers=new Set(keys.slice(0,message?.header?.numRequiredSignatures??0)),cpi=[],logs=[];let recognized=false,called=keys.includes(PROGRAM);
 const decode=raw=>{try{const event=program.coder.events.decode(raw);if(event)recognized=true;return event;}catch{return null;}};
 for(const group of tx.meta.innerInstructions??[])for(const ix of group.instructions??[]){
  const id=ix.programId?.toBase58?.()??ix.programId??keys[ix.programIdIndex];if(id!==PROGRAM)continue;called=true;
  try{const bytes=Buffer.from(bs58.decode(ix.data));if(bytes.subarray(0,8).equals(CPI_TAG)){const event=decode(bytes.subarray(8).toString('base64'));if(event)cpi.push(event);}}catch{}
 }
 const stack=[];for(const line of tx.meta.logMessages??[]){const invoke=/^Program (\w+) invoke \[\d+\]$/.exec(line),end=/^Program (\w+) (?:success|failed:)/.exec(line);if(invoke){stack.push(invoke[1]);if(invoke[1]===PROGRAM)called=true;}else if(end){if(stack.at(-1)===end[1])stack.pop();else stack.length=0;}else if(stack.at(-1)===PROGRAM&&line.startsWith('Program data: ')){const event=decode(line.slice(14));if(event)logs.push(event);}}
 const events=[];let valid=true,index=0;
 for(const event of cpi.length?cpi:logs){
  if(!['buyEvent','sellEvent'].includes(event.name))continue;
  const d=event.data;if(d.pool?.toBase58()!==m.pairAddress)continue;
  const at=number(d.timestamp),quote=number(event.name==='buyEvent'?d.quoteAmountIn:d.quoteAmountOut),base=number(event.name==='buyEvent'?d.baseAmountOut:d.baseAmountIn),user=d.user?.toBase58();
  if(at===null||quote===null||quote<=0||base===null||base<=0||!Number.isFinite(tx.blockTime)||Math.abs(at-tx.blockTime)>120){valid=false;continue;}
  events.push({id:signature+':'+index++,signature,at:tx.blockTime*1000,side:event.name==='buyEvent'?'BUY':'SELL',quoteSol:quote/1e9,user:signers.has(user)&&PublicKey.isOnCurve(d.user.toBytes())?user:null,slot:tx.slot});
 }
 return {complete:valid&&(!called||recognized),events};
}
export function flowSummary(m,signatures,receipts,checkedAt,now=Date.now()){
 const windowStart=now-300000,events=signatures.flatMap(s=>receipts.get(s.signature)?.events??[]).filter(t=>t.at<=now&&t.at>=windowStart).sort((a,b)=>b.at-a.at||b.slot-a.slot||b.id.localeCompare(a.id));
 const boundary=signatures.length<40||signatures.some(s=>Number.isFinite(s.blockTime)&&s.blockTime*1000<=windowStart),covered=signatures.filter(s=>!Number.isFinite(s.blockTime)||s.blockTime*1000>windowStart).every(s=>s.err||receipts.get(s.signature)?.complete===true),windowComplete=boundary&&covered;
 let prefixComplete=true,seen=0;for(const s of signatures){const row=receipts.get(s.signature);if(!s.err&&row?.complete!==true){prefixComplete=false;break;}seen+=(row?.events??[]).filter(t=>t.at<=now).length;if(seen>=10)break;}
 const lastTen=events.slice(0,10),buys=events.filter(t=>t.side==='BUY'),sells=events.filter(t=>t.side==='SELL'),volume=events.reduce((sum,t)=>sum+t.quoteSol,0);
 return {mint:m.mint,pairAddress:m.pairAddress,checkedAt,provider:'confirmed-pumpswap-events',windowStart,windowComplete,walletsComplete:windowComplete&&events.every(t=>t.user!==null),lastTenComplete:prefixComplete&&lastTen.length===10,lastTen,uniqueBuyers:new Set(buys.filter(t=>t.user).map(t=>t.user)).size,uniqueSellers:new Set(sells.filter(t=>t.user).map(t=>t.user)).size,largestBuySharePct:volume>0?Math.max(0,...buys.map(t=>t.quoteSol))/volume*100:null,smallBuyFraction:buys.length&&volume>0?buys.filter(t=>t.quoteSol<=volume*.05).length/buys.length:null,eventsObserved:events.length,coverageNote:'Distinct signing addresses, not independently funded humans. Partial RPC windows never count as complete.'};
}
export function createSwapFlowReader(rpc,{clock=Date.now,rolling=false}={}){
 const pools=new Map();return async m=>{
  if(m.dexId!=='pumpswap')throw Error('PumpSwap only');const key=m.mint+':'+m.pairAddress,checkedAt=clock();let cache=pools.get(key);
  if(!cache){const account=await rpc.getAccountInfo(new PublicKey(m.pairAddress),'confirmed');if(!account?.owner?.equals(PUMP_AMM_PROGRAM_ID))throw Error('Pool program mismatch');const pool=program.coder.accounts.decode('pool',account.data);if(pool.baseMint.toBase58()!==m.mint||pool.quoteMint.toBase58()!==SOL)throw Error('Pool mint mismatch');cache={receipts:new Map(),at:checkedAt};pools.set(key,cache);}
  let signatures=await rpc.getSignaturesForAddress(new PublicKey(m.pairAddress),{limit:40},'confirmed');if(!Array.isArray(signatures)||signatures.length>40||signatures.some(s=>typeof s.signature!=='string'||!s.signature)||new Set(signatures.map(s=>s.signature)).size!==signatures.length)throw Error('Missing/invalid signature window');
  let pagesComplete=true;
  if(rolling){
   cache.signatures??=new Map();cache.cursors??=[];const old=new Set(cache.signatures.keys()),head=signatures;
   const boundary=page=>page.length<40||page.some(s=>Number.isFinite(s.blockTime)&&s.blockTime*1000<=checkedAt-300000)||page.some(s=>old.has(s.signature));
   if(!boundary(head)&&head.length&&!cache.cursors.includes(head.at(-1).signature))cache.cursors.unshift(head.at(-1).signature);
   for(const s of head)cache.signatures.set(s.signature,s);
   if(cache.cursors.length){const cursor=cache.cursors[0],page=await rpc.getSignaturesForAddress(new PublicKey(m.pairAddress),{limit:40,before:cursor},'confirmed');if(!Array.isArray(page)||page.some(s=>typeof s.signature!=='string'))throw Error('Invalid backfill page');const done=boundary(page);for(const s of page)cache.signatures.set(s.signature,s);if(done)cache.cursors.shift();else cache.cursors[0]=page.at(-1).signature;}
   const ordered=[...cache.signatures.values()].sort((a,b)=>b.slot-a.slot||b.signature.localeCompare(a.signature)),keep=ordered.filter(s=>!Number.isFinite(s.blockTime)||s.blockTime*1000>=checkedAt-360000);for(const s of ordered)if(!keep.includes(s))cache.signatures.delete(s.signature);
   signatures=keep;pagesComplete=cache.cursors.length===0;
  }
  const missing=signatures.filter(s=>!s.err&&(!cache.receipts.has(s.signature)||cache.receipts.get(s.signature).complete!==true&&clock()-(cache.receipts.get(s.signature).readAt??0)>=30000)).slice(0,12);
  // At most two background receipt reads concurrently; existing RPC scheduler
  // reserves capacity for SELL and never broadcasts any transaction here.
  for(let i=0;i<missing.length;i+=2)await Promise.all(missing.slice(i,i+2).map(async s=>{try{const tx=await rpc.getTransaction(s.signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});if(tx)cache.receipts.set(s.signature,{...decodeSwapTrades(tx,m,s.signature),readAt:clock()});}catch(error){console.error('paper flow receipt',s.signature,error.message);}}));
  const keep=new Set(signatures.map(s=>s.signature));for(const s of cache.receipts.keys())if(!keep.has(s))cache.receipts.delete(s);cache.at=clock();for(const [k,v]of pools)if(clock()-v.at>600000)pools.delete(k);while(pools.size>60)pools.delete(pools.keys().next().value);
  const summary=flowSummary(m,signatures,cache.receipts,checkedAt,clock());if(!pagesComplete){summary.windowComplete=false;summary.walletsComplete=false;}return summary;
 };
}
