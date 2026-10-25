import {AI_POLICY} from './autonomous-policy.js';
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
import {AutomaticFleet} from './automatic-fleet.js';
import {SolanaExecution} from './solana.js';
import {controlError,pausedValue} from './control-errors.js';
const liveMode=process.env.TRADING_MODE==='live',mode=liveMode?'live':'paper';
const uiAssets=await createPaperAssets(new URL('../public/',import.meta.url),{mode});
const root=fileURLToPath(new URL('../',import.meta.url)),dataDir=await initializeStorage(root),dir=path.join(dataDir,liveMode?'live':'paper20');await mkdir(dir,{recursive:true,mode:0o700});
const onRailway=!!(process.env.RAILWAY_SERVICE_ID||process.env.RAILWAY_ENVIRONMENT_ID),storageMode=process.env.RAILWAY_VOLUME_MOUNT_PATH?'persistent-volume':onRailway?'ephemeral':'local-disk';
const auth=new OwnerAuth({origin:process.env.PUBLIC_ORIGIN??(onRailway?'https://'+(process.env.RAILWAY_PUBLIC_DOMAIN??'trade-meme-production.up.railway.app'):null)});
const execution=new SolanaExecution(),market=createPaperMarket(()=>({cashSol:0,positions:[]}),execution),data=new MarketData(market),modelClient=new PaperModelClient({env:liveMode?{...process.env,MODEL_TRADING_ENABLED:'true'}:process.env}),desk=liveMode?new AutomaticFleet(dir,data,{modelClient,execution,legacyDir:dataDir,storageMode}):new PaperDesk(dir,data,{modelClient});await desk.load();
const research=new ResearchJournal(dir),reports=new PaperReports(dir,research),telegram=new WalletTelegram(path.join(dataDir,'paper20'),dataDir,globalThis.fetch,{chatId:liveMode?AI_POLICY.telegramChatId:null});await telegram.load();
data.onExecution=row=>research.enqueue({type:'paper_replay_execution',at:Date.now(),...row});
const transport={retryForever:liveMode,get state(){return liveMode?desk.treasury.s:desk.meta;},vault:{keypair:null},serial:fn=>liveMode?desk.treasury.serial(fn):desk.reportSerial(fn),save:()=>liveMode?desk.treasury.save():desk.save(),training:reports};
const discovery=new DiscoveryQueue(desk.meta.discovery);
let refreshing=false,closing=false,feed=data.feed;
const rankMarket=(m,_settings,now=Date.now())=>{if(liveMode)return {mint:m.mint,symbol:m.symbol,score:null,minScore:0,roughEligible:true,eligible:false,blockingStage:'model',primaryReasons:['AI tự quyết BUY/SELL/HOLD; không áp dụng điểm/bộ lọc chiến lược cũ'],checks:[]};const rows=BOT_CONFIGS.map(c=>independentSignal(c,m,now,{liquidityCutoff:0}));return rows.sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.conditionRatio-a.conditionRatio||b.score-a.score)[0].rank;};
const compareMarkets=(a,b)=>liveMode?(b.volume5mUsd??0)-(a.volume5mUsd??0)||a.mint.localeCompare(b.mint):compare5m(a,b);
const selectMarkets=(rows,limit=60)=>liveMode?[...rows].sort(compareMarkets).slice(0,limit):[...rows].sort((a,b)=>rankMarket(b).score-rankMarket(a).score||compare5m(a,b)).slice(0,limit);
const strategyData=new StrategyDataFeed(market,{selectTargets:rows=>rows.filter(m=>m.dexId==='pumpswap'&&(liveMode||m.liquidityUsd>=3000)).map(m=>({...m,needCandles:true,needFlow:liveMode||m.change5mPct>=2&&m.buys5m/Math.max(1,m.sells5m)>=1.1})).sort((a,b)=>{const ca=strategyData.cache.get(a.mint+':'+a.pairAddress),cb=strategyData.cache.get(b.mint+':'+b.pairAddress);return (ca?.candleAttemptAt??0)-(cb?.candleAttemptAt??0)||a.mint.localeCompare(b.mint);})});
async function refresh(){
 if(closing)return;refreshing=true;try{const held=desk.state.positions,latest=await loadMarkets([...new Set(held.map(p=>p.mint))],Object.fromEntries(held.map(p=>[p.mint,p.pairAddress])),discovery,{rankMarket,compare:compareMarkets,selectMarkets});latest.markets=strategyData.applyCached(latest.markets);data.setFeed(latest);feed=data.feed;desk.meta.discovery=discovery.snapshot();research.scan(feed,{rankMarket});await desk.reportSerial(()=>desk.save());}
 catch(error){desk.error(error);data.feed={...data.feed,error:'Market API/RPC chưa phản hồi; dữ liệu giữ nguyên timestamp.'};feed=data.feed;}finally{refreshing=false;}
}
async function enrichStrategyData(){if(closing||!data.feed.updatedAt)return;const current=data.feed,markets=await strategyData.enrichCached(current.markets);if(data.feed===current){const fingerprint=rows=>JSON.stringify(rows.map(m=>[m.mint,m.strategyData?.candleFetchedAt,m.strategyData?.flow?.checkedAt]));if(fingerprint(markets)!==fingerprint(current.markets))data.featureRevision++;data.feed={...current,markets};feed=data.feed;}}
async function updatePrices(){
 const snap=data.snapshot(),held=desk.state.positions.map(p=>snap.markets.find(m=>m.mint===p.mint&&m.pairAddress===p.pairAddress)??{...p,dexId:'pumpswap'}),watch=snap.markets.filter(m=>liveMode||BOT_CONFIGS.some(c=>independentSignal(c,m,Date.now(),{liquidityCutoff:0}).conditionRatio>=.7));
 const targets=[...new Map([...held,...watch].map(m=>[m.mint+':'+m.pairAddress,m])).values()];await data.pricesFor(targets);desk.publish();
}
function activityState(){const s=desk.state;return {observedAt:Date.now(),scanning:refreshing,scanCompletedAt:s.lastEvaluationAt,verification:[],market:market.activity,strategyData:strategyData.status(),pending:s.pending,pendingEntries:s.pendingEntries,reporting:reports.busy,telegram:telegram.busy,reportQueuedEnd:desk.meta.reportLastEnd,lastSentAt:Math.max(0,...(liveMode?desk.treasury.s.telegramOutbox??[]:desk.meta.telegramOutbox).filter(m=>m.status==='sent').map(m=>m.sentAt??0))};}
function snapshot(req){
 const s=desk.state,v=desk.valuation(),portfolio=desk.admission(),agents=desk.snapshot(),rankings=data.snapshot().markets.map(m=>({...m,...rankMarket(m)})).sort(compare5m),counts={},reasons=new Map();
 for(const a of agents.agents)for(const d of a.signal?.decisions??[]){counts[d.stage]=(counts[d.stage]??0)+1;if(d.stage!=='ready')reasons.set(d.reason,(reasons.get(d.reason)??0)+1);}
 return {...s,telegramOutbox:undefined,legacyHistory:undefined,mode,readOnly:!liveMode||!desk.treasury.signingReady(),realTradingEnabled:liveMode&&desk.treasury.signingReady(),model:modelClient.status(),agents,ownerAddress:auth.owner,ownerAuthenticated:auth.authenticated(req),feed:{...feed,markets:data.snapshot().markets},rankings,...v,currentOrderSol:desk.orderSize(),allocationCapitalSol:desk.capital(),monitoring:desk.monitoring(),portfolio,storageMode,telegram:telegram.status(liveMode?desk.treasury.s:desk.meta),reporting:{sendAt:'23:59',timezone:'Asia/Ho_Chi_Minh',lastQueuedEnd:desk.meta.reportLastEnd,error:reports.error},research:research.status(),strategyData:strategyData.status(),marketData:data.status(),uiRevision:uiAssets.revision,buildRevision:process.env.RAILWAY_GIT_COMMIT_SHA??'local',diagnostics:{counts,tokenEligibleCount:rankings.filter(m=>m.eligible).length,lastEvaluationAt:s.lastEvaluationAt,message:desk.migrationError??(liveMode?'Một AI tự quyết BUY/SELL/HOLD · tối đa 90% SOL/lệnh · giữ 0,05 SOL gas.':'Ví paper tham chiếu; thiếu dữ liệu hiển thị WAIT.'),topBlockers:[...reasons].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([reason,count])=>({reason,count}))}};
}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
async function body(req){let bytes=0;const parts=[];for await(const p of req){bytes+=p.length;if(bytes>4096)throw Error('Request too large');parts.push(p);}return JSON.parse(Buffer.concat(parts).toString()||'{}');}

