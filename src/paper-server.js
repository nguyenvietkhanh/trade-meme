import {runtimeMemory} from './runtime-memory.js';
import {CandidateObserver,observeCandidates} from './candidate-observer.js';
import {DormantBreakout} from './dormant-breakout.js';
import {RulesSources} from './rules-sources.js';
import {rulesConfig} from './rules-config.js';
import {RulesQuoteBroker} from './rules-quotes.js';
import {LiveReadPlan} from './live-read-plan.js';
import {RulesClient} from './rules-client.js';
import {RulesFleet} from './rules-fleet.js';
import {createRulesAssets} from './rules-assets.js';
import {PumpFunMarkets} from './pump-fun-market.js';
import {DatasetCollector} from './dataset.js';
import {PROFIT_RECIPIENT as DATASET_PROFIT_RECIPIENT} from './desk-rules.js';
import {tradingProduct} from './trading-product.js';
import {AI_POLICY,aiMarketEligible,compareAIMarkets} from './autonomous-policy.js';
import {PAPER_WORKFLOW_VERSION} from './paper-workflow.js';
import http from 'node:http';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createPaperAssets} from './paper-assets.js';
import {initializeStorage} from './storage.js';
import {PaperFleet as PaperDesk,FLEET_POLICY as LAB_POLICY} from './paper-fleet.js';
import {ACTIVE_BOT_CONFIGS as BOT_CONFIGS,INDEPENDENT_VERSION as PAPER_AGENT_VERSION} from './paper-bot-config.js';
import {independentSignal} from './paper-score.js';
import {StrategyDataFeed} from './paper-strategy-data.js';
import {FleetReports as PaperReports} from './paper-fleet-reports.js';
import {WalletTelegram} from './wallet-telegram.js';
import {createPaperMarket} from './paper-market.js';
import {MarketData} from './paper-market-data.js';
import {ResearchJournal} from './research-journal.js';
import {OwnerAuth} from './security.js';
import {loadMarkets} from './market.js';
import {DiscoveryQueue} from './discovery.js';
import {compare5m,SCALP_STRATEGY_VERSION} from './paper-scalp.js';
import {startPaperLoop} from './paper-loop.js';
import {PaperModelClient} from './paper-model-client.js';
import {SolanaExecution} from './solana.js';
import {controlError,pausedValue} from './control-errors.js';
const liveMode=process.env.PAPER_MODE==='true'?false:(process.env.TRADING_MODE??'live')==='live',mode=liveMode?'live':'paper',product=tradingProduct(liveMode?process.env:{});
const uiAssets=await (liveMode?createRulesAssets:createPaperAssets)(new URL('../public/',import.meta.url),{mode,product:product.id});
const root=fileURLToPath(new URL('../',import.meta.url)),dataDir=await initializeStorage(root),dir=path.join(dataDir,liveMode?'live':'paper20');await mkdir(dir,{recursive:true,mode:0o700});
const onRailway=!!(process.env.RAILWAY_SERVICE_ID||process.env.RAILWAY_ENVIRONMENT_ID),storageMode=process.env.RAILWAY_VOLUME_MOUNT_PATH?'persistent-volume':onRailway?'ephemeral':'local-disk';
const auth=new OwnerAuth({origin:process.env.PUBLIC_ORIGIN??(onRailway?'https://'+(process.env.RAILWAY_PUBLIC_DOMAIN??'trade-meme-production.up.railway.app'):null)});
const execution=new SolanaExecution(),market=createPaperMarket(()=>({cashSol:0,positions:[]}),execution,{includeCurves:liveMode}),data=new MarketData(market),quoteBroker=new RulesQuoteBroker(execution,{marketSnapshot:()=>data.snapshot()}),modelClient=liveMode?new RulesClient({quoteSelector:(c,plan)=>quoteBroker.select(c,plan)}):new PaperModelClient({env:{MODEL_TRADING_ENABLED:'false'}}),desk=liveMode?new RulesFleet(dir,data,{modelClient,execution,legacyDir:dataDir,storageMode,product}):new PaperDesk(dir,data,{modelClient});await desk.load();
const candidateObserver=liveMode?new CandidateObserver(dir):null;desk.candidateObserver=candidateObserver;
if(candidateObserver){const decide=modelClient.decide.bind(modelClient);modelClient.decide=async(...args)=>{const result=await decide(...args);observeCandidates(candidateObserver,'decisions',result);return result;};}
const curveDiscovery=liveMode?new PumpFunMarkets(execution,globalThis.fetch,{rulesMode:true}):null;
if(curveDiscovery)curveDiscovery.onObserved=rows=>observeCandidates(candidateObserver,'ids',rows,'pumpfun_discovery');
const dataset=liveMode?new DatasetCollector(dir,{addresses:[desk.treasury.owner,DATASET_PROFIT_RECIPIENT]}):null;modelClient.dataset=dataset;if(liveMode){desk.dataset=dataset;desk.treasury.dataset=dataset;}
// Bound retained research in the active and retired data roots; financial files stay untouched.
for(const archivedDir of [dataDir,path.join(dataDir,liveMode?'paper20':'live')])await new ResearchJournal(archivedDir).maintain();
const research=new ResearchJournal(dir),dormant=liveMode?new DormantBreakout({journal:research,factsProvider:m=>{const cached=desk.evidence?.factsCache.get(m.mint+':'+m.pairAddress);return cached&&Date.now()-cached.at<60000?cached.facts:null;},file:path.join(dir,'dormant-state.json')}):null;await dormant?.load();if(liveMode)desk.attachDormant(dormant);
const reports=new PaperReports(dir,research),telegram=new WalletTelegram(path.join(dataDir,'paper20'),dataDir,globalThis.fetch,{chatId:liveMode?AI_POLICY.telegramChatId:null});await telegram.load();if(liveMode)modelClient.audit=research;
data.onExecution=row=>research.enqueue({type:'paper_replay_execution',at:Date.now(),...row});
const transport={retryForever:liveMode,get state(){return liveMode?desk.treasury.s:desk.meta;},vault:{keypair:null},serial:fn=>liveMode?desk.treasury.serial(fn):desk.reportSerial(fn),save:()=>liveMode?desk.treasury.save():desk.save(),training:reports};
const discovery=new DiscoveryQueue(desk.meta.discovery),extraSources=liveMode?new RulesSources({execution,discovery}):null;
discovery.onObserved=(rows,at)=>observeCandidates(candidateObserver,'ids',rows,'discovery_queue',at);
let refreshing=false,closing=false,feed=data.feed;
const rankMarket=(m,_settings,now=Date.now())=>{if(liveMode)return {mint:m.mint,symbol:m.symbol,score:null,minScore:0,roughEligible:aiMarketEligible(m),eligible:false,blockingStage:'rules',primaryReasons:['Chờ bộ luật V5 và bằng chứng xác minh; không gọi AI'],checks:[]};const rows=BOT_CONFIGS.map(c=>independentSignal(c,m,now,{liquidityCutoff:0}));return rows.sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.conditionRatio-a.conditionRatio||b.score-a.score)[0].rank;};
const compareMarkets=(a,b)=>liveMode?compareAIMarkets(a,b):compare5m(a,b);
const selectMarkets=(rows,limit=60)=>liveMode?[...rows].sort(compareMarkets).slice(0,limit):[...rows].sort((a,b)=>rankMarket(b).score-rankMarket(a).score||compare5m(a,b)).slice(0,limit);
const strategyData=new StrategyDataFeed(market,{flowIntervalMs:liveMode?10000:3000,candleIntervalMs:liveMode?5000:2000,selectTargets:rows=>(liveMode&&!dataset.config.enabled?[]:rows).filter(m=>m.dexId==='pumpswap'&&(liveMode||m.liquidityUsd>=3000)).map(m=>({...m,needCandles:true,needFlow:liveMode||m.change5mPct>=2&&m.buys5m/Math.max(1,m.sells5m)>=1.1})).sort((a,b)=>{const ca=strategyData.cache.get(a.mint+':'+a.pairAddress),cb=strategyData.cache.get(b.mint+':'+b.pairAddress);return (ca?.candleAttemptAt??0)-(cb?.candleAttemptAt??0)||a.mint.localeCompare(b.mint);})});
const dormantFlow=liveMode?new StrategyDataFeed(market,{flowIntervalMs:10000,selectTargets:rows=>dormant.policy.enabled?rows.filter(m=>m.dexId==='pumpswap').slice(0,dormant.policy.maxTokens).map(m=>({...m,needCandles:false,needFlow:true})):[]}):null;
async function refresh(){
 if(closing)return;refreshing=true;try{const held=desk.state.positions,latest=await loadMarkets([...new Set(held.map(p=>p.mint))],Object.fromEntries(held.map(p=>[p.mint,p.pairAddress])),discovery,{rankMarket,compare:compareMarkets,selectMarkets,preferSolPools:liveMode,onObserved:(kind,rows)=>observeCandidates(candidateObserver,kind==='pairs'?'pairs':'ids',rows,...(kind==='pairs'?[]:[kind]))});if(liveMode){const curves=curveDiscovery.cachedMarkets(latest.solUsd,held.map(p=>p.mint));latest.markets=[...latest.markets,...curves.markets];latest.warnings=[...(latest.warnings??[]),...curves.warnings];latest.sources={...latest.sources,pumpfun:curves.diagnostics};}observeCandidates(candidateObserver,'markets',latest.radarMarkets??latest.markets,desk.evidence?.factsCache);observeCandidates(candidateObserver,'markets',latest.markets,desk.evidence?.factsCache);latest.markets=strategyData.applyCached(latest.markets);data.setFeed(latest);feed=data.feed;if(liveMode)modelClient.funnel.discovery(latest.radarMarkets??latest.markets);desk.meta.discovery=discovery.snapshot();research.scan(feed,{rankMarket});await desk.reportSerial(()=>desk.save());}
 catch(error){desk.error(error);data.feed={...data.feed,error:'Market API/RPC chưa phản hồi; dữ liệu giữ nguyên timestamp.'};feed=data.feed;}finally{refreshing=false;}
}
async function enrichStrategyData(){if(closing||!data.feed.updatedAt)return;const current=data.feed,markets=await strategyData.enrichCached(current.markets);if(data.feed===current){const fingerprint=rows=>JSON.stringify(rows.map(m=>[m.mint,m.strategyData?.candleFetchedAt,m.strategyData?.flow?.checkedAt]));if(fingerprint(markets)!==fingerprint(current.markets))data.featureRevision++;data.feed={...current,markets};feed=data.feed;}}
const liveReadPlan=new LiveReadPlan();
async function updatePrices(){
 if(liveMode){await liveReadPlan.read(data,data.snapshot(),desk.state.positions,{onUpdated:()=>{if(!closing){desk.health.monitor();desk.publish();}},onError:error=>desk.error(error)});return;}
 const snap=data.snapshot(),held=desk.state.positions.map(p=>snap.markets.find(m=>m.mint===p.mint&&m.pairAddress===p.pairAddress)??{...p,dexId:p.executionVenue==='pumpfun'?'pumpfun':'pumpswap'}),watch=snap.markets.filter(m=>liveMode||BOT_CONFIGS.some(c=>independentSignal(c,m,Date.now(),{liquidityCutoff:0}).conditionRatio>=.7));
 const targets=[...new Map([...held,...watch].map(m=>[m.mint+':'+m.pairAddress,m])).values()];await data.pricesFor(targets);desk.publish();
}
function activityState(){const s=desk.state;return {observedAt:Date.now(),scanning:refreshing,scanCompletedAt:s.lastEvaluationAt,verification:[],market:market.activity,strategyData:strategyData.status(),pending:s.pending,pendingEntries:s.pendingEntries,reporting:reports.busy,telegram:telegram.busy,reportQueuedEnd:desk.meta.reportLastEnd,lastSentAt:Math.max(0,...(liveMode?desk.treasury.s.telegramOutbox??[]:desk.meta.telegramOutbox).filter(m=>m.status==='sent').map(m=>m.sentAt??0))};}
function snapshot(req){
 const s=desk.state,v=desk.valuation(),portfolio=desk.admission(),agents=desk.snapshot(),marketSnapshot=data.snapshot(),radarUniverse=liveMode?(marketSnapshot.radarMarkets??marketSnapshot.markets):marketSnapshot.markets,radarSource=radarUniverse,rankings=radarSource.map(m=>({...m,...rankMarket(m)})).sort(compare5m),counts={},reasons=new Map();
 for(const a of agents.agents)for(const d of a.signal?.decisions??[]){counts[d.stage]=(counts[d.stage]??0)+1;if(d.stage!=='ready')reasons.set(d.reason,(reasons.get(d.reason)??0)+1);}
 return {...s,candidateObserver:candidateObserver?.status()??{enabled:false},dormant:dormant?.status()??null,candidateSources:extraSources?.status()??null,telegramOutbox:undefined,legacyHistory:undefined,mode,product,rpcDiagnostics:execution.rpc?.rpcDiagnostics?.()??null,readOnly:!liveMode||!desk.treasury.signingReady(),realTradingEnabled:liveMode&&product.spotEntriesAllowed&&desk.treasury.signingReady(),model:modelClient.status(),funnel:liveMode?modelClient.funnel.snapshot():null,hourlyFunnel:liveMode?modelClient.funnel.report():null,dormant:dormant?.status()??null,candidateSources:extraSources?.status()??null,quoteDiagnostics:liveMode?quoteBroker.recent:null,agents,ownerAddress:auth.owner,ownerAuthenticated:auth.authenticated(req),feed:{...feed,markets:marketSnapshot.markets},rankings,radar:{scanned:radarSource.length,discovered:radarUniverse.length,minPairAgeHours:null,rising:rankings.filter(m=>m.dexId==='pumpswap'&&Number.isFinite(m.change5mPct)&&m.change5mPct>0).length,buyTargets:marketSnapshot.markets.filter(aiMarketEligible).length,updatedAt:feed.updatedAt,error:feed.error??null},...v,currentOrderSol:desk.orderSize(),allocationCapitalSol:desk.capital(),monitoring:desk.monitoring(),portfolio,storageMode,telegram:telegram.status(liveMode?desk.treasury.s:desk.meta),reporting:{sendAt:'23:59',timezone:'Asia/Ho_Chi_Minh',lastQueuedEnd:desk.meta.reportLastEnd,error:reports.error},dataset:dataset?.status()??{enabled:false},research:research.status(),strategyData:strategyData.status(),marketData:data.status(),uiRevision:uiAssets.revision,buildRevision:process.env.RAILWAY_GIT_COMMIT_SHA??'local',diagnostics:{counts,tokenEligibleCount:rankings.filter(m=>m.eligible).length,lastEvaluationAt:s.lastEvaluationAt,message:desk.migrationError??(!product.spotEntriesAllowed?product.message:liveMode?'Quy tắc V5.4, không gọi AI. AUTO theo rủi ro và bậc STANDARD/PROBE, không nghỉ BUY theo giờ, không xác nhận từng lệnh; giữ 0,05 SOL gas. Thiếu dữ liệu bắt buộc sẽ chặn và ghi rõ.':'Ví paper tham chiếu; thiếu dữ liệu hiển thị WAIT.'),topBlockers:[...reasons].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([reason,count])=>({reason,count}))}};
}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
async function body(req){let bytes=0;const parts=[];for await(const p of req){bytes+=p.length;if(bytes>4096)throw Error('Request too large');parts.push(p);}return JSON.parse(Buffer.concat(parts).toString()||'{}');}

