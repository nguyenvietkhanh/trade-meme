import http from 'node:http';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {DEFAULTS,PROFILE,freshState,equity,event,buy,sell,tick} from './engine.js';
import {loadMarkets} from './market.js';
import {DiscoveryQueue} from './discovery.js';
import {rankMarket,decideMarket} from './strategy.js';
import {SCAN_RULES,initializeScanner,scannerMarkets,recordEvaluation} from './scanner.js';
import {diagnose} from './diagnostics.js';
import {observeMarkets} from './signals.js';
import {OwnerAuth,DEFAULT_OWNER} from './security.js';
import {SolanaExecution} from './solana.js';
import {DirectWallet} from './direct-wallet.js';
import {VerificationFeed} from './verification.js';
import {STRATEGY_VERSION} from './desk-rules.js';
import {OwnerAgent,signerRequestAllowed} from './owner-agent.js';
import {initializeStorage} from './storage.js';

// Railway may use the Docker/npm entry point instead of the configured wrapper.
// Mainnet is the default product. The paper engine is isolated to explicit test workspaces.
const liveOnly=process.env.PAPER_WORKSPACE!=='true';
const onRailway=Boolean(process.env.RAILWAY_SERVICE_ID||process.env.RAILWAY_ENVIRONMENT_ID);
const readOnly=onRailway||process.env.PUBLIC_READ_ONLY==='true';
const root=fileURLToPath(new URL('../',import.meta.url));
const dataDir=await initializeStorage(root);
const statePath=path.join(dataDir,liveOnly?'scanner-state.json':'paper-state.json');
let state;
try {state=JSON.parse(await readFile(statePath,'utf8'));if(![1,2].includes(state.version)) throw Error('Unsupported state version');
 if(state.profile!==PROFILE){
  await writeFile(path.join(dataDir,`archive-profile-${Date.now()}.json`),JSON.stringify(state,null,2),{mode:0o600});
  const previous=state;state=freshState();state.watchlist=previous.watchlist??[];state.automationRequested=previous.automationRequested??false;event(state,'Đã lưu trữ phiên mô phỏng cũ và tạo phiên mới với cấu hình 0,3 SOL / lệnh 0,03 SOL / chốt lời từng phần.');
 }}
