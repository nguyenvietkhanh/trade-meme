import http from 'node:http';
import path from 'node:path';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {initializeStorage} from './storage.js';
import {PaperDesk,PAPER_MODEL} from './paper-desk.js';
import {PaperReports} from './paper-reports.js';
import {PaperTelegram} from './paper-telegram.js';
import {createPaperMarket} from './paper-market.js';
import {ResearchJournal} from './research-journal.js';
import {OwnerAuth} from './security.js';
import {loadMarkets} from './market.js';
import {DiscoveryQueue} from './discovery.js';
import {VerificationFeed} from './verification.js';
import {scannerMarkets,SCAN_RULES} from './scanner.js';
import {observeMarkets} from './signals.js';
import {rankPaperMarket as rankMarket,observePaperEligibility} from './paper-policy.js';
import {observePaperOutcomes} from './paper-outcomes.js';
import {withRpcPriority} from './rpc-priority.js';
import {walletOrderSol} from './desk-rules.js';
import {SCALP_STRATEGY_VERSION,compare5m} from './paper-scalp.js';
import {explainPaperStatus} from './ui-activity.js';
const root=fileURLToPath(new URL('../',import.meta.url)),dataDir=await initializeStorage(root),dir=path.join(dataDir,'paper20');await mkdir(dir,{recursive:true,mode:0o700});
const onRailway=!!(process.env.RAILWAY_SERVICE_ID||process.env.RAILWAY_ENVIRONMENT_ID),storageMode=process.env.RAILWAY_VOLUME_MOUNT_PATH?'persistent-volume':onRailway?'ephemeral':'local-disk';
const auth=new OwnerAuth({origin:process.env.PUBLIC_ORIGIN??(onRailway?'https://'+(process.env.RAILWAY_PUBLIC_DOMAIN??'trade-meme-production.up.railway.app'):null)});
let desk;const market=createPaperMarket(()=>desk.state.cashSol);desk=new PaperDesk(dir,market);await desk.load();
const research=new ResearchJournal(dir);desk.research=research;const reports=new PaperReports(dir,research),telegram=new PaperTelegram(dir,dataDir);await telegram.load();
const transport={get state(){return desk.state;},vault:{keypair:null},serial:fn=>desk.serial(fn),save:()=>desk.save(),training:reports};
const verification=new VerificationFeed(globalThis.fetch,market,{rankMarket,ignoreH4:true,compareCandidates:compare5m,cacheMs:10000}),discovery=new DiscoveryQueue(desk.state.discovery);
let feed={markets:[],solUsd:null,updatedAt:null,error:null},refreshing=false,closing=false;
async function refresh(){if(refreshing||closing)return;refreshing=true;try{
 const held=desk.state.positions,latest=await withRpcPriority('background',()=>loadMarkets([...new Set([...held.map(p=>p.mint),...desk.state.watchlist])],Object.fromEntries(held.map(p=>[p.mint,p.pairAddress])),discovery,{rankMarket,compare:compare5m}));
 latest.markets=scannerMarkets(desk.state,latest.markets);latest.markets=await withRpcPriority('background',()=>verification.enrichCached(latest.markets,held.map(p=>p.mint)));
 await desk.serial(async()=>{latest.markets=observePaperEligibility(desk.state,observeMarkets(desk.state,latest.markets));observePaperOutcomes(desk.state,latest.markets,research);feed={...latest,error:null};desk.evaluate(feed.markets);const bucket=desk.bucket();bucket.sourceWarnings??={};for(const warning of feed.warnings??[])bucket.sourceWarnings[warning]=(bucket.sourceWarnings[warning]??0)+1;research.scan(feed);research.enqueue({type:'paper_5m_gainers_scan',at:Date.now(),rows:feed.markets.map(m=>{const r=rankMarket(m);return {mint:m.mint,pairAddress:m.pairAddress,score:r.score,policyVersion:r.policyVersion,scoreParts:r.scoreParts,change5mPct:m.change5mPct,scalpSetup:m.scalpSetup,action:r.eligible?'WATCH':'SKIP',stage:r.blockingStage,flags:r.red_flags,baseline:r.baseline,relaxedFlags:r.relaxedFlags};})});desk.state.discovery=discovery.snapshot();await desk.save();});
 }catch{feed={...feed,error:'Market API/RPC chưa phản hồi; không tạo dữ liệu thay thế.'};await desk.serial(async()=>{desk.error(Error('RPC market feed'));await desk.save();});}finally{refreshing=false;}}
