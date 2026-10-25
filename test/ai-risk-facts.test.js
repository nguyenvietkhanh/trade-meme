import test from 'node:test';import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {SolanaExecution,TOKEN,TOKEN2022} from '../src/solana.js';
import {AutomaticFleet} from '../src/automatic-fleet.js';
import {PaperModelClient} from '../src/paper-model-client.js';
const mint=(owner=TOKEN,extra={})=>({owner,data:{parsed:{type:'mint',info:{mintAuthority:null,freezeAuthority:null,decimals:6,supply:'1000000',...extra}}}});
test('AI gets batched immutable mint facts, unsafe authorities are rejected and verified facts are cached',async()=>{
 const a=Keypair.generate().publicKey.toBase58(),b=Keypair.generate().publicKey.toBase58(),c=Keypair.generate().publicKey.toBase58(),e=new SolanaExecution('https://rpc.invalid');let calls=0;
 e.rpc={getMultipleParsedAccounts:async keys=>{calls++;assert.equal(keys.length,3);return {context:{slot:10},value:[mint(),mint(TOKEN,{freezeAuthority:Keypair.generate().publicKey.toBase58()}),mint(TOKEN2022,{extensions:[{extension:'transferHook'}]})]};}};
 const r=await e.readModelMintFacts([a,b,c]);assert.equal(calls,1);assert.equal(r[a].status,'verified');assert.equal(r[a].facts.mintRevoked,true);assert.equal(r[b].status,'rejected');assert.equal(r[c].status,'rejected');assert.equal(r[b].facts,null);
 const cached=await e.readModelMintFacts([a]);assert.equal(calls,1);assert.equal(cached[a].checkedAt,r[a].checkedAt);assert.equal((await e.mintCheck(a)).tokenProgram,'spl-token');
});
test('RPC failure supplies unknown facts without guessing safety or exposing provider details',async()=>{
 const a=Keypair.generate().publicKey.toBase58(),e=new SolanaExecution('https://rpc.invalid');e.rpc={getMultipleParsedAccounts:async()=>{throw Error('sensitive upstream detail');}};const r=await e.readModelMintFacts([a]);assert.equal(r[a].status,'unknown');assert.equal(r[a].facts,null);assert.ok(!JSON.stringify(r).includes('sensitive'));
});
test('parent attaches actual mint facts and explicitly unknown holder/LP/RugCheck evidence before calling AI',async()=>{
 const facts={token:{status:'verified',facts:{mintRevoked:true},checkedAt:Date.now()}},fleet=new AutomaticFleet('/tmp/no-io-ai-context',{snapshot:()=>({markets:[]})},{execution:{readModelMintFacts:async mints=>{assert.deepEqual(mints,['token','unknown']);return facts;}}});const c=await fleet.prepareModelContext({candidates:[{mint:'token'},{mint:'unknown'}]});assert.equal(c.candidates[0].mintSafety.status,'verified');assert.equal(c.candidates[1].mintSafety.status,'unknown');assert.equal(c.candidates[0].otherSecurity.holders,null);assert.equal(c.candidates[0].otherSecurity.rugCheck,null);
});
test('BUY audit evidence comes from parent observations, not invented facts in model output',async()=>{
 const facts={status:'verified',facts:{mintRevoked:true,freezeRevoked:true,tokenProgram:'spl-token'},checkedAt:10},risk={approved:true,reason:'Sufficient quoted liquidity for a small size; holder risk unknown',risks:['price volatility'],unknowns:['holders','LP lock']},context={aiOnly:true,mode:'live',botId:'kade',snapshotId:'risk',asOf:Date.now(),role:'AI',wallet:{running:true},positions:[],candidates:[{mint:'token',mintSafety:facts,otherSecurity:{holders:null,lpLock:null,rugCheck:null}}],limits:{maxPositions:100,minOrderSol:.0025,maxOrderSol:.1}};
 const client=new PaperModelClient({env:{MODEL_API_KEY:'fixture-model-key',MODEL_TRADING_ENABLED:'true'},fetcher:async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'BUY',mint:'token',order_sol:.01,sell_percent:null,stop_loss_pct:10,confidence:.6,reason:'Entry',risk_assessment:risk,riskEvidence:{mintSafety:{facts:{holdersVerified:true}}}})}}]}))});
 const reply=await client.decide('kade',context);assert.deepEqual(reply.riskEvidence.mintSafety,facts);assert.equal(reply.riskEvidence.otherSecurity.holders,null);assert.equal(reply.riskEvidence.mintSafety.facts.holdersVerified,undefined);assert.deepEqual(reply.decision.risk_assessment,risk);
});