const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),p=url.pathname;
 // No arbitrary signing or broadcasting endpoint; only the internal swap broker can sign.
 if(/^\/api\/(direct|live|signer)(\/|$)/.test(p)&&!(liveMode&&['/api/live/connect','/api/live/disconnect','/api/live/pause'].includes(p)))return json(res,410,{mode,realTradingEnabled:false,error:'Không có endpoint ký hoặc gửi giao dịch tùy ý.'});
 if(req.method==='GET'&&p==='/api/health'&&!auth.authenticated(req))return json(res,200,{status:'ok',buildRevision:process.env.RAILWAY_GIT_COMMIT_SHA??'local'});
 if(req.method==='GET'&&p==='/api/health')return json(res,200,{status:'ok',product,dataset:dataset?.status()??{enabled:false},rpcDiagnostics:execution.rpc?.rpcDiagnostics?.()??null,model:modelClient.status(),experiment:desk.state.experiment,workflowVersion:PAPER_WORKFLOW_VERSION,mode,activeBots:BOT_CONFIGS.map(c=>c.id),initialVirtualSol:liveMode?null:6,realTradingEnabled:liveMode&&product.spotEntriesAllowed&&desk.treasury.signingReady(),unattendedSigningAvailable:liveMode&&desk.treasury.status().unattendedSigningAvailable,signingMode:liveMode?'server-owner-signer':null,signer:liveMode?desk.treasury.vault.status():null,requiresWalletSignature:false,readOnly:!liveMode||!desk.treasury.signingReady(),running:desk.state.running,storageMode,heliusConfigured:market.heliusConfigured,rpcMode:market.rpcMode,signalTeamVersion:desk.agentVersion,strategyVersion:liveMode?desk.agentVersion:SCALP_STRATEGY_VERSION,entryPolicy:desk.state.entryPolicy,exitPolicy:desk.state.exitPolicy,sizingPolicy:desk.state.sizingPolicy,portfolioPolicy:desk.state.portfolioPolicy,marketReady:!!feed.updatedAt,uiRevision:uiAssets.revision,buildRevision:process.env.RAILWAY_GIT_COMMIT_SHA??'local'});
 if(req.method==='GET'&&p==='/api/research/candidates/status'){if(!auth.authenticated(req))return json(res,401,{error:'OWNER_AUTH_REQUIRED'});return json(res,200,candidateObserver?.status()??{enabled:false});}
 if(req.method==='GET'&&['/api/state','/api/activity'].includes(p)&&!auth.authenticated(req))return json(res,401,{code:'OWNER_AUTH_REQUIRED',error:'Đăng nhập ví chủ để xem dữ liệu tài khoản.'});
 if(req.method==='GET'&&p==='/api/activity')return json(res,200,activityState());
 if(req.method==='GET'&&p==='/api/state')return json(res,200,snapshot(req));
 if(req.method==='GET'&&p==='/api/auth/status')return json(res,200,{owner:auth.owner,authenticated:auth.authenticated(req),walletMode:liveMode?'server-owner-signer':'paper-admin',...(auth.authenticated(req)?{signerAvailable:liveMode&&desk.treasury.status().signer.configured}:{}),requiresWalletSignature:false});
 if(req.method==='POST'&&p.startsWith('/api/auth/')){if(!auth.sameOrigin(req))return json(res,403,{error:'Origin không hợp lệ.'});auth.limit(req.socket.remoteAddress??'unknown');const i=await body(req);if(p==='/api/auth/challenge')return json(res,200,auth.challenge(i.address));if(p==='/api/auth/login'){const t=auth.login(i.nonce,i.signature);res.setHeader('Set-Cookie',auth.cookie(t));if(liveMode)void modelClient.verify().catch(()=>{});return json(res,200,{authenticated:true,model:modelClient.status()});}if(p==='/api/auth/logout'){if(!auth.authenticated(req))return json(res,401,{code:'OWNER_AUTH_REQUIRED',error:'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'});if(liveMode)await desk.disconnectWallet();auth.logout(req);res.setHeader('Set-Cookie',auth.cookie(''));return json(res,200,{authenticated:false});}}
 // Keep the old paper URL working for cached UIs, but use the same typed control
 // handler in both modes. Missing input must never be treated as a resume.
 if(p==='/api/paper/pause'||liveMode&&p==='/api/live/pause'){
  if(!auth.authenticated(req))return json(res,401,{code:'OWNER_AUTH_REQUIRED',error:'Kết nối và xác thực ví chủ trước khi điều khiển bot.'});
  if(req.method!=='POST'||!auth.sameOrigin(req))return json(res,403,{code:'INVALID_ORIGIN_OR_METHOD',error:'Origin hoặc phương thức không hợp lệ.'});
  auth.limit('control:pause:'+(req.socket.remoteAddress??'unknown'));const i=await body(req);
  try{const paused=pausedValue(i);await desk.pause(paused);return json(res,200,{ok:true,mode,running:desk.state.running,paused:!desk.state.running});}
  catch(error){const result=controlError(error);return json(res,result.status,result.body);}
 }
 if(liveMode&&['/api/live/connect','/api/live/disconnect'].includes(p)){
  if(!auth.authenticated(req))return json(res,401,{code:'OWNER_AUTH_REQUIRED',error:'Kết nối và ký thông điệp xác thực ví chủ trước khi giao dịch.'});
  if(req.method!=='POST'||!auth.sameOrigin(req))return json(res,403,{code:'INVALID_ORIGIN_OR_METHOD',error:'Origin hoặc phương thức không hợp lệ.'});
  auth.limit(p+':'+(req.socket.remoteAddress??'unknown'));const i=await body(req);
  try{
   if(p==='/api/live/connect'){await desk.connectWallet();try{await telegram.restoreLegacy(desk.treasury.vault.keypair);}catch{telegram.error='Chưa khôi phục được token Telegram cũ; lưu lại Bot token để gửi về 1766285817.';}}
   else if(p==='/api/live/disconnect')await desk.disconnectWallet();
   else return json(res,404,{error:'Không có thao tác này.'});
   return json(res,200,{ok:true,live:desk.treasury.status(),model:modelClient.status(),requiresWalletSignature:false});
  }catch(error){const result=controlError(error);if(error.code?.startsWith('LIVE_SIGNER_'))result.body.diagnostics={buildRevision:process.env.RAILWAY_GIT_COMMIT_SHA??'local',signer:desk.treasury.vault.status()};return json(res,result.status,result.body);}
 }
 if(liveMode&&p==='/api/rules/ack'){if(req.method!=='POST'||!auth.sameOrigin(req)||!auth.authenticated(req))return json(res,403,{error:'OWNER_AUTH_REQUIRED'});auth.limit('rules-ack:'+(req.socket.remoteAddress??'unknown'));const i=await body(req);try{return json(res,200,modelClient.acknowledge(i.fingerprint));}catch(e){return json(res,409,{error:e.code??'RULES_ACK_REJECTED'});}}
 if(p==='/api/command')return json(res,403,{error:'Chỉ dùng điều khiển đã xác thực.'});
 if(p.startsWith('/api/paper/')||p.startsWith('/api/research')||p==='/api/export'){
  if(!auth.authenticated(req))return json(res,401,{error:'Xác thực ví chủ bằng ký thông điệp để điều khiển/xuất dữ liệu paper.'});
  if(req.method==='GET'){
   if(p==='/api/export'&&url.searchParams.get('format')==='dormant-csv'){res.setHeader('Content-Disposition','attachment; filename="dormant-breakout.csv"');res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Cache-Control':'no-store'});return res.end(dormant?.csv()??'unavailable\n');}
   if(p==='/api/export'){res.setHeader('Content-Disposition','attachment; filename="meme-pilot-'+mode+'-ledger.json"');return json(res,200,{...desk.state,candidateObserver:candidateObserver?.status()??{enabled:false},botStates:Object.fromEntries(desk.states),funnel:liveMode?modelClient.funnel.snapshot():null,hourlyFunnel:liveMode?modelClient.funnel.report():null,dormant:dormant?.status()??null,candidateSources:extraSources?.status()??null,quoteDiagnostics:liveMode?quoteBroker.recent:null,telegramOutbox:desk.state.telegramOutbox.map(({text,...m})=>m),exportedAt:Date.now()});}
   if(p==='/api/research')return json(res,200,{journal:research.status(),files:await research.files()});
   if(p==='/api/research/file'){const content=await research.document(url.searchParams.get('name'));res.writeHead(200,{'Content-Type':'application/gzip','Cache-Control':'no-store','Content-Disposition':'attachment; filename="paper-research.jsonl.gz"'});return res.end(content);}
   if(p==='/api/paper/report'){const {filename,content}=await reports.document({end:Number(url.searchParams.get('end')),part:Number(url.searchParams.get('part')??1)});res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','Content-Disposition':`attachment; filename="${filename}"`});return res.end(content);}
  }
  if(req.method!=='POST'||!auth.sameOrigin(req))return json(res,403,{error:'Origin hoặc phương thức không hợp lệ.'});
  auth.limit(req.socket.remoteAddress??'unknown');const i=await body(req);
  try{
   if(p==='/api/paper/telegram-config')await telegram.configure(i.token,i.chatId);
   else if(p==='/api/paper/telegram-unlock'||p==='/api/paper/telegram-migrate')return json(res,410,{code:'PASSWORD_REMOVED',error:'Không còn dùng mật khẩu. Lưu lại Bot token + Chat ID hoặc cấu hình bằng Railway Variables.'});
   else if(p==='/api/paper/telegram-test')await telegram.send(liveMode?'Meme Pilot · LIVE · Quy tắc V5.0. Báo cáo SOL thật, ký server tự động; không dùng AI.':'Meme Pilot · PAPER · RULES. Kết nối báo cáo thành công.');
   else return json(res,404,{error:'Không có thao tác này.'});
   return json(res,200,{ok:true,telegram:telegram.status(liveMode?desk.treasury.s:desk.state)});
  }finally{i.token='';i.password='';}
 }
 if(req.method==='GET'&&uiAssets.get(p)){const asset=uiAssets.get(p);res.writeHead(200,{'Content-Type':asset.type+'; charset=utf-8','Cache-Control':uiAssets.isVersioned(p)&&asset.type!=='text/html'?'public, max-age=31536000, immutable':'no-store','X-UI-Revision':uiAssets.revision,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});return res.end(asset.content);}
 return json(res,404,{error:'Không tìm thấy.'});
 }catch(error){if(error.code==='RATE_LIMITED'){const result=controlError(error);res.setHeader('Retry-After',String(result.body.retryAfterSeconds??60));return json(res,result.status,result.body);}json(res,400,{error:'Không thực hiện được yêu cầu; kiểm tra xác thực, mật khẩu hoặc dữ liệu đầu vào.'});}});