const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),p=url.pathname;
 // No arbitrary signing or broadcasting endpoint; only the internal swap broker can sign.
 if(/^\/api\/(direct|live|signer)(\/|$)/.test(p)&&!(liveMode&&['/api/live/connect','/api/live/disconnect','/api/live/pause'].includes(p)))return json(res,410,{mode,realTradingEnabled:false,error:'Không có endpoint ký hoặc gửi giao dịch tùy ý.'});
 if(req.method==='GET'&&p==='/api/health')return json(res,200,{status:'ok',model:modelClient.status(),experiment:desk.state.experiment,workflowVersion:PAPER_WORKFLOW_VERSION,mode,activeBots:BOT_CONFIGS.map(c=>c.id),initialVirtualSol:liveMode?null:6,realTradingEnabled:liveMode&&desk.treasury.signingReady(),unattendedSigningAvailable:liveMode&&desk.treasury.status().unattendedSigningAvailable,signingMode:liveMode?'server-owner-signer':null,signer:liveMode?desk.treasury.vault.status():null,requiresWalletSignature:false,readOnly:!liveMode||!desk.treasury.signingReady(),running:desk.state.running,storageMode,heliusConfigured:market.heliusConfigured,rpcMode:market.rpcMode,signalTeamVersion:desk.agentVersion,strategyVersion:SCALP_STRATEGY_VERSION,entryPolicy:desk.state.entryPolicy,exitPolicy:desk.state.exitPolicy,sizingPolicy:desk.state.sizingPolicy,portfolioPolicy:desk.state.portfolioPolicy,marketReady:!!feed.updatedAt,uiRevision:uiAssets.revision,buildRevision:process.env.RAILWAY_GIT_COMMIT_SHA??'local'});
 if(req.method==='GET'&&p==='/api/activity')return json(res,200,activityState());
 if(req.method==='GET'&&p==='/api/state')return json(res,200,snapshot(req));
 if(req.method==='GET'&&p==='/api/auth/status')return json(res,200,{owner:auth.owner,authenticated:auth.authenticated(req),walletMode:liveMode?'server-owner-signer':'paper-admin',signerAvailable:liveMode&&desk.treasury.status().signer.configured,requiresWalletSignature:false});
 if(req.method==='POST'&&p.startsWith('/api/auth/')){if(!auth.sameOrigin(req))return json(res,403,{error:'Origin không hợp lệ.'});auth.limit(req.socket.remoteAddress??'unknown');const i=await body(req);if(p==='/api/auth/challenge')return json(res,200,auth.challenge(i.address));if(p==='/api/auth/login'){const t=auth.login(i.nonce,i.signature);res.setHeader('Set-Cookie',auth.cookie(t));if(liveMode)void modelClient.verify().catch(()=>{});return json(res,200,{authenticated:true,model:modelClient.status()});}if(p==='/api/auth/logout'){if(liveMode)await desk.disconnectWallet();auth.logout(req);res.setHeader('Set-Cookie',auth.cookie(''));return json(res,200,{authenticated:false});}}
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
 if(p==='/api/command')return json(res,403,{error:'Chỉ dùng điều khiển đã xác thực.'});
 if(p.startsWith('/api/paper/')||p.startsWith('/api/research')||p==='/api/export'){
  if(!auth.authenticated(req))return json(res,401,{error:'Xác thực ví chủ bằng ký thông điệp để điều khiển/xuất dữ liệu paper.'});
  if(req.method==='GET'){
   if(p==='/api/export'){res.setHeader('Content-Disposition','attachment; filename="meme-pilot-'+mode+'-ledger.json"');return json(res,200,{...desk.state,botStates:Object.fromEntries(desk.states),telegramOutbox:desk.state.telegramOutbox.map(({text,...m})=>m),exportedAt:Date.now()});}
   if(p==='/api/research')return json(res,200,{journal:research.status(),files:await research.files()});
   if(p==='/api/research/file'){const content=await research.document(url.searchParams.get('name'));res.writeHead(200,{'Content-Type':'application/gzip','Cache-Control':'no-store','Content-Disposition':'attachment; filename="paper-research.jsonl.gz"'});return res.end(content);}
   if(p==='/api/paper/report'){const {filename,content}=await reports.document({end:Number(url.searchParams.get('end')),part:Number(url.searchParams.get('part')??1)});res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','Content-Disposition':`attachment; filename="${filename}"`});return res.end(content);}
  }
  if(req.method!=='POST'||!auth.sameOrigin(req))return json(res,403,{error:'Origin hoặc phương thức không hợp lệ.'});
  auth.limit(req.socket.remoteAddress??'unknown');const i=await body(req);
  try{
   if(p==='/api/paper/telegram-config')await telegram.configure(i.token,i.chatId);
   else if(p==='/api/paper/telegram-unlock'||p==='/api/paper/telegram-migrate')return json(res,410,{code:'PASSWORD_REMOVED',error:'Không còn dùng mật khẩu. Lưu lại Bot token + Chat ID hoặc cấu hình bằng Railway Variables.'});
   else if(p==='/api/paper/telegram-test')await telegram.send(liveMode?'Meme Pilot · LIVE · AI. Báo cáo SOL thật; AI tự chọn BUY/SELL/HOLD và cỡ lệnh từ ví chung.':'Meme Pilot · PAPER · AI. Kết nối báo cáo thành công.');
   else return json(res,404,{error:'Không có thao tác này.'});
   return json(res,200,{ok:true,telegram:telegram.status(liveMode?desk.treasury.s:desk.state)});
  }finally{i.token='';i.password='';}
 }
 if(req.method==='GET'&&uiAssets.get(p)){const asset=uiAssets.get(p);res.writeHead(200,{'Content-Type':asset.type+'; charset=utf-8','Cache-Control':uiAssets.isVersioned(p)&&asset.type!=='text/html'?'public, max-age=31536000, immutable':'no-store','X-UI-Revision':uiAssets.revision,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});return res.end(asset.content);}
 return json(res,404,{error:'Không tìm thấy.'});
 }catch(error){if(error.code==='RATE_LIMITED'){const result=controlError(error);res.setHeader('Retry-After',String(result.body.retryAfterSeconds??60));return json(res,result.status,result.body);}json(res,400,{error:'Không thực hiện được yêu cầu; kiểm tra xác thực, mật khẩu hoặc dữ liệu đầu vào.'});}});