catch(e) {if(e.code!=='ENOENT') throw e;state=freshState();}
// Restart pauses until a fresh feed arrives; explicitly requested automation then resumes.
state.running=false;
state.automationRequested??=false;
if(onRailway||process.env.PAPER_AUTOSTART==='true')state.automationRequested=true;
state.settings={...state.settings,...DEFAULTS};
state.strategy='autonomous';state.watchlist??=[];state.decisions??=[];
state.decisionStats??={evaluated:0,bought:0,rejected:0};
initializeScanner(state);
const expectedOrigin=process.env.PUBLIC_ORIGIN??(onRailway?'https://'+(process.env.RAILWAY_PUBLIC_DOMAIN??'trade-meme-production.up.railway.app'):null);
const auth=new OwnerAuth({owner:DEFAULT_OWNER,origin:expectedOrigin});
const execution=new SolanaExecution();
const direct=new DirectWallet(execution);
const ownerAgent=liveOnly&&process.env.SIGNER_MODE!=='disabled'?new OwnerAgent(dataDir,direct,execution,auth.owner,{storageMode:process.env.RAILWAY_VOLUME_MOUNT_PATH?'persistent-volume':onRailway?'ephemeral':'local-disk'}):null;
await ownerAgent?.load();
let feed={markets:[],solUsd:null,updatedAt:null,error:null};
const verification=new VerificationFeed(globalThis.fetch,execution);
const discovery=new DiscoveryQueue(state.discovery);
let refreshing=false;
async function save(){await writeFile(statePath+'.tmp',JSON.stringify(state,null,2),{mode:0o600});await rename(statePath+'.tmp',statePath);}
// Serialize market ticks and commands to prevent double-spend and overlapping writes.
let pending=Promise.resolve();
function serial(fn){const task=pending.then(fn);pending=task.catch(()=>{});return task;}
async function refresh(){
  if(refreshing)return;refreshing=true;
  try{
    const latest=await loadMarkets([...new Set([...state.positions.map(p=>p.mint),...direct.watched,...(ownerAgent?.trackedMints()??[]),...state.watchlist])],Object.fromEntries((ownerAgent?.state?.positions??state.positions).filter(p=>p.pairAddress).map(p=>[p.mint,p.pairAddress])),discovery);
    latest.markets=scannerMarkets(state,latest.markets);
    latest.markets=await verification.enrichCached(latest.markets,ownerAgent?.trackedMints()??[]);
    await serial(async()=>{latest.markets=observeMarkets(state,latest.markets);feed={...latest,error:null};
      if(liveOnly){
        state.lastEvaluationAt=Date.now();
        for(const market of feed.markets){const rank=rankMarket(market,state.settings);recordEvaluation(state,{at:Date.now(),mint:market.mint,symbol:market.symbol,score:rank.score,blockingStage:rank.blockingStage,decision:decideMarket(market,state.settings),action:rank.eligible?'WATCH':'SKIP',reason:rank.eligible?'Đạt bộ lọc thị trường; còn kiểm tra on-chain, ví và giới hạn thực thi.':rank.primaryReasons.join('; ')});}
      }else{if(state.automationRequested&&state.haltKind!=='drawdown')state.running=true;tick(state,feed.markets,feed.solUsd);}
      state.discovery=discovery.snapshot();await save();});
  }catch(e){feed.error=e.message;console.error('Market feed:',e.message);}
  finally{refreshing=false;}
}
function snapshot(req){
  const value=feed.solUsd?equity(state,feed.markets,feed.solUsd):state.cashSol;
  const closed=state.trades.filter(t=>t.side==='SELL'&&t.closed);
  const rankings=feed.markets.map(m=>({...m,...rankMarket(m,state.settings)})).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||Number(b.roughEligible)-Number(a.roughEligible)||b.score-a.score);
  if(liveOnly){
    const authenticated=auth.authenticated(req);
    const diagnostics={...diagnose({...state,running:false},feed,rankings),phase:authenticated?'owner-wallet':'owner-required',message:authenticated?ownerAgent?'Mở khóa bộ ký để bot tự giao dịch trên server; không chờ ký từng lệnh.':'Ví chủ ký trực tiếp. Mỗi giao dịch cần xác nhận trong ví.':'Kết nối đúng ví chủ để đọc số dư và giao dịch trực tiếp.'};
    return {mode:'live',walletMode:'owner',ownerAuthenticated:authenticated,readOnly:true,running:false,automationRequested:false,settings:DEFAULTS,rankings,diagnostics,feed,buildRevision:process.env.RAILWAY_GIT_COMMIT_SHA??'local',cashSol:null,equitySol:null,pnlSol:null,positions:[],trades:[],curve:[],events:[],watchlist:[],halted:null,peakEquity:null,maxDrawdownObservedPct:null,closedCount:0,winRate:null,decisionStats:state.decisionStats,decisions:state.decisions};
  }
  return {...state,rankings,diagnostics:diagnose(state,feed,rankings),buildRevision:process.env.RAILWAY_GIT_COMMIT_SHA??'local',mode:'paper',readOnly,feed,equitySol:feed.solUsd?value:null,pnlSol:feed.solUsd?value-state.settings.initialSol:null,winRate:closed.length?closed.filter(t=>(t.positionPnlSol??t.pnlSol)>0).length/closed.length:null,closedCount:closed.length};
}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
async function body(req,limit=4096){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>limit)throw Error('Yêu cầu quá lớn.');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
const assets={'/spider.js':['spider.js','text/javascript'],'/wallet.js':['wallet.js','text/javascript'],'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/auth/')||url.pathname.startsWith('/api/live/')||url.pathname.startsWith('/api/direct/')||url.pathname.startsWith('/api/signer/')){
      if(req.method==='GET'&&url.pathname==='/api/auth/status')return json(res,200,{owner:auth.owner,authenticated:auth.authenticated(req),walletMode:'owner',signerAvailable:!!ownerAgent,signerLocation:onRailway?'Railway':'local'});
      if(url.pathname.startsWith('/api/signer/')){
        if(!ownerAgent||!signerRequestAllowed(req,expectedOrigin,onRailway))return json(res,403,{error:'Bộ ký chỉ dùng trên Railway HTTPS hoặc localhost 127.0.0.1.'});
        if(!auth.authenticated(req))return json(res,401,{error:'Cần xác thực đúng ví chủ để điều khiển bộ ký.'});
        if(req.method==='GET'&&url.pathname==='/api/signer/status')return json(res,200,{...await ownerAgent.status(),storageMode:process.env.RAILWAY_VOLUME_MOUNT_PATH?'persistent-volume':onRailway?'ephemeral':'local-disk'});
        if(req.method!=='POST'||!auth.sameOrigin(req))return json(res,403,{error:'Origin không hợp lệ.'});
        if(['/api/signer/import','/api/signer/unlock'].includes(url.pathname))auth.limit(req.socket.remoteAddress??'unknown');
        const input=await body(req,url.pathname==='/api/signer/restore'?2*1024*1024:4096);
        if(url.pathname==='/api/signer/import'){try{await ownerAgent.serial(()=>ownerAgent.vault.importKey(input.secret,input.password));}finally{input.secret='';input.password='';}}
        else if(url.pathname==='/api/signer/unlock'){try{await ownerAgent.serial(()=>ownerAgent.vault.unlock(input.password));}finally{input.password='';}}
        else if(url.pathname==='/api/signer/enable'){if(input.confirm!=='ENABLE OWNER SIGNER')throw Error('Thiếu xác nhận bật bộ ký.');await ownerAgent.enable();}
        else if(url.pathname==='/api/signer/telegram-config'){try{await ownerAgent.serial(async()=>{await ownerAgent.telegram.configure(input.token,input.chatId,ownerAgent.vault.keypair);for(const m of ownerAgent.state?.telegramOutbox??[])if(m.status==='failed'){m.status='queued';m.attempts=0;m.nextAttemptAt=0;}await ownerAgent.save();});}finally{input.token='';}}
        else if(url.pathname==='/api/signer/telegram-test')await ownerAgent.telegram.test(ownerAgent.vault.keypair);
        else if(url.pathname==='/api/signer/telegram-disable')await ownerAgent.serial(()=>ownerAgent.telegram.disable());
        else if(url.pathname==='/api/signer/review-risk'){if(input.confirm!=='REVIEW DRAWDOWN')throw Error('Thiếu xác nhận xem lại drawdown.');await ownerAgent.reviewRisk(feed);}
        else if(url.pathname==='/api/signer/pause-buys')await ownerAgent.pauseBuys(input.paused!==false);
        else if(url.pathname==='/api/signer/pause')await ownerAgent.pause();
        else if(url.pathname==='/api/signer/lock')await ownerAgent.pause(true);
        else if(url.pathname==='/api/signer/close')await ownerAgent.close(input.mint,feed);
        else if(url.pathname==='/api/signer/restore')await ownerAgent.restore(input.ledger);
        else if(url.pathname==='/api/signer/recovery-preview')return json(res,200,{proof:await ownerAgent.previewRecovery(input)});
        else if(url.pathname==='/api/signer/recovery-apply')return json(res,200,{ok:true,proof:await ownerAgent.recoverPurchase(input)});
        else if(url.pathname==='/api/signer/export'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify(ownerAgent.state));}
        else return json(res,404,{error:'Không tìm thấy thao tác bộ ký.'});
        return json(res,200,{ok:true,vault:ownerAgent.vault.status()});
      }
      if(req.method==='GET'&&url.pathname==='/api/direct/status'){
        if(!auth.authenticated(req))return json(res,401,{error:'Cần xác thực bằng ví chủ.'});
        return json(res,200,await direct.status());
      }
      if(req.method==='GET'&&url.pathname.startsWith('/api/live/')){
        if(!auth.authenticated(req))return json(res,401,{error:'Cần xác thực bằng ví chủ.'});
        if(url.pathname==='/api/live/backup'){
          try{const backup=await readFile(path.join(dataDir,'wallet-vault.json'),'utf8');res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','Content-Disposition':'attachment; filename="legacy-encrypted-wallet.json"'});return res.end(backup);}catch{return json(res,404,{error:'Không có bản sao ví phụ cũ.'});}
        }
        return json(res,410,{error:'Đã chuyển sang ví chủ ký trực tiếp. Tải lại trang.'});
      }
      if(req.method!=='POST'||!auth.sameOrigin(req))return json(res,403,{error:'Origin hoặc loại yêu cầu không hợp lệ.'});
      if(url.pathname.startsWith('/api/auth/'))auth.limit(req.socket.remoteAddress??'unknown');const input=await body(req);
      if(url.pathname==='/api/auth/challenge')return json(res,200,auth.challenge(input.address));
      if(url.pathname==='/api/auth/login'){const session=auth.login(input.nonce,input.signature);res.setHeader('Set-Cookie',auth.cookie(session));return json(res,200,{authenticated:true});}
      if(!auth.authenticated(req))return json(res,401,{error:'Cần xác thực bằng ví chủ.'});
      if(url.pathname==='/api/auth/logout'){auth.logout(req);res.setHeader('Set-Cookie',auth.cookie(''));return json(res,200,{authenticated:false});}
      if(url.pathname.startsWith('/api/live/'))return json(res,410,{error:'Đã bỏ tạo/nạp ví phụ. Dùng ví chủ ký trực tiếp.'});
      if(url.pathname==='/api/direct/config')return await serial(async()=>json(res,200,direct.configure(input)));
      if(url.pathname==='/api/direct/watch'){
        if(!Array.isArray(input.mints)||input.mints.some(m=>typeof m!=='string'||! /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)))throw Error('Danh sách token không hợp lệ.');
        const changed=direct.watched.join(',')!==input.mints.join(',');direct.watched=[...new Set(input.mints)];if(changed)setImmediate(refresh);return json(res,200,{watching:direct.watched.length});
      }
      if(ownerAgent?.vault.exists&&['/api/direct/prepare','/api/direct/submit'].includes(url.pathname))return json(res,409,{error:'Bộ ký server đang quản lý ví; không tạo ngân sách hoặc lệnh từ tab khác.'});
      if(url.pathname==='/api/direct/prepare')return await serial(async()=>json(res,200,await direct.prepare(input,feed)));
      if(url.pathname==='/api/direct/submit')return await serial(async()=>json(res,200,await direct.submit(input)));
      if(url.pathname==='/api/direct/reconcile')return await serial(async()=>json(res,200,await direct.reconcile(input)));
      if(url.pathname==='/api/direct/cancel')return await serial(async()=>json(res,200,direct.cancel(input.id)));
      return json(res,404,{error:'Không tìm thấy thao tác ví.'});
    }
    if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,snapshot(req));
    if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{status:'ok',mode:liveOnly?'live':'paper',rpcMode:'keyless',apiKeyRequired:false,unattendedSigningAvailable:!!ownerAgent,strategyVersion:STRATEGY_VERSION,swapProvider:liveOnly?'PumpSwap':null,signingMode:ownerAgent?'owner-agent':liveOnly?'owner-wallet':null,buildRevision:process.env.RAILWAY_GIT_COMMIT_SHA??'local',running:liveOnly?false:state.running,readOnly,marketReady:!!feed.updatedAt,marketFresh:!!feed.updatedAt&&!feed.error&&Date.now()-feed.updatedAt<DEFAULTS.maxPriceAgeMs});
    if(req.method==='GET'&&url.pathname==='/api/export'){
      if(liveOnly){if(!auth.authenticated(req))return json(res,401,{error:'Cần xác thực bằng ví chủ.'});return json(res,200,{mode:'live',walletMode:'owner',message:'Xuất lịch sử trong phần ví chủ trên trình duyệt đang giao dịch.'});}
      res.writeHead(200,{'Content-Type':'application/json','Content-Disposition':'attachment; filename="paper-trades.json"','Cache-Control':'no-store'});return res.end(JSON.stringify({mode:'paper',exportedAt:new Date().toISOString(),settings:state.settings,trades:state.trades},null,2));
    }
    if(req.method==='POST'&&url.pathname==='/api/command'){
      if(readOnly||liveOnly)return json(res,403,{error:'Đăng nhập ví chủ và dùng các thao tác mainnet đã xác thực.'});
      // JSON + same-origin browser request required; no cross-origin mutations.
      if(!req.headers['content-type']?.startsWith('application/json')||req.headers['x-requested-with']!=='meme-desk')return json(res,403,{error:'Yêu cầu không hợp lệ.'});
      if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'Origin không hợp lệ.'});
      const command=await body(req);
      return await serial(async()=>{
        const {action,mint}=command;
        if(action==='start'){
          if(!feed.updatedAt||feed.error||Date.now()-feed.updatedAt>90000)throw Error('Chưa có dữ liệu thị trường mới.');
          state.automationRequested=true;state.running=true;event(state,'Bật bot TỰ QUYẾT ĐỊNH · MÔ PHỎNG. Quét và chấm điểm thị trường.');
        }else if(action==='pause'){state.automationRequested=false;state.running=false;event(state,'Đã dừng tự động. Vị thế giữ nguyên; có thể bán mô phỏng thủ công.');}
        else if(action==='buy'||action==='sell'){
          if(feed.error||Date.now()-feed.updatedAt>90000)throw Error('Dữ liệu thị trường chưa sẵn sàng hoặc đã cũ.');
          const market=feed.markets.find(m=>m.mint===mint);
          if(action==='buy')buy(state,market,feed.solUsd);else sell(state,market,feed.solUsd);
         }else if(action==='add-token'){
          if(typeof command.address!=='string'||! /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(command.address))throw Error('Địa chỉ mint Solana không hợp lệ.');
          if(state.watchlist.length>=20)throw Error('Tối đa 20 token bổ sung.');
          if(state.watchlist.includes(command.address))throw Error('Token đã có trong danh sách.');
          state.watchlist.push(command.address);event(state,'Đã thêm token vào tập quét; bot vẫn tự lọc trước khi mua.');
          setImmediate(refresh);
        }else if(action==='remove-token'){
          state.watchlist=state.watchlist.filter(m=>m!==command.address);
        }else if(action==='reset'){
          if(command.confirm!=='RESET PAPER')throw Error('Thiếu xác nhận reset.');
          await writeFile(path.join(dataDir,`archive-${Date.now()}.json`),JSON.stringify(state,null,2),{mode:0o600});
          state=freshState();event(state,'Tạo tài khoản mô phỏng mới 0,3 SOL. Lịch sử trước đã lưu trữ.');
        }else throw Error('Lệnh không được hỗ trợ.');
        await save();return json(res,200,snapshot(req));
      });
    }
    if(req.method==='GET'&&assets[url.pathname]){
      const [name,type]=assets[url.pathname];res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});return res.end(await readFile(path.join(root,'public',name)));
    }
    json(res,404,{error:'Không tìm thấy.'});
  }catch(e){json(res,400,{error:e.message});}
});
const host=process.env.HOST??(onRailway?'0.0.0.0':'127.0.0.1'),port=Number(process.env.PORT??3000);
server.listen(port,host,()=>{if(!auth.origin)auth.origin=`http://127.0.0.1:${server.address().port}`;console.log(`Meme Desk listening on ${host}:${server.address().port} — ${liveOnly?'MAINNET / OWNER AUTH REQUIRED':'PAPER TEST WORKSPACE'}`);refresh();});
const timer=setInterval(refresh,SCAN_RULES.intervalMs);
const agentTimer=ownerAgent?setInterval(()=>ownerAgent.tick(feed),2000):null;
const telegramTimer=ownerAgent?setInterval(()=>ownerAgent.telegram.tick(ownerAgent),2000):null;
async function shutdown(){clearInterval(timer);if(agentTimer)clearInterval(agentTimer);if(telegramTimer)clearInterval(telegramTimer);server.close();if(ownerAgent)await ownerAgent.pause(true);await serial(async()=>{state.running=false;await save();});process.exit(0);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
