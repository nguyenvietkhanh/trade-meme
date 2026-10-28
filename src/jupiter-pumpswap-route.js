import {PublicKey,VersionedTransaction,TransactionMessage,TransactionInstruction,ComputeBudgetProgram,SystemProgram} from '@solana/web3.js';
import {createHash} from 'node:crypto';
import {PUMP_AMM_PROGRAM_ID,PUMP_FEE_PROGRAM_ID,PUMP_AMM_SDK,OFFLINE_PUMP_AMM_PROGRAM,poolPda,supportsTradeV2} from '@pump-fun/pump-swap-sdk';
import {SOL} from './engine.js';
import bs58 from 'bs58';
// Provenance: jup-ag/instruction-parser src/constants.ts and src/idl/jupiter.ts.
export const JUPITER_V6=new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
const TOKEN=new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),ATA=new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const fail=code=>{throw Object.assign(Error(code),{code});};
const atomic=x=>typeof x==='string'&&/^[1-9]\d{0,19}$/.test(x)&&BigInt(x)<=18446744073709551615n;
const disc=name=>createHash('sha256').update('global:'+name).digest().subarray(0,8);
const ata=(owner,mint)=>PublicKey.findProgramAddressSync([owner.toBuffer(),TOKEN.toBuffer(),new PublicKey(mint).toBuffer()],ATA)[0];
function ix(raw){if(!raw||!Array.isArray(raw.accounts)||typeof raw.data!=='string')fail('LIVE_ROUTE_INSTRUCTION_INVALID');return new TransactionInstruction({programId:new PublicKey(raw.programId),keys:raw.accounts.map(a=>({pubkey:new PublicKey(a.pubkey),isSigner:a.isSigner===true,isWritable:a.isWritable===true})),data:Buffer.from(raw.data,'base64')});}
export function validateRoutedInstruction(instruction,{owner,input,output,amount,quote}){
 if(!instruction.programId.equals(JUPITER_V6))fail('LIVE_ROUTE_PROGRAM_UNSUPPORTED');
 const d=instruction.data,shared=d.subarray(0,8).equals(disc('shared_accounts_route')),direct=d.subarray(0,8).equals(disc('route'));if(!shared&&!direct||d.length<31)fail('LIVE_ROUTE_VARIANT_UNSUPPORTED');
 const countAt=shared?9:8;if(d.length<countAt+4+19||d.readUInt32LE(countAt)!==quote.routePlan.length||d.length>2048)fail('LIVE_ROUTE_PLAN_MISMATCH');
 const tail=d.subarray(d.length-19);if(tail.readBigUInt64LE(0)!==BigInt(amount)||tail.readBigUInt64LE(8)!==BigInt(quote.outAmount)||tail.readUInt16LE(16)!==quote.slippageBps||tail[18]!==0)fail('LIVE_ROUTE_SIGNED_AMOUNT_MISMATCH');
 const k=instruction.keys;if(!k[0]?.pubkey.equals(TOKEN))fail('LIVE_ROUTE_TOKEN_PROGRAM_UNSUPPORTED');const authority=shared?2:1,source=shared?3:2,destination=shared?6:3;
 if(!k[authority]?.pubkey.equals(owner)||!k[authority].isSigner||!k[source]?.pubkey.equals(ata(owner,input))||!k[destination]?.pubkey.equals(ata(owner,output)))fail('LIVE_ROUTE_ACCOUNT_MISMATCH');
 if(shared&&(!k[7]?.pubkey.equals(new PublicKey(input))||!k[8]?.pubkey.equals(new PublicKey(output))))fail('LIVE_ROUTE_MINT_MISMATCH');
 if(!shared&&!k[5]?.pubkey.equals(new PublicKey(output)))fail('LIVE_ROUTE_MINT_MISMATCH');
 if(k.some(a=>a.isSigner&&!a.pubkey.equals(owner)))fail('LIVE_ROUTE_EXTRA_SIGNER');
}
export function validateRouteSetup(instruction,{owner,input,output,amount},cleanup=false){
 const k=instruction.keys,d=instruction.data,wsol=ata(owner,SOL),allowed=new Set([ata(owner,input).toBase58(),ata(owner,output).toBase58()]);
 if(k.some(a=>a.isSigner&&!a.pubkey.equals(owner)))fail('LIVE_ROUTE_EXTRA_SIGNER');
 if(instruction.programId.equals(ATA)&&!cleanup){if(!k[0]?.pubkey.equals(owner)||!allowed.has(k[1]?.pubkey.toBase58())||!k[1]?.pubkey.equals(ata(owner,k[3]?.pubkey))||!k[2]?.pubkey.equals(owner)||![input,output].includes(k[3]?.pubkey.toBase58())||!k[4]?.pubkey.equals(SystemProgram.programId)||!k[5]?.pubkey.equals(TOKEN)||!([0,1].includes(d[0])||d.length===0)||d.length>1)fail('LIVE_ROUTE_SETUP_INVALID');return;}
 if(instruction.programId.equals(SystemProgram.programId)&&!cleanup){const decoded=SystemProgram.programId.equals(instruction.programId)&&d.length===12&&d.readUInt32LE(0)===2;if(!decoded||input!==SOL||!k[0]?.pubkey.equals(owner)||!k[1]?.pubkey.equals(wsol)||d.readBigUInt64LE(4)!==BigInt(amount))fail('LIVE_ROUTE_NATIVE_TRANSFER_INVALID');return;}
 if(instruction.programId.equals(TOKEN)){
  if(!cleanup&&d.length===1&&d[0]===17&&k[0]?.pubkey.equals(wsol))return;
  if(cleanup&&d.length===1&&d[0]===9&&k[0]?.pubkey.equals(wsol)&&k[1]?.pubkey.equals(owner)&&k[2]?.pubkey.equals(owner))return;
 }
 fail('LIVE_ROUTE_SETUP_UNSUPPORTED');
}
export async function buildJupiterPumpSwap(rpc,{owner,input,output,amount,poolAddress,slippageBps=150,maxReserveFraction=.02,fetcher,checkMint,referenceMinOut}){
 if(![.02,.1].includes(maxReserveFraction)||input===SOL&&maxReserveFraction!==.02||(input===SOL)===(output===SOL)||!atomic(amount)||!Number.isInteger(slippageBps)||slippageBps<1||slippageBps>(input===SOL?400:1000))fail('LIVE_ROUTE_REQUEST_INVALID');
 const started=Date.now(),request=async(inMint,outMint,raw)=>{
  const u=new URL('https://lite-api.jup.ag/swap/v1/quote');for(const [k,v]of Object.entries({inputMint:inMint,outputMint:outMint,amount:raw,swapMode:'ExactIn',slippageBps}))u.searchParams.set(k,v);
  const r=await fetcher(u,{signal:AbortSignal.timeout(2500),redirect:'error'});if(!r.ok)throw Error('Jupiter route HTTP '+r.status);const q=await r.json();
  if(q.inputMint!==inMint||q.outputMint!==outMint||q.inAmount!==raw||q.swapMode!=='ExactIn'||!atomic(q.outAmount)||!atomic(q.otherAmountThreshold)||q.slippageBps!==slippageBps||BigInt(q.otherAmountThreshold)!==BigInt(q.outAmount)*BigInt(10000-slippageBps)/10000n||!Number.isSafeInteger(q.contextSlot)||q.priceImpactPct==null||q.priceImpactPct===''||!Number.isFinite(Number(q.priceImpactPct))||Number(q.priceImpactPct)<0||Number(q.priceImpactPct)>maxReserveFraction||q.platformFee&&(q.platformFee.feeBps!==0||Number(q.platformFee.amount??0)!==0)||!Array.isArray(q.routePlan)||q.routePlan.length<1||q.routePlan.length>3)fail('LIVE_ROUTE_QUOTE_INVALID');
  return q;
 };
 const q=await request(input,output,String(amount));if(output===SOL&&BigInt(q.outAmount)>BigInt(Number.MAX_SAFE_INTEGER))fail('LIVE_ROUTE_NATIVE_AMOUNT_UNSAFE');if(!q.routePlan.some(r=>r.swapInfo?.ammKey===poolAddress))fail('LIVE_ROUTE_SELECTED_POOL_MISSING');
 const checked=new Set();
 async function checkGraph(quote){
  let mint=quote.inputMint,units=quote.inAmount;
  for(const leg of quote.routePlan){const s=leg.swapInfo;if(leg.percent!==100||s?.inputMint!==mint||s.outputMint===mint||s.inAmount!==units||!atomic(s.outAmount))fail('LIVE_ROUTE_SPLIT_OR_DISCONNECTED');mint=s.outputMint;units=s.outAmount;
   const key=new PublicKey(s.ammKey),info=await rpc.getAccountInfo(key,'confirmed');if(!info?.owner.equals(PUMP_AMM_PROGRAM_ID))fail('LIVE_ROUTE_DEX_UNSUPPORTED');const pool=PUMP_AMM_SDK.decodePool(info);
   if(pool.isMayhemMode||!supportsTradeV2(pool)||!poolPda(pool.index,pool.creator,pool.baseMint,pool.quoteMint).equals(key)||!([pool.baseMint.toBase58(),pool.quoteMint.toBase58()].includes(s.inputMint)&&[pool.baseMint.toBase58(),pool.quoteMint.toBase58()].includes(s.outputMint)))fail('LIVE_ROUTE_POOL_MISMATCH');
   const inputVault=pool.baseMint.toBase58()===s.inputMint?pool.poolBaseTokenAccount:pool.poolQuoteTokenAccount,vault=await rpc.getAccountInfo(inputVault,'confirmed');if(!vault?.owner.equals(TOKEN)||vault.data.length<165||new PublicKey(vault.data.subarray(0,32)).toBase58()!==s.inputMint||!new PublicKey(vault.data.subarray(32,64)).equals(key)||BigInt(s.inAmount)*10000n>vault.data.readBigUInt64LE(64)*BigInt(Math.round(maxReserveFraction*10000)))fail('LIVE_ROUTE_RESERVE_LIMIT');
   for(const m of [s.inputMint,s.outputMint])if(m!==SOL&&!checked.has(m)){const facts=await checkMint(m);if(facts.tokenProgram!=='spl-token')fail('LIVE_ROUTE_TOKEN_PROGRAM_UNSUPPORTED');checked.add(m);}
  }
  if(mint!==quote.outputMint||units!==quote.outAmount)fail('LIVE_ROUTE_MINT_MISMATCH');
  const slot=await rpc.getSlot('confirmed');if(!Number.isSafeInteger(slot)||Math.abs(slot-quote.contextSlot)>20)fail('LIVE_ROUTE_QUOTE_STALE');
 }
 await checkGraph(q);
 if(referenceMinOut!==undefined&&(!atomic(String(referenceMinOut))||BigInt(q.otherAmountThreshold)<BigInt(referenceMinOut)))fail('LIVE_ROUTE_ENTRY_REFERENCE');
 if(input===SOL){const reverse=await request(output,SOL,q.otherAmountThreshold);await checkGraph(reverse);const net=BigInt(reverse.otherAmountThreshold)-50000n;if(net*100n<BigInt(amount)*94n)fail('LIVE_ROUTE_ROUNDTRIP_COST_LIMIT');}
 const slot=await rpc.getSlot('confirmed');if(Math.abs(slot-q.contextSlot)>20||Date.now()-started>5000)fail('LIVE_ROUTE_QUOTE_STALE');
 const wsolInfo=await rpc.getAccountInfo(ata(owner,SOL),'confirmed');if(wsolInfo)fail('LIVE_ROUTE_EXISTING_WSOL');
 const r=await fetcher('https://lite-api.jup.ag/swap/v1/swap-instructions',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({quoteResponse:q,userPublicKey:owner.toBase58(),wrapAndUnwrapSol:true,useSharedAccounts:true,dynamicComputeUnitLimit:false}),signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error('Jupiter instructions HTTP '+r.status);const response=await r.json();
 if(response.tokenLedgerInstruction||(response.otherInstructions?.length??0)>0||!Array.isArray(response.setupInstructions)||response.setupInstructions.length>6||!response.cleanupInstruction)fail('LIVE_ROUTE_EXTRA_INSTRUCTIONS');
 const swap=ix(response.swapInstruction),args={owner,input,output,amount,quote:q};validateRoutedInstruction(swap,args);const setup=response.setupInstructions.map(ix);if(setup.filter(i=>i.programId.equals(SystemProgram.programId)).length>1)fail('LIVE_ROUTE_SETUP_DUPLICATE');for(const i of setup)validateRouteSetup(i,args);const cleanup=ix(response.cleanupInstruction);validateRouteSetup(cleanup,args,true);
 for(const leg of q.routePlan)if(!swap.keys.some(k=>k.pubkey.toBase58()===leg.swapInfo.ammKey))fail('LIVE_ROUTE_INSTRUCTION_POOL_MISSING');
 const lookups=[];if(!Array.isArray(response.addressLookupTableAddresses)||response.addressLookupTableAddresses.length>8)fail('LIVE_ROUTE_LOOKUP_INVALID');for(const address of response.addressLookupTableAddresses){const table=await rpc.getAddressLookupTable(new PublicKey(address));if(!table.value)fail('LIVE_ROUTE_LOOKUP_INVALID');lookups.push(table.value);}
 const block=await rpc.getLatestBlockhash('confirmed');if(Date.now()-started>5000||Math.abs((await rpc.getSlot('confirmed'))-q.contextSlot)>20)fail('LIVE_ROUTE_QUOTE_STALE');
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:owner,recentBlockhash:block.blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:400000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:50000}),...setup,swap,cleanup]}).compileToV0Message(lookups));
 return {tx,quote:{...q,quotedAt:started,tokenProgram:TOKEN.toBase58()},lastValidBlockHeight:block.lastValidBlockHeight,closedInputAccount:null};
}