const host=process.env.HOST??(onRailway?'0.0.0.0':'127.0.0.1');
server.listen(Number(process.env.PORT??3000),host,()=>{if(!auth.origin)auth.origin=`http://127.0.0.1:${server.address().port}`;desk.start();console.log(`Meme Desk listening on ${host}:${server.address().port} — ${mode.toUpperCase()} / SINGLE AI / AI autonomously signs server-authorized swaps`);});
server.on('error',async error=>{console.error('paper HTTP',error.message);loops.forEach(l=>l.stop());await desk.stop();process.exit(1);});
let lastArchivedSnapshot=null;
const loops=[...(liveMode?[startPaperLoop(()=>desk.pulse(),2000,{onError:error=>desk.error(error)})]:[]),startPaperLoop(refresh,5000,{onError:error=>desk.error(error)}),startPaperLoop(enrichStrategyData,1000,{onError:error=>desk.error(error)}),startPaperLoop(updatePrices,1000,{onError:error=>desk.error(error)}),startPaperLoop(()=>{const snap=desk.publish();if(snap.snapshotId!==lastArchivedSnapshot){research.enqueue({type:'paper_replay_snapshot',at:Date.now(),snapshot:snap});lastArchivedSnapshot=snap.snapshotId;}},1000,{onError:error=>desk.error(error)}),startPaperLoop(async()=>{await reports.tick(desk);if(liveMode)await desk.reportSerial(async()=>{const batch=desk.meta.telegramOutbox.filter(m=>m.status==='queued');if(batch.length){await desk.treasury.serial(async()=>{desk.treasury.s.telegramOutbox??=[];for(const m of batch)if(!desk.treasury.s.telegramOutbox.some(x=>x.id===m.id))desk.treasury.s.telegramOutbox.push(m);await desk.treasury.save();});for(const m of batch)m.status='transferred';await desk.save();}});await telegram.tick(transport);},2000,{onError:error=>desk.error(error)}),startPaperLoop(()=>research.flush(),3100,{onError:error=>desk.error(error)})];
async function shutdown(){if(closing)return;closing=true;loops.forEach(l=>l.stop());server.close();await Promise.all(loops.map(l=>l.done));await desk.stop();await research.flush();process.exit(0);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
