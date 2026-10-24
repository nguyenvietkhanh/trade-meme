import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {PaperDesk} from '../src/paper-desk.js';
import {PAPER_AGENTS,observeAgentMarkets,rankAgentEntryUniverse} from '../src/paper-agents.js';
import {paperPortfolioAdmission} from '../src/paper-portfolio.js';
import {paperCapitalSol,paperOrderSol} from '../src/paper-sizing.js';
import {VerificationFeed} from '../src/verification.js';
import {verifiedMarket} from './fixtures/verified-market.js';
const start=Date.parse('2026-10-24T00:00:00Z'),mint='11111111111111111111111111111112';
async function book(t,clock){const dir=await mkdtemp('/tmp/independent-research-');t.after(()=>rm(dir,{recursive:true,force:true}));const quotes={quote:async input=>{const out=input.side==='BUY'?9000000000:Math.floor(Number(input.amount)*.5/9);return {...input,inAmount:input.amount,outAmount:String(out),minOut:String(out),checkedAt:clock(),contextSlot:1,impactPct:.5};}};const desk=new PaperDesk(dir,quotes,{clock});await desk.load();return desk;}
function raw(now,index=0,change=7){return verifiedMarket({mint,priceUsd:.01*(1+index*.01),change5mPct:change,change1hPct:5,buys5m:40+index*4,sells5m:20+index,buys1h:10000,sells1h:10000,evidence:{decimals:6,probeSol:.5,roundTripLossPct:1,lpSecuredPct:99,quoteReserveSol:200,top10Pct:10,largestHolderPct:2,devPct:1,buyImpactPct:.5,sellImpactPct:.5}},now);}

test('RUNE holding cannot suppress NOVA fresh BUY proof on the same mint; real verification reaches a second independently owned fill',async t=>{
 let now=start;t.mock.method(Date,'now',()=>now);const desk=await book(t,()=>now);let observed,quoteCalls=0,factCalls=0,reportCalls=0;
 const rank=(m,s,at=now)=>rankAgentEntryUniverse(desk.state,m,s,at),canResearch=m=>desk.state.running&&rank(m).roughEligible;
 const verification=new VerificationFeed(async url=>{if(String(url).includes('rugcheck')){reportCalls++;return new Response(JSON.stringify({mint,token:{mintAuthority:null,freezeAuthority:null},markets:[{pubkey:'test-pool',lp:{lpLockedPct:99}}],risks:[]}));}return new Response('{}');},{currentProbeSol:.5,inspectMarketFacts:async()=>{factCalls++;const facts={...raw(now).evidence};for(const k of ['roundTripQuoteOk','probeSol','roundTripLossPct','buyImpactPct','sellImpactPct','quoteCheckedAt','roundTripCostPct'])delete facts[k];return facts;},inspectMarketQuote:async()=>{quoteCalls++;return {roundTripQuoteOk:true,probeSol:.5,roundTripLossPct:1,buyImpactPct:.5,sellImpactPct:.5,quoteCheckedAt:now};}},{rankMarket:rank,ignoreH4:true,cacheMs:10000,quoteTracked:false,quoteTrackedCandidate:canResearch,canInspectCandidate:canResearch,requireConfirmedQuote:true});
 const input=()=>({...observed,evidence:{}}),feed=markets=>({updatedAt:now,solUsd:150,error:null,markets});
 for(let i=0;i<2;i++){now=start+i*5000;observed=observeAgentMarkets(desk.state,[{...raw(now,i),change1hPct:-10,volume5mUsd:1000}],now)[0];}
 let rows=await verification.enrich([input()],[],now);assert.deepEqual(rank(rows[0]).eligibleAgentIds,['rune']);await desk.step(feed(rows));assert.equal(desk.state.pending.agentId,'rune');
 now+=2100;await desk.step(feed(rows));assert.equal(desk.state.positions[0].agentId,'rune');assert.equal(rank(rows[0]).preQuoteEligible,true);assert.ok(rank(rows[0]).red_flags.includes('UNCONFIRMED_SIGNAL'),'the held RUNE cannot lend its confirmation to NOVA');
 now=start+10000;observed=observeAgentMarkets(desk.state,[{...raw(now,2),change1hPct:-10,volume5mUsd:1000}],now)[0];now=start+16000;
 rows=await verification.enrich([input()],[mint],now);assert.equal(quoteCalls,2,'refresh the held mint for other entry agents');assert.equal(factCalls,1);assert.equal(reportCalls,1,'reuse fresh safety facts instead of multiplying API calls');assert.ok(rank(rows[0]).eligibleAgentIds.includes('nova'));assert.ok(!rank(rows[0]).eligibleAgentIds.includes('rune'));
 await desk.step(feed(rows));assert.equal(desk.state.pending.agentId,'nova');assert.equal(desk.state.pending.mint,mint);now+=2100;await desk.step(feed(rows));assert.deepEqual(desk.state.positions.map(p=>p.agentId),['rune','nova']);assert.equal(new Set(desk.state.positions.map(p=>p.paperPositionId)).size,2);assert.equal(paperCapitalSol(desk.state),20);assert.equal(desk.state.agentStats.rune.buys,1);assert.equal(desk.state.agentStats.nova.buys,1);
});