// The public IDL predates some PumpSwap variants. Never guess enum ordinals:
// require the RPC's complete CPI trace and decode PumpSwap calls with its pinned official SDK.
export function validateRoutedSimulation(value,keys,quote,swapIndex){
 if(!Array.isArray(value.innerInstructions))fail('LIVE_ROUTE_CPI_UNVERIFIED');
 const group=value.innerInstructions.find(g=>g.index===swapIndex);if(!group||!Array.isArray(group.instructions))fail('LIVE_ROUTE_CPI_UNVERIFIED');
 const allowed=new Set([PUMP_AMM_PROGRAM_ID,PUMP_FEE_PROGRAM_ID,TOKEN,ATA,SystemProgram.programId].map(p=>p.toBase58())),seen=[];
 for(const call of group.instructions){const program=keys.get(call.programIdIndex)?.toBase58();if(program===JUPITER_V6.toBase58()){const raw=Buffer.from(bs58.decode(call.data));if(raw.subarray(0,8).equals(Buffer.from([0xe4,0x45,0xa5,0x2e,0x51,0xcb,0x9a,0x1d])))continue;fail('LIVE_ROUTE_CPI_PROGRAM_UNSUPPORTED');}if(!allowed.has(program))fail('LIVE_ROUTE_CPI_PROGRAM_UNSUPPORTED');
  if(program===PUMP_AMM_PROGRAM_ID.toBase58()){
   const raw=bs58.decode(call.data);if(raw.length>=8&&Buffer.from(raw).subarray(0,8).equals(Buffer.from([0xe4,0x45,0xa5,0x2e,0x51,0xcb,0x9a,0x1d])))continue;
   let decoded;try{decoded=OFFLINE_PUMP_AMM_PROGRAM.coder.instruction.decode(Buffer.from(bs58.decode(call.data)));}catch{fail('LIVE_ROUTE_CPI_DECODE_FAILED');}
   if(!['buy','sell','buyExactQuoteIn','buyV2','sellV2','buyExactQuoteInV2'].includes(decoded?.name)){
    fail('LIVE_ROUTE_CPI_SWAP_UNSUPPORTED');
   }
   const pool=keys.get(call.accounts?.[0])?.toBase58(),leg=quote.routePlan[seen.length]?.swapInfo;if(pool!==leg?.ammKey)fail('LIVE_ROUTE_CPI_POOL_MISMATCH');
   const data=decoded.data,exact=data.spendableQuoteIn??data.baseAmountIn,max=data.maxQuoteAmountIn;
   if(exact&&BigInt(exact.toString())>BigInt(leg.inAmount)||max&&BigInt(max.toString())>BigInt(leg.inAmount))fail('LIVE_ROUTE_CPI_INPUT_LIMIT');
   seen.push(pool);
  }
 }
 if(seen.length!==quote.routePlan.length)fail('LIVE_ROUTE_CPI_POOL_MISMATCH');
}