await extraSources?.start();
const host=process.env.HOST??(onRailway?'0.0.0.0':'127.0.0.1');
server.listen(Number(process.env.PORT??3000),host,()=>{if(!auth.origin)auth.origin=`http://127.0.0.1:${server.address().port}`;desk.start();console.log(`Meme Desk listening on ${host}:${server.address().port} — ${mode.toUpperCase()} / ${liveMode?modelClient.status().name+' / server owner signer':'PAPER'}`);});
server.on('error',async error=>{console.error('paper HTTP',error.message);loops.forEach(l=>l.stop());await desk.stop();process.exit(1);});
let lastArchivedSnapshot=null;
const loops=[...(candidateObserver?[startPaperLoop(()=>{observeCandidates(candidateObserver,'markets',data.snapshot().markets,desk.evidence?.factsCache);observeCandidates(candidateObserver,'enqueue',{kind:'load',row:{busy:quoteBroker.active>0||quoteBroker.queue.length>0||Object.values(desk.treasury.s.orders).some(o=>!o.terminal)}});},1000,{onError:()=>{}})]:[]),...(liveMode?[startPaperLoop(async()=>{const m=await runtimeMemory(desk.supervisor);console.info('RUNTIME MEMORY '+JSON.stringify({...m,quoteLocks:modelClient.reservations.rows.size,ipcPending:[...(desk.supervisor?.workers.values()??[])].reduce((n,r)=>n+(r.latestIpc?.pending.size??0),0),dormantTracked:dormant.history.size,dormantEvents:dormant.events.length}));},60000,{onError:error=>desk.error(error)}),startPaperLoop(async()=>{const snap=data.snapshot(),markets=await dormantFlow.enrichCached(snap.markets);observeCandidates(candidateObserver,'markets',markets,desk.evidence?.factsCache);dormant.tick({...snap,markets});},1000,{onError:error=>desk.error(error)}),startPaperLoop(()=>desk.refreshRunnerDepth(),1000,{onError:error=>desk.error(error)}),startPaperLoop(()=>extraSources.tick(),3000,{onError:error=>desk.error(error)}),startPaperLoop(()=>desk.healthTick(),10000,{onError:error=>desk.error(error)}),startPaperLoop(()=>console.info('RULES FUNNEL '+JSON.stringify(modelClient.funnel.report())),300000,{onError:error=>desk.error(error)})]:[]),...(liveMode?[startPaperLoop(()=>desk.pulse(),2000,{onError:error=>desk.error(error)})]:[]),startPaperLoop(refresh,5000,{onError:error=>desk.error(error)}),startPaperLoop(enrichStrategyData,1000,{onError:error=>desk.error(error)}),startPaperLoop(updatePrices,1000,{onError:error=>desk.error(error)}),startPaperLoop(()=>{const snap=desk.publish();dataset?.sample(snap,desk.treasury.s);if(snap.snapshotId!==lastArchivedSnapshot){research.enqueue({type:'paper_replay_snapshot',at:Date.now(),snapshot:snap});lastArchivedSnapshot=snap.snapshotId;}},1000,{onError:error=>desk.error(error)}),startPaperLoop(async()=>{await reports.tick(desk);if(liveMode)await desk.reportSerial(async()=>{const batch=desk.meta.telegramOutbox.filter(m=>m.status==='queued');if(batch.length){await desk.treasury.serial(async()=>{desk.treasury.s.telegramOutbox??=[];for(const m of batch)if(!desk.treasury.s.telegramOutbox.some(x=>x.id===m.id))desk.treasury.s.telegramOutbox.push(m);await desk.treasury.save();});for(const m of batch)m.status='transferred';await desk.save();}});await telegram.tick(transport);},2000,{onError:error=>desk.error(error)}),startPaperLoop(()=>research.flush(),3100,{onError:error=>desk.error(error)})];
async function shutdown(signal='requested'){if(closing)return;closing=true;console.info('RUNTIME SHUTDOWN '+JSON.stringify({signal,at:Date.now()}));loops.forEach(l=>l.stop());server.close();await Promise.all(loops.map(l=>l.done));await extraSources?.stop();await desk.stop();await research.flush();await dataset?.close();await dormant?.saveJob;await candidateObserver?.close();process.exit(0);}
process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
process.on('uncaughtExceptionMonitor',error=>console.error('RUNTIME FATAL '+JSON.stringify({name:error?.name??'Error',at:Date.now()})));
