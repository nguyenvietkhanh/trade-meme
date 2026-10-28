import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Keypair,PublicKey,SystemProgram,TransactionInstruction} from '@solana/web3.js';
import {OFFLINE_PUMP_AMM_PROGRAM as program,PUMP_AMM_PROGRAM_ID,poolPda} from '@pump-fun/pump-swap-sdk';
import {getAssociatedTokenAddressSync,TOKEN_PROGRAM_ID as TOKEN,ASSOCIATED_TOKEN_PROGRAM_ID as ATA} from '@solana/spl-token';
import BN from 'bn.js';
import bs58 from 'bs58';
import {SOL} from '../src/engine.js';
import {buildJupiterPumpSwap,JUPITER_V6,validateRoutedInstruction,validateRouteSetup,validateRoutedSimulation} from '../src/jupiter-pumpswap-route.js';
import {SolanaExecution} from '../src/solana.js';
import {LIVE_BUDGET_AUTHORITY} from '../src/live-budget-authority.js';
import {pumpFixture} from './fixtures/pump-rpc.js';
const ata=(m,u)=>getAssociatedTokenAddressSync(new PublicKey(m),u,true),disc=n=>createHash('sha256').update('global:'+n).digest().subarray(0,8),key=()=>Keypair.generate().publicKey;
const raw=i=>({programId:i.programId.toBase58(),accounts:i.keys.map(k=>({pubkey:k.pubkey.toBase58(),isSigner:k.isSigner,isWritable:k.isWritable})),data:i.data.toString('base64')});
async function fixture(){
 const f=await pumpFixture(),g=await pumpFixture({user:f.user}),pool={...g.pool,quoteMint:f.mint},poolKey=poolPda(pool.index,pool.creator,pool.baseMint,pool.quoteMint);pool.poolBaseTokenAccount=ata(pool.baseMint,poolKey);pool.poolQuoteTokenAccount=ata(pool.quoteMint,poolKey);
 f.map.set(poolKey.toBase58(),f.info(PUMP_AMM_PROGRAM_ID,await program.coder.accounts.encode('pool',pool)));
 f.map.set(pool.poolBaseTokenAccount.toBase58(),f.token(g.mint,poolKey,100000000000000n));f.map.set(pool.poolQuoteTokenAccount.toBase58(),f.token(f.mint,poolKey,100000000000000n));f.map.set(g.mint.toBase58(),g.map.get(g.mint.toBase58()));
 const leg=(pool,inputMint,outputMint,inAmount,outAmount)=>({percent:100,swapInfo:{ammKey:pool.toBase58(),inputMint,outputMint,inAmount,outAmount}});
 const quote=(inputMint,outputMint,inAmount,outAmount,routePlan)=>({inputMint,outputMint,inAmount,outAmount,otherAmountThreshold:String(BigInt(outAmount)*9850n/10000n),swapMode:'ExactIn',slippageBps:150,priceImpactPct:'0.001',contextSlot:100,routePlan});
 const forward=quote(SOL,g.mint.toBase58(),'10000000','2000000',[leg(f.poolKey,SOL,f.mint.toBase58(),'10000000','1000000'),leg(poolKey,f.mint.toBase58(),g.mint.toBase58(),'1000000','2000000')]);
 const reverse=quote(g.mint.toBase58(),SOL,'1970000','9900000',[leg(poolKey,g.mint.toBase58(),f.mint.toBase58(),'1970000','1000000'),leg(f.poolKey,f.mint.toBase58(),SOL,'1000000','9900000')]);
 const tail=Buffer.alloc(19);tail.writeBigUInt64LE(10000000n);tail.writeBigUInt64LE(2000000n,8);tail.writeUInt16LE(150,16);const count=Buffer.alloc(4);count.writeUInt32LE(2);
 const swap=new TransactionInstruction({programId:JUPITER_V6,keys:[TOKEN,f.user,ata(SOL,f.user),ata(g.mint,f.user),JUPITER_V6,g.mint,JUPITER_V6,f.poolKey,poolKey].map((pubkey,i)=>({pubkey,isSigner:i===1,isWritable:[1,2,3,7,8].includes(i)})),data:Buffer.concat([disc('route'),count,Buffer.from([0,100,0,1,0,100,1,2]),tail])});
 const create=m=>new TransactionInstruction({programId:ATA,keys:[f.user,ata(m,f.user),f.user,new PublicKey(m),SystemProgram.programId,TOKEN].map((pubkey,i)=>({pubkey,isSigner:i===0,isWritable:i<2})),data:Buffer.from([1])});
 const cleanup=new TransactionInstruction({programId:TOKEN,keys:[{pubkey:ata(SOL,f.user),isSigner:false,isWritable:true},{pubkey:f.user,isSigner:false,isWritable:true},{pubkey:f.user,isSigner:true,isWritable:false}],data:Buffer.from([9])});
 const response={setupInstructions:[create(SOL),create(g.mint),SystemProgram.transfer({fromPubkey:f.user,toPubkey:ata(SOL,f.user),lamports:10000000}),new TransactionInstruction({programId:TOKEN,keys:[{pubkey:ata(SOL,f.user),isSigner:false,isWritable:true}],data:Buffer.from([17])})].map(raw),swapInstruction:raw(swap),cleanupInstruction:raw(cleanup),addressLookupTableAddresses:[]};
 const calls=[],rpc={...f.rpc,getAccountInfo:async k=>f.map.get(k.toBase58())??null,getAddressLookupTable:async()=>({value:null})};
 const fetcher=async(url,options={})=>{calls.push([String(url),options.method??'GET']);return {ok:true,json:async()=>String(url).includes('swap-instructions')?response:new URL(url).searchParams.get('inputMint')===SOL?forward:reverse};};
 const args={owner:f.user,input:SOL,output:g.mint.toBase58(),amount:'10000000',poolAddress:poolKey.toBase58(),fetcher,checkMint:async()=>({tokenProgram:'spl-token'})};
 return {...f,rpc,g,pool,poolKey,forward,reverse,response,swap,cleanup,args,calls};
}
test('unsigned SOL -> intermediate -> token route verifies both graphs and keeps one signer',async()=>{
 const f=await fixture(),p=await buildJupiterPumpSwap(f.rpc,f.args);
 assert.equal(p.quote.inputMint,SOL);assert.equal(p.quote.outputMint,f.g.mint.toBase58());assert.equal(p.quote.routePlan.length,2);assert.equal(p.tx.message.header.numRequiredSignatures,1);assert.ok(p.tx.signatures[0].every(x=>x===0));assert.ok(p.tx.serialize().length<=1232);assert.equal(f.calls.length,3);assert.equal(f.calls[2][1],'POST');
});
test('forward/reverse pool owner, amounts, mint checks, rent safety, slot and roundtrip reject before signing',async()=>{
 for(const [mutate,code] of [
 [f=>{f.forward.routePlan[1].swapInfo.inAmount='5';},'LIVE_ROUTE_SPLIT_OR_DISCONNECTED'],
 [f=>{f.forward.routePlan[0].percent=50;},'LIVE_ROUTE_SPLIT_OR_DISCONNECTED'],
 [f=>{f.map.get(f.poolKey.toBase58()).owner=SystemProgram.programId;},'LIVE_ROUTE_DEX_UNSUPPORTED'],
 [f=>{f.reverse.routePlan[0].swapInfo.ammKey=key().toBase58();},'LIVE_ROUTE_DEX_UNSUPPORTED'],
 [f=>{f.reverse.outAmount='5000000';f.reverse.otherAmountThreshold='4925000';f.reverse.routePlan.at(-1).swapInfo.outAmount='5000000';},'LIVE_ROUTE_ROUNDTRIP_COST_LIMIT'],
 [f=>{f.args.checkMint=async()=>({tokenProgram:'token-2022'});},'LIVE_ROUTE_TOKEN_PROGRAM_UNSUPPORTED'],
 [f=>{f.args.referenceMinOut='2000000';},'LIVE_ROUTE_ENTRY_REFERENCE'],
 [f=>{f.map.set(ata(SOL,f.user).toBase58(),f.token(new PublicKey(SOL),f.user,1));},'LIVE_ROUTE_EXISTING_WSOL'],
 [f=>{f.rpc.getSlot=async()=>121;},'LIVE_ROUTE_QUOTE_STALE'],
 [f=>{f.response.setupInstructions.push(f.response.setupInstructions[2]);},'LIVE_ROUTE_SETUP_DUPLICATE'],
 ]){const f=await fixture();mutate(f);await assert.rejects(buildJupiterPumpSwap(f.rpc,f.args),{code});}
});
test('instruction validation binds owner, endpoint ATAs, exact amounts, fee and setup transfers',async()=>{
 const f=await fixture(),args={...f.args,quote:f.forward};validateRoutedInstruction(f.swap,args);validateRouteSetup(f.cleanup,args,true);
 const bad=new TransactionInstruction({...f.swap,data:Buffer.from(f.swap.data)});bad.data[bad.data.length-1]=1;assert.throws(()=>validateRoutedInstruction(bad,args),{code:'LIVE_ROUTE_SIGNED_AMOUNT_MISMATCH'});
 const foreign=new TransactionInstruction({...f.swap,keys:f.swap.keys.map(k=>({...k}))});foreign.keys[3].pubkey=key();assert.throws(()=>validateRoutedInstruction(foreign,args),{code:'LIVE_ROUTE_ACCOUNT_MISMATCH'});
 const transfer=SystemProgram.transfer({fromPubkey:f.user,toPubkey:key(),lamports:10000000});assert.throws(()=>validateRouteSetup(transfer,args),{code:'LIVE_ROUTE_NATIVE_TRANSFER_INVALID'});
 const approve=new TransactionInstruction({programId:TOKEN,keys:[],data:Buffer.from([4])});assert.throws(()=>validateRouteSetup(approve,args),{code:'LIVE_ROUTE_SETUP_UNSUPPORTED'});
});
function trace(f,keys,swapIndex){
 const idx=pk=>{const i=Array.from({length:keys.length},(_,i)=>keys.get(i).toBase58()).indexOf(pk.toBase58());assert.ok(i>=0);return i;};
 return {innerInstructions:[{index:swapIndex,instructions:f.forward.routePlan.map((leg,i)=>({programIdIndex:idx(PUMP_AMM_PROGRAM_ID),accounts:[idx(new PublicKey(leg.swapInfo.ammKey))],data:bs58.encode(program.coder.instruction.encode(i?'buyExactQuoteInV2':'buyExactQuoteInV2',{spendableQuoteIn:new BN(leg.swapInfo.inAmount),minBaseAmountOut:new BN(1)}))}))}]};
}
test('simulation CPI trace fails closed on missing traces, foreign programs and wrong pools',async()=>{
 const f=await fixture(),list=[PUMP_AMM_PROGRAM_ID,f.poolKey,f.forward.routePlan[0].swapInfo.ammKey,SystemProgram.programId].map(k=>new PublicKey(k)),keys={length:list.length,get:i=>list[i]},value=trace(f,keys,6);validateRoutedSimulation(value,keys,f.forward,6);
 assert.throws(()=>validateRoutedSimulation({},keys,f.forward,6),{code:'LIVE_ROUTE_CPI_UNVERIFIED'});
 value.innerInstructions[0].instructions[0].programIdIndex=3;assert.throws(()=>validateRoutedSimulation(value,keys,f.forward,6),{code:'LIVE_ROUTE_CPI_POOL_MISMATCH'});
});
test('routed prepare retains existing simulation balance, asset and gas guards and requests CPI trace',async()=>{
 const f=await fixture();f.swap.keys.push({pubkey:PUMP_AMM_PROGRAM_ID,isSigner:false,isWritable:false});f.response.swapInstruction=raw(f.swap);
 const execution=new SolanaExecution();execution.rpc=f.rpc;execution.quoteFetch=f.args.fetcher;execution.mintCheck=f.args.checkMint;
 let extraSpend=0,output=2000000n;
 f.rpc.simulateTransaction=async(tx,config)=>{assert.equal(config.innerInstructions,true);const keys=tx.message.getAccountKeys(),swapIndex=tx.message.compiledInstructions.findIndex(i=>keys.get(i.programIdIndex).equals(JUPITER_V6));return {value:{...trace(f,keys,swapIndex),err:null,accounts:config.accounts.addresses.map(a=>{const info=a===f.user.toBase58()?f.info(SystemProgram.programId,Buffer.alloc(0),1000000000-10000000-2059280-extraSpend):a===ata(f.g.mint,f.user).toBase58()?f.token(f.g.mint,f.user,output):f.map.get(a);return info?{...info,owner:info.owner.toBase58(),data:[info.data.toString('base64'),'base64']}:null;})}};};
 const req={ownerAddress:f.user.toBase58(),input:SOL,output:f.g.mint.toBase58(),amount:'10000000',poolAddress:f.poolKey.toBase58(),venue:'jupiter-pumpswap',budgetAuthority:LIVE_BUDGET_AUTHORITY};
 const p=await execution.prepare(req);assert.equal(p.signature,null);assert.equal(p.venue,'jupiter-pumpswap');
 extraSpend=5000000;await assert.rejects(execution.prepare(req),/quá giới hạn/);extraSpend=0;output=1n;await assert.rejects(execution.prepare(req),/không nhận đủ/);
});
test('shared route account offsets and mints must match, unsupported variants never pass',async()=>{
 const f=await fixture(),args={...f.args,quote:f.forward},s=new TransactionInstruction({programId:JUPITER_V6,keys:[TOKEN,key(),f.user,ata(SOL,f.user),key(),key(),ata(f.g.mint,f.user),new PublicKey(SOL),f.g.mint,JUPITER_V6].map((pubkey,i)=>({pubkey,isSigner:i===2,isWritable:[3,6].includes(i)})),data:Buffer.concat([disc('shared_accounts_route'),Buffer.from([0]),f.swap.data.subarray(8)])});
 validateRoutedInstruction(s,args);s.keys[7].pubkey=key();assert.throws(()=>validateRoutedInstruction(s,args),{code:'LIVE_ROUTE_MINT_MISMATCH'});
 s.data[0]^=1;assert.throws(()=>validateRoutedInstruction(s,args),{code:'LIVE_ROUTE_VARIANT_UNSUPPORTED'});
});
test('SELL can route back to SOL without a new BUY reference, preserving exact token debit',async()=>{
 const f=await fixture(),r=f.reverse,tail=Buffer.alloc(19);tail.writeBigUInt64LE(BigInt(r.inAmount));tail.writeBigUInt64LE(BigInt(r.outAmount),8);tail.writeUInt16LE(150,16);
 f.swap.data=Buffer.concat([f.swap.data.subarray(0,-19),tail]);f.swap.keys[2].pubkey=ata(f.g.mint,f.user);f.swap.keys[3].pubkey=ata(SOL,f.user);f.swap.keys[5].pubkey=new PublicKey(SOL);
 f.response.swapInstruction=raw(f.swap);f.response.setupInstructions=[f.response.setupInstructions[0]];
 const result=await buildJupiterPumpSwap(f.rpc,{...f.args,input:f.g.mint.toBase58(),output:SOL,amount:'1970000'});
 assert.equal(result.quote.outputMint,SOL);assert.equal(result.quote.inAmount,'1970000');assert.equal(f.calls.length,2);assert.equal(result.closedInputAccount,null);
});