test('holding/pending/cooldown exclusion belongs to each bot and does not prevent another bot research when the execution quota is full',()=>{
 const state={settings:undefined,cashSol:19.49793572,rentLockedSol:.00203928,positions:[{agentId:'rune',mint,costSol:.500025,initialCostSol:.500025,rawQuantity:'100',exitPolicy:{stopLossPct:9,maxQuoteAgeMs:10000}}],cooldowns:{},agentCooldowns:{nova:{[mint]:start+10000}},pendingEntries:[{agentId:'orin',mint:'other',side:'BUY',amount:'500000000'}]};
 const m=raw(start);m.scalpConfirmed=true;const rank=rankAgentEntryUniverse(state,m,undefined,start);assert.ok(rank.eligible);assert.ok(!rank.eligibleAgentIds.includes('rune'));assert.ok(!rank.eligibleAgentIds.includes('nova'));assert.ok(!rank.eligibleAgentIds.includes('orin'));assert.ok(rank.eligibleAgentIds.includes('vela'));assert.equal(paperPortfolioAdmission(state,{now:start}).allowed,false,'unknown holding exit quote still blocks actual capital admission');
 state.agentCooldowns={};state.pendingEntries[0].mint=mint;const refreshed=rankAgentEntryUniverse(state,m,undefined,start);assert.ok(refreshed.eligibleAgentIds.includes('nova'));assert.ok(refreshed.eligibleAgentIds.includes('orin'),'keep refreshing an existing pending BUY, not a different candidate for that bot');
});

test('all ten bots independently BUY and SELL over sustained synthetic market cycles using one 20 SOL book',async t=>{
 let now=start;const desk=await book(t,()=>now);let maxOpen=0;
 for(let tick=0;tick<750;tick++){
  now=start+tick*2000;const markets=[3,7,25].map((change,i)=>{const m=raw(now,tick,change);m.priceUsd=.01*1.001**tick;m.mint='cycle-'+i;m.pairAddress='pool-'+i;Object.assign(m.evidence,{mint:m.mint,pairAddress:m.pairAddress,probeSol:paperOrderSol(desk.state),decimals:6});return m;});
  const rows=observeAgentMarkets(desk.state,markets,now);desk.evaluate(rows,now);await desk.step({markets:rows,updatedAt:now,solUsd:150,error:null});maxOpen=Math.max(maxOpen,desk.state.positions.length);
  assert.ok(desk.state.cashSol>=.1);assert.ok(paperCapitalSol(desk.state)>0);if(PAPER_AGENTS.every(a=>desk.state.agentStats?.[a.id]?.buys>0&&desk.state.agentStats?.[a.id]?.sells>0))break;
 }
 assert.ok(maxOpen>1,'multiple bots held positions together, not only sequential RUNE trades');
 for(const a of PAPER_AGENTS){assert.ok(desk.state.agentStats?.[a.id]?.buys>0,a.name+' BUY');assert.ok(desk.state.agentStats?.[a.id]?.sells>0,a.name+' SELL');}
 assert.ok(Math.abs(paperCapitalSol(desk.state)-20-(desk.state.realizedNetSol??0))<1e-7,'single ledger capital and realized PnL reconcile');
});
