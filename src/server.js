import http from 'node:http';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {DEFAULTS,PROFILE,freshState,equity,event,buy,sell,tick} from './engine.js';
import {loadMarkets} from './market.js';
import {rankMarket} from './strategy.js';
import {diagnose} from './diagnostics.js';
import {observeMarkets} from './signals.js';
import {OwnerAuth,DEFAULT_OWNER} from './security.js';
import {WalletVault} from './vault.js';
import {SolanaExecution} from './solana.js';
import {LiveTrader} from './live.js';
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
state.settings={...DEFAULTS,...state.settings};
state.strategy='autonomous';state.watchlist??=[];state.decisions??=[];
state.decisionStats??={evaluated:0,bought:0,rejected:0};
const expectedOrigin=process.env.PUBLIC_ORIGIN??(onRailway?'https://'+(process.env.RAILWAY_PUBLIC_DOMAIN??'trade-meme-production.up.railway.app'):null);
const auth=new OwnerAuth({owner:DEFAULT_OWNER,origin:expectedOrigin});
const vault=new WalletVault(path.join(dataDir,'wallet-vault.json'));await vault.load();
const execution=new SolanaExecution();
const live=new LiveTrader(dataDir,vault,execution);await live.load();
if(process.env.BOT_VAULT_PASSWORD&&vault.exists){try{await vault.unlock(process.env.BOT_VAULT_PASSWORD);}catch{console.error('Bot vault remains locked.');}}
if(vault.heliusKey)execution.configureHelius(vault.heliusKey);
const volume=process.env.RAILWAY_VOLUME_MOUNT_PATH;
const persistentStorage=!onRailway||!!(volume&&(path.resolve(dataDir)===path.resolve(volume)||path.resolve(dataDir).startsWith(path.resolve(volume)+path.sep)));
let feed={markets:[],solUsd:null,updatedAt:null,error:null};
let refreshing=false;
async function save(){await writeFile(statePath+'.tmp',JSON.stringify(state,null,2),{mode:0o600});await rename(statePath+'.tmp',statePath);}
// Serialize market ticks and commands to prevent double-spend and overlapping writes.
let pending=Promise.resolve();
function serial(fn){const task=pending.then(fn);pending=task.catch(()=>{});return task;}
async function refresh(){
  if(refreshing)return;refreshing=true;
  try{
    const latest=await loadMarkets([...new Set([...state.positions.map(p=>p.mint),...live.state.positions.map(p=>p.mint),...(live.state.pending?[live.state.pending.mint]:[]),...state.watchlist])]);
    await serial(async()=>{latest.markets=observeMarkets(state,latest.markets);feed={...latest,error:null};
      if(liveOnly){
        state.lastEvaluationAt=Date.now();
        for(const market of feed.markets){const rank=rankMarket(market,state.settings);state.decisionStats.evaluated++;if(!rank.eligible)state.decisionStats.rejected++;state.decisions.unshift({at:Date.now(),mint:market.mint,symbol:market.symbol,score:rank.score,action:rank.eligible?'WATCH':'SKIP',reason:rank.eligible?'Đạt bộ lọc thị trường; còn kiểm tra on-chain, ví và giới hạn thực thi.':rank.reasons.join('; ')});}
        state.decisions=state.decisions.slice(0,300);
      }else{if(state.automationRequested)state.running=true;tick(state,feed.markets,feed.solUsd);}
      await save();});
    if(persistentStorage)void live.tick(feed).catch(()=>console.error('Live controller paused.'));
  }catch(e){feed.error=e.message;console.error('Market feed:',e.message);}
  finally{refreshing=false;}
}
function snapshot(req){
  const value=feed.solUsd?equity(state,feed.markets,feed.solUsd):state.cashSol;
  const closed=state.trades.filter(t=>t.side==='SELL'&&t.closed);
  const rankings=feed.markets.map(m=>({...m,...rankMarket(m,state.settings)})).sort((a,b)=>b.score-a.score);
  if(liveOnly){
    const authenticated=auth.authenticated(req),s=live.state,visible=authenticated&&vault.exists,haveBalance=visible&&!!s.lastSyncAt;
    const value=haveBalance&&feed.solUsd&&!s.balanceMismatch?equity(s,feed.markets,feed.solUsd):null;
    const closed=s.trades.filter(t=>t.side==='SELL'&&t.closed);
    let diagnostics=diagnose({...s,lastEvaluationAt:state.lastEvaluationAt},feed,rankings);
    if(!authenticated)diagnostics={...diagnostics,phase:'owner-required',message:'Đăng nhập bằng ví chủ để xem số dư và điều khiển giao dịch thật.'};
    else if(!vault.exists)diagnostics={...diagnostics,phase:'wallet-required',message:'Chưa có ví bot. Hoàn tất két ví và lưu trữ trước khi nạp SOL.'};
    else if(!vault.keypair)diagnostics={...diagnostics,phase:'vault-locked',message:'Két ví đang khóa; không ký giao dịch.'};
    else if(!s.enabled)diagnostics={...diagnostics,phase:'disabled',message:s.lastError||'Chưa bật mainnet. Kiểm tra số dư, API key và bấm Bật giao dịch thật.'};
    else if(s.entryBlockedReason)diagnostics={...diagnostics,phase:'missing-held-price',message:s.entryBlockedReason};
    return {mode:'live',ownerAuthenticated:authenticated,readOnly:true,running:!!(s.enabled&&vault.keypair),automationRequested:s.enabled,settings:s.settings,rankings,diagnostics,feed,buildRevision:process.env.RAILWAY_GIT_COMMIT_SHA??'local',cashSol:haveBalance?(s.observedBalanceSol??s.cashSol):null,equitySol:value,pnlSol:value===null||!s.funded?null:value+(s.withdrawnSol??0)-s.settings.initialSol,positions:visible?s.positions:[],trades:visible?s.trades:[],curve:visible?s.curve:[],events:visible?s.events:[],watchlist:[],halted:visible?s.halted:null,peakEquity:visible&&s.funded?s.peakEquity:null,maxDrawdownObservedPct:visible&&s.funded?s.maxDrawdownObservedPct:null,closedCount:visible?closed.length:0,winRate:visible&&closed.length?closed.filter(t=>(t.positionPnlSol??t.pnlSol)>0).length/closed.length:null,decisionStats:{...state.decisionStats,bought:visible?s.trades.filter(t=>t.side==='BUY').length:0},decisions:visible?[...state.decisions,...s.decisions].sort((a,b)=>b.at-a.at).slice(0,300):state.decisions};
  }
  return {...state,rankings,diagnostics:diagnose(state,feed,rankings),buildRevision:process.env.RAILWAY_GIT_COMMIT_SHA??'local',mode:'paper',readOnly,feed,equitySol:feed.solUsd?value:null,pnlSol:feed.solUsd?value-state.settings.initialSol:null,winRate:closed.length?closed.filter(t=>(t.positionPnlSol??t.pnlSol)>0).length/closed.length:null,closedCount:closed.length};
}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
async function body(req){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>4096)throw Error('Yêu cầu quá lớn.');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
const assets={'/spider.js':['spider.js','text/javascript'],'/wallet.js':['wallet.js','text/javascript'],'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/auth/')||url.pathname.startsWith('/api/live/')){
      if(req.method==='GET'&&url.pathname==='/api/auth/status')return json(res,200,{owner:auth.owner,authenticated:auth.authenticated(req),persistentStorage});
      if(req.method==='GET'&&url.pathname==='/api/live/status'){
        if(!auth.authenticated(req))return json(res,401,{error:'Cần xác thực bằng ví chủ.'});
        return json(res,200,{...live.status(),rpcProvider:execution.provider,persistentStorage,backupDownloaded:!!vault.backupDownloaded});
      }
      if(req.method==='GET'&&url.pathname==='/api/live/backup'){
        if(!auth.authenticated(req))return json(res,401,{error:'Cần xác thực bằng ví chủ.'});
        const backup=await vault.backup();vault.backupDownloaded=true;res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','Content-Disposition':'attachment; filename="meme-pilot-encrypted-wallet.json"'});return res.end(backup);
      }
      if(req.method!=='POST'||!auth.sameOrigin(req))return json(res,403,{error:'Origin hoặc loại yêu cầu không hợp lệ.'});
      auth.limit(req.socket.remoteAddress??'unknown');const input=await body(req);
      if(url.pathname==='/api/auth/challenge')return json(res,200,auth.challenge(input.address));
      if(url.pathname==='/api/auth/login'){const session=auth.login(input.nonce,input.signature);res.setHeader('Set-Cookie',auth.cookie(session));return json(res,200,{authenticated:true});}
      if(!auth.authenticated(req))return json(res,401,{error:'Cần xác thực bằng ví chủ.'});
      if(url.pathname==='/api/auth/logout'){auth.logout(req);res.setHeader('Set-Cookie',auth.cookie(''));return json(res,200,{authenticated:false});}
      if(url.pathname==='/api/live/pause'){await live.pause();return json(res,200,live.status());}
      if(url.pathname==='/api/live/lock'){await live.pause();vault.lock();return json(res,200,live.status());}
      if(!persistentStorage)return json(res,409,{error:'Cần volume lưu bền vững và DATA_DIR trỏ vào volume trước khi tạo/nạp ví thật.'});
      if(url.pathname==='/api/live/create'){await live.serial(async()=>{await vault.create(input.password,input.apiKey,input.heliusKey);if(vault.heliusKey)execution.configureHelius(vault.heliusKey);});return json(res,200,live.status());}
      if(url.pathname==='/api/live/unlock'){await live.serial(async()=>{await vault.unlock(input.password,input.apiKey,input.heliusKey);if(vault.heliusKey)execution.configureHelius(vault.heliusKey);});return json(res,200,live.status());}
      if(url.pathname==='/api/live/close')return json(res,200,await live.close(input.mint,feed));
      if(url.pathname==='/api/live/withdraw')return json(res,200,await live.withdraw(auth.owner,input.confirm));
      if(url.pathname==='/api/live/enable'){return json(res,200,await live.enable(input.confirm));}
      if(url.pathname==='/api/live/fund'){
        if(!vault.publicKey||!vault.backupDownloaded)return json(res,409,{error:'Tạo ví và tải bản sao mã hóa trước khi nạp.'});
        if(!vault.apiKey&&!process.env.JUPITER_API_KEY)return json(res,409,{error:'Cấu hình Jupiter API key trước khi nạp SOL.'});
        if(live.state.funded)return json(res,409,{error:'Ví đã bắt đầu giao dịch; không nạp bổ sung qua ứng dụng để giữ đúng sổ vốn.'});
        try{const balance=await execution.balance(vault.publicKey);const lamports=Math.floor((.3-balance)*1e9);const transaction=await execution.fundingTransaction(auth.owner,vault.publicKey,lamports);return json(res,200,{transaction});}
        catch{return json(res,400,{error:'Không chuẩn bị được giao dịch nạp. Kiểm tra RPC và giới hạn 0,3 SOL.'});}
      }
      return json(res,404,{error:'Không tìm thấy thao tác ví.'});
    }
    if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,snapshot(req));
    if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{status:'ok',mode:liveOnly?'live':'paper',running:liveOnly?!!(live.state.enabled&&vault.keypair):state.running,readOnly,marketReady:!!feed.updatedAt,marketFresh:!!feed.updatedAt&&!feed.error&&Date.now()-feed.updatedAt<90000});
    if(req.method==='GET'&&url.pathname==='/api/export'){
      if(liveOnly){if(!auth.authenticated(req))return json(res,401,{error:'Cần xác thực bằng ví chủ.'});return json(res,200,{mode:'live',trades:live.state.trades,journal:live.state.journal});}
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
const timer=setInterval(refresh,30000);
async function shutdown(){clearInterval(timer);server.close();await serial(async()=>{state.running=false;await save();});process.exit(0);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