function activityState(){const s=desk.state;return {observedAt:Date.now(),scanning:refreshing,scanCompletedAt:s.lastEvaluationAt??null,verification:[...verification.jobs.keys()].map(key=>({mint:key.split(':')[0]})),market:market.activity,pending:s.pending?{id:s.pending.id,side:s.pending.side,mint:s.pending.mint}:null,reporting:reports.busy,telegram:telegram.busy,reportQueuedEnd:s.reportLastEnd,lastSentAt:Math.max(0,...s.telegramOutbox.filter(m=>m.status==='sent').map(m=>m.sentAt??0))};}
function snapshot(req){const s=desk.state,v=desk.valuation(),rankings=feed.markets.map(m=>({...m,...rankMarket(m,s.settings)})).sort(compare5m),counts={};for(const m of rankings)counts[m.blockingStage]=(counts[m.blockingStage]??0)+1;
 return {...s,pending:s.pending?{side:s.pending.side,mint:s.pending.mint,reason:s.pending.reason,decisionAt:s.pending.decisionAt}:null,archiveOutbox:undefined,telegramOutbox:undefined,periods:undefined,observations:undefined,paperObservations:undefined,paperOutcomes:undefined,paperOutcomeSeeds:undefined,marks:undefined,mode:'paper',readOnly:true,realTradingEnabled:false,ownerAuthenticated:auth.authenticated(req),feed,rankings,...v,pnlSol:v.equitySol===null?null:v.equitySol-20,currentOrderSol:walletOrderSol(s.cashSol),storageMode,telegram:telegram.status(s),reporting:{sendAt:'23:00',timezone:'Asia/Ho_Chi_Minh',lastQueuedEnd:s.reportLastEnd,error:reports.error},research:research.status(),buildRevision:process.env.RAILWAY_GIT_COMMIT_SHA??'local',diagnostics:{counts,...explainPaperStatus(s,feed,rankings,v)}};
}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
async function body(req){let bytes=0;const parts=[];for await(const p of req){bytes+=p.length;if(bytes>4096)throw Error('Request too large');parts.push(p);}return JSON.parse(Buffer.concat(parts).toString()||'{}');}
const assets={'/':['paper.html','text/html'],'/paper.js':['paper.js','text/javascript'],'/paper-wallet.js':['paper-wallet.js','text/javascript'],'/style.css':['style.css','text/css'],'/activity.js':['activity.js','text/javascript']};
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),p=url.pathname;
 // Enforced before authentication or body parsing: no production route can reach a real signer.
 if(/^\/api\/(direct|live|signer)(\/|$)/.test(p))return json(res,410,{mode:'paper',realTradingEnabled:false,error:'Đã chuyển hẳn sang mô phỏng; giao dịch SOL thật bị vô hiệu hóa.'});
 if(req.method==='GET'&&p==='/api/health')return json(res,200,{status:'ok',mode:'paper',initialVirtualSol:20,realTradingEnabled:false,unattendedSigningAvailable:false,signingMode:null,readOnly:true,running:desk.state.running,storageMode,heliusConfigured:market.heliusConfigured,rpcMode:market.rpcMode,strategyVersion:SCALP_STRATEGY_VERSION,entryPolicy:desk.state.entryPolicy,exitPolicy:desk.state.exitPolicy,marketReady:!!feed.updatedAt,buildRevision:process.env.RAILWAY_GIT_COMMIT_SHA??'local'});
 if(req.method==='GET'&&p==='/api/activity')return json(res,200,activityState());
 if(req.method==='GET'&&p==='/api/state')return json(res,200,snapshot(req));
 if(req.method==='GET'&&p==='/api/auth/status')return json(res,200,{owner:auth.owner,authenticated:auth.authenticated(req),walletMode:'paper-admin',signerAvailable:false});
 if(req.method==='POST'&&p.startsWith('/api/auth/')){if(!auth.sameOrigin(req))return json(res,403,{error:'Origin không hợp lệ.'});auth.limit(req.socket.remoteAddress??'unknown');const i=await body(req);if(p==='/api/auth/challenge')return json(res,200,auth.challenge(i.address));if(p==='/api/auth/login'){const t=auth.login(i.nonce,i.signature);res.setHeader('Set-Cookie',auth.cookie(t));return json(res,200,{authenticated:true});}if(p==='/api/auth/logout'){auth.logout(req);res.setHeader('Set-Cookie',auth.cookie(''));return json(res,200,{authenticated:false});}}
 if(p==='/api/command')return json(res,403,{error:'Chỉ dùng điều khiển paper đã xác thực.'});
 if(p.startsWith('/api/paper/')||p.startsWith('/api/research')||p==='/api/export'){
  if(!auth.authenticated(req))return json(res,401,{error:'Xác thực ví chủ bằng ký thông điệp để điều khiển/xuất dữ liệu paper.'});
  if(req.method==='GET'){
   if(p==='/api/export'){res.setHeader('Content-Disposition','attachment; filename="meme-pilot-paper20-ledger.json"');return json(res,200,{...desk.state,telegramOutbox:desk.state.telegramOutbox.map(({text,...m})=>m),exportedAt:Date.now()});}
   if(p==='/api/research')return json(res,200,{journal:research.status(),files:await research.files()});
   if(p==='/api/research/file'){const content=await research.document(url.searchParams.get('name'));res.writeHead(200,{'Content-Type':'application/gzip','Cache-Control':'no-store','Content-Disposition':'attachment; filename="paper-research.jsonl.gz"'});return res.end(content);}
   if(p==='/api/paper/report'){const {filename,content}=await reports.document({end:Number(url.searchParams.get('end')),part:Number(url.searchParams.get('part')??1)});res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','Content-Disposition':`attachment; filename="${filename}"`});return res.end(content);}
  }
  if(req.method!=='POST'||!auth.sameOrigin(req))return json(res,403,{error:'Origin hoặc phương thức không hợp lệ.'});
  auth.limit(req.socket.remoteAddress??'unknown');const i=await body(req);
  try{
   if(p==='/api/paper/telegram-config')await telegram.configurePaper(i.token,i.chatId,i.password);
   else if(p==='/api/paper/telegram-unlock')await telegram.open(i.password);
   else if(p==='/api/paper/telegram-migrate')await telegram.migrate(i.password);
   else if(p==='/api/paper/telegram-test')await telegram.send('Meme Pilot · MÔ PHỎNG 20 SOL. Kết nối báo cáo thành công; không giao dịch SOL thật.');
   else if(p==='/api/paper/pause')await desk.serial(async()=>{desk.state.running=i.paused!==true;await desk.save();});
   else return json(res,404,{error:'Không có thao tác này.'});
   return json(res,200,{ok:true,telegram:telegram.status(desk.state)});
  }finally{i.token='';i.password='';}
 }
 if(req.method==='GET'&&assets[p]){const [name,type]=assets[p];res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});return res.end(await readFile(path.join(root,'public',name)));}
 return json(res,404,{error:'Không tìm thấy.'});
 }catch{json(res,400,{error:'Không thực hiện được yêu cầu; kiểm tra xác thực, mật khẩu hoặc dữ liệu đầu vào.'});}});
const host=process.env.HOST??(onRailway?'0.0.0.0':'127.0.0.1');
server.listen(Number(process.env.PORT??3000),host,()=>{if(!auth.origin)auth.origin=`http://127.0.0.1:${server.address().port}`;console.log(`Meme Desk listening on ${host}:${server.address().port} — PAPER 20 SOL / REAL TRADING DISABLED`);refresh();});
const timers=[setInterval(refresh,SCAN_RULES.intervalMs),setInterval(()=>desk.step(feed).catch(()=>{}),2000),setInterval(async()=>{await reports.tick(desk);await telegram.tick(transport);},2000),setInterval(()=>research.flush(),3100)];
async function shutdown(){if(closing)return;closing=true;timers.forEach(clearInterval);server.close();await desk.serial(()=>desk.save());await research.flush();process.exit(0);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
