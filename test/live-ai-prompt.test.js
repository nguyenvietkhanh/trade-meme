import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PROMPT_V2,PROMPT_V2_BASE,liveAiPromptVersion,modelPromptMetadata} from '../src/live-ai-prompt.js';
import {modelMessages,validateModelDecision,validateModelDecisions,createModelContext,walletFingerprint} from '../src/paper-model-context.js';
import {PaperModelClient} from '../src/paper-model-client.js';
import {ModelBotRuntime} from '../src/paper-model-runtime.js';
import {ACTIVE_BOT_CONFIGS} from '../src/paper-bot-config.js';
import {initialBotState} from '../src/paper-bot-state.js';
import {tenMarket} from './fixtures/ten-market.js';
const baselines=JSON.parse(await readFile(new URL('./fixtures/prompt-v1-baselines.json',import.meta.url),'utf8'));
async function version(v,fn){const old=process.env.LIVE_AI_PROMPT_VERSION;if(v===undefined)delete process.env.LIVE_AI_PROMPT_VERSION;else process.env.LIVE_AI_PROMPT_VERSION=v;try{return await fn();}finally{if(old===undefined)delete process.env.LIVE_AI_PROMPT_VERSION;else process.env.LIVE_AI_PROMPT_VERSION=old;}}
function context(){return {mode:'live',aiOnly:true,botId:'kade',snapshotId:'offline',asOf:Date.now(),wallet:{running:true,cashSol:1,equitySol:null},candidates:[{mint:'new',pool:'new-pool',priceSol:.01,priceUsd:1}],positions:[{mint:'held',positionId:'lot',rawQuantity:'100',remainingCostSol:.1,stopLossPct:12}],limits:{minOrderSol:.0025,maxOrderSol:.8,maxPositions:100,maxBatchOrders:5},openOrders:[]};}
const hold={action:'HOLD',mint:null,order_sol:null,sell_percent:null,stop_loss_pct:null,position_id:null,risk_assessment:{approved:false,reason:'Đứng ngoài',risks:[],unknowns:['holders']},confidence:.7,reason:'Chờ đủ dữ liệu'};
const buy={...hold,action:'BUY',mint:'new',order_sol:.05,stop_loss_pct:10,risk_assessment:{approved:true,reason:'Cấu trúc và dữ liệu hỗ trợ cỡ lệnh',risks:['biến động'],unknowns:['holders']},reason:'Nhịp tăng có xác nhận, stop theo cấu trúc'};
test('default v1 is byte-identical and v2/invalid selection cannot change paper, verification or legacy-live prompts',async()=>{
 await version(undefined,()=>{assert.equal(liveAiPromptVersion(),'v1');for(const b of baselines.cases)assert.equal(modelMessages(b.context)[0].content,b.system);});
 await version('v2',()=>{for(const b of baselines.cases.slice(1))assert.equal(modelMessages(b.context)[0].content,b.system);});
 await version('v3',()=>assert.equal(modelMessages(baselines.cases[0].context)[0].content,baselines.cases[0].system));
});
test('v2 preserves the exact supplied base plus requested market focus and appends one batch wrapper',async()=>version('v2',()=>{
 assert.equal(createHash('sha256').update(PROMPT_V2_BASE).digest('hex'),'21d880467b8b8dee027f08325350352dc091b5d6e5ee29380751d728e656fce7');
 const c=context(),single=modelMessages(c),batch=modelMessages({...c,batchOrders:true});assert.equal(single[0].content,PROMPT_V2);assert.ok(PROMPT_V2.startsWith(PROMPT_V2_BASE+'\n\n'));assert.match(PROMPT_V2,/greater than 2000 USD/);assert.match(PROMPT_V2,/less than 30000 USD/);assert.match(PROMPT_V2,/m5Pct > 100/);assert.match(PROMPT_V2,/FIVE MINUTES/);assert.ok(batch[0].content.startsWith(PROMPT_V2+' BATCH MODE:'));assert.equal(batch[0].content.split('{"action":"BUY|SELL|HOLD"').length-1,1);assert.equal(batch[0].content.split('BATCH MODE:').length-1,1);assert.equal(batch[1].content,JSON.stringify({...c,batchOrders:true}));
}));
test('BUY, SELL, stop HOLD, portfolio HOLD and batch remain compatible with unchanged validators',async()=>version('v2',()=>{
 const c=context(),sell={...hold,action:'SELL',mint:'held',position_id:'lot',sell_percent:100,reason:'Luận điểm vào lệnh không còn'},stop={...hold,mint:'held',position_id:'lot',stop_loss_pct:8,reason:'Siết stop'};
 for(const [value,action]of [[buy,'BUY'],[sell,'SELL'],[stop,'HOLD'],[hold,'HOLD']])assert.equal(validateModelDecision(value,c).action,action);
 assert.equal(validateModelDecisions({decisions:[buy,sell]},{...c,batchOrders:true}).length,2);
 assert.throws(()=>validateModelDecision({...buy,stop_loss_pct:0},c),{code:'MODEL_INVALID_DECISION'});
 assert.throws(()=>validateModelDecision({...buy,order_sol:1},c),{code:'MODEL_INVALID_DECISION'});
}));
test('offline v2 replay goes through the real client parser and decision logger without executing any order',async()=>version('v2',async()=>{
 const now=Date.now(),config=ACTIVE_BOT_CONFIGS[0],state={...initialBotState(config,now),mode:'live',initialSol:0,aiOnly:true,running:false,positions:[]},c={...context(),positions:[],wallet:{running:false}},events=[];
 const client=new PaperModelClient({env:{MODEL_API_KEY:'fixture-only',MODEL_TRADING_ENABLED:'true'},fetcher:async(_url,opts)=>{const p=JSON.parse(opts.body);assert.equal(p.messages[0].content,PROMPT_V2);assert.equal(p.temperature,.2);assert.equal(p.max_tokens,500);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(hold)}}]}));}});
 const reply=await client.decide('kade',c);assert.equal(reply.promptVersion,'v2');assert.equal(reply.promptSha256,modelPromptMetadata(c,PROMPT_V2).promptSha256);
 const runtime=new ModelBotRuntime(config,state,{ai:{enabled:true},execute:()=>{throw Error('NO_FINANCIAL_EXECUTION_ALLOWED');},onDataset:(_kind,row)=>events.push(row)});runtime.inbox={reply,context:c,fingerprint:walletFingerprint(state)};runtime.consumeModel({snapshotId:'offline',markets:[]},now);assert.equal(state.pending,null);assert.equal(state.decisions[0].promptVersion,'v2');assert.equal(state.decisions[0].promptSha256,reply.promptSha256);
}));
test('model failure preserves attempted prompt metadata and input schema stays unchanged',async()=>version('v2',async()=>{
 const c=context(),client=new PaperModelClient({env:{MODEL_API_KEY:'fixture-only',MODEL_TRADING_ENABLED:'true'},fetcher:async()=>new Response('{}',{status:429})});await assert.rejects(client.decide('kade',c),e=>e.code==='MODEL_HTTP_429'&&e.promptVersion==='v2'&&e.promptSha256===modelPromptMetadata(c,PROMPT_V2).promptSha256);
 const now=Date.now(),config=ACTIVE_BOT_CONFIGS[0],s={...initialBotState(config,now),mode:'live',initialSol:0,aiOnly:true,equitySol:null},m=tenMarket('kade',now),ctx=createModelContext(config,s,{snapshotId:'schema',solUsd:100,markets:[m]},now);assert.equal(ctx.solUsd,undefined);assert.equal(ctx.wallet.equitySol,null);assert.equal(ctx.candidates[0].closedM1[0].length,6);assert.ok(ctx.candidates[0].closedM1.every(b=>b[5]>=0));
}));
