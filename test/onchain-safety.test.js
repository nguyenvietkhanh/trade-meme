import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,SystemProgram} from '@solana/web3.js';
import {OFFLINE_PUMP_AMM_PROGRAM as program} from '@pump-fun/pump-swap-sdk';
import {SolanaExecution,TOKEN,TOKEN2022,validateSimulation} from '../src/solana.js';
import {buildPumpSwap,PUMP_PROGRAM} from '../src/pump-swap.js';
import {SOL} from '../src/engine.js';
import {pumpFixture} from './fixtures/pump-rpc.js';
function quoteResponse(url){const u=new URL(url),buy=u.searchParams.get('inputMint')===SOL,out=buy?'10000000':'29500000',bps=Number(u.searchParams.get('slippageBps'));return new Response(JSON.stringify({inputMint:u.searchParams.get('inputMint'),outputMint:u.searchParams.get('outputMint'),inAmount:u.searchParams.get('amount'),outAmount:out,otherAmountThreshold:(BigInt(out)*BigInt(10000-bps)/10000n).toString(),slippageBps:bps,swapMode:'ExactIn',contextSlot:100,routePlan:[{}],priceImpactPct:'0.01'}));}
test('irreversible authority facts cache once; supply/holder scans remain complete and pool-excluded',async t=>{
 t.mock.method(globalThis,'fetch',async url=>quoteResponse(url));const f=await pumpFixture(),e=new SolanaExecution();e.rpc=f.rpc;let mintReads=0,scans=0;
 f.rpc.getParsedAccountInfo=async()=>{mintReads++;return {value:{owner:TOKEN,data:{space:82,parsed:{type:'mint',info:{mintAuthority:null,freezeAuthority:null,decimals:6,supply:'1000000000000000'}}}}};};
 const holders=Array.from({length:10},()=>({pubkey:Keypair.generate().publicKey,account:f.token(f.mint,Keypair.generate().publicKey,30000000000000n)}));
 holders.push({pubkey:f.pool.poolBaseTokenAccount,account:f.token(f.mint,f.poolKey,700000000000000n)});
 f.rpc.getTokenLargestAccounts=async()=>{throw Error('Redundant request must not block the complete holder scan');};f.rpc.getTokenSupply=async()=>({value:{amount:'1000000000000000'}});f.rpc.getProgramAccounts=async()=>{scans++;return holders.map(a=>({...a,account:{...a.account,data:a.account.data.subarray(0,72)}}));};
 const m={mint:f.mint.toBase58(),pairAddress:f.poolKey.toBase58(),creatorAddress:f.pool.coinCreator.toBase58()};const first=await e.inspectMarket(m);assert.equal(first.top10Pct,30);assert.equal(first.largestHolderPct,3);assert.equal(first.holderCount,10);assert.equal(first.devPct,0);assert.equal(first.roundTripQuoteOk,true);
 assert.equal(first.quoteReserveSol,30);await e.inspectMarket(m);assert.equal(mintReads,1);assert.equal(scans,2);
 holders.pop();await assert.rejects(e.inspectMarket(m),/không đầy đủ/);
});
test('Token-2022 risky or unknown extensions are rejected; passive metadata is accepted',async()=>{
 for(const [extensions,valid]of [[[{extension:'transferFeeConfig'}],false],[[{extension:'transferHook'}],false],[[{extension:'permanentDelegate'}],false],[[{extension:'unknownExtension'}],false],[[{extension:'metadataPointer'}],true],[[],true]]){
  const e=new SolanaExecution();e.rpc={getParsedAccountInfo:async()=>({value:{owner:TOKEN2022,data:{space:300,parsed:{type:'mint',info:{mintAuthority:null,freezeAuthority:null,decimals:6,supply:'1000',extensions}}}}})};
  if(valid)assert.equal((await e.mintCheck(Keypair.generate().publicKey.toBase58())).tokenProgram,'spl-token-2022');else await assert.rejects(e.mintCheck(Keypair.generate().publicKey.toBase58()),/extension/);
 }
});
test('a full app-position sell atomically closes its emptied token ATA to the same owner; partial sells do not',async()=>{
 const f=await pumpFixture({buy:false}),e=new SolanaExecution();e.rpc=f.rpc;const amount=1000000000000n;f.map.set(f.baseAta.toBase58(),f.token(f.mint,f.user,amount));
 const request={owner:f.user,input:f.mint.toBase58(),output:SOL,amount:String(amount),poolAddress:f.poolKey.toBase58(),closeEmptyInput:true};
 const built=await buildPumpSwap(f.rpc,request);assert.equal(built.closedInputAccount,f.baseAta.toBase58());
 const close=built.tx.message.compiledInstructions.at(-1);assert.equal(close.data[0],9);assert.equal(built.tx.message.staticAccountKeys[close.accountKeyIndexes[1]].toBase58(),f.user.toBase58());
 const partial=await buildPumpSwap(f.rpc,{...request,amount:String(amount/2n)});assert.equal(partial.closedInputAccount,null);
 f.rpc.simulateTransaction=async(tx,config)=>{const ix=tx.message.compiledInstructions.find(i=>tx.message.staticAccountKeys[i.programIdIndex].equals(PUMP_PROGRAM)),decoded=program.coder.instruction.decode(Buffer.from(ix.data)),out=Number(decoded.data.minQuoteAmountOut.toString());return {value:{err:null,accounts:config.accounts.addresses.map(address=>address===f.user.toBase58()?{owner:SystemProgram.programId.toBase58(),data:['','base64'],lamports:1000000000+out-20000+2039280,executable:false}:null)}};};
 const prepared=await e.prepare({ownerAddress:f.user.toBase58(),...request});assert.equal(prepared.closedInputAccount,f.baseAta.toBase58());assert.ok(prepared.minNativeOutLamports>0n);
 assert.throws(()=>validateSimulation({beforeSol:300000000,afterSol:300100000,before:[{mint:'unrelated',owner:'owner',amount:'0'}],after:[null],input:'input',output:SOL,amount:'1',minOut:'1',closeInputIndices:[0]}),/ngoài dự kiến/);
});
test('the official SDK builds plain Token-2022 pools using the verified base token program',async()=>{
 const f=await pumpFixture();f.map.get(f.mint.toBase58()).owner=TOKEN2022;
 const result=await buildPumpSwap(f.rpc,{owner:f.user,input:SOL,output:f.mint.toBase58(),amount:'30000000',poolAddress:f.poolKey.toBase58()});
 assert.equal(result.quote.tokenProgram,TOKEN2022.toBase58());assert.ok(result.tx.message.staticAccountKeys.some(k=>k.equals(TOKEN2022)));
});
