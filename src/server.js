import http from 'node:http';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {DEFAULTS,freshState,equity,event,buy,sell,tick} from './engine.js';
import {loadMarkets} from './market.js';
import {rankMarket} from './strategy.js';

// Railway may use the Docker/npm entry point instead of the configured wrapper.
// Apply the public paper-demo policy here so every entry point behaves the same.
const onRailway=Boolean(process.env.RAILWAY_SERVICE_ID||process.env.RAILWAY_ENVIRONMENT_ID);
const readOnly=onRailway||process.env.PUBLIC_READ_ONLY==='true';
const root=fileURLToPath(new URL('../',import.meta.url));
const dataDir=process.env.DATA_DIR??path.join(root,'.data');
await mkdir(dataDir,{recursive:true});
const statePath=path.join(dataDir,'paper-state.json');
let state;
try {state=JSON.parse(await readFile(statePath,'utf8'));if(state.version!==1) throw Error('Unsupported state version');}
catch(e) {if(e.code!=='ENOENT') throw e;state=freshState();}
// Restart pauses until a fresh feed arrives; explicitly requested automation then resumes.
state.running=false;
state.automationRequested??=false;
if(onRailway||process.env.PAPER_AUTOSTART==='true')state.automationRequested=true;
state.settings={...DEFAULTS,...state.settings};
state.strategy='autonomous';state.watchlist??=[];state.decisions??=[];
state.decisionStats??={evaluated:0,bought:0,rejected:0};
let feed={markets:[],solUsd:null,updatedAt:null,error:null};
let refreshing=false;
async function save(){await writeFile(statePath+'.tmp',JSON.stringify(state,null,2),{mode:0o600});await rename(statePath+'.tmp',statePath);}
// Serialize market ticks and commands to prevent double-spend and overlapping writes.
let pending=Promise.resolve();
function serial(fn){const task=pending.then(fn);pending=task.catch(()=>{});return task;}
async function refresh(){
  if(refreshing)return;refreshing=true;
  try{
    const latest=await loadMarkets([...new Set([...state.positions.map(p=>p.mint),...state.watchlist])]);
    await serial(async()=>{feed={...latest,error:null};if(state.automationRequested&&!state.halted)state.running=true;tick(state,feed.markets,feed.solUsd);await save();});
  }catch(e){feed.error=e.message;console.error('Market feed:',e.message);}
  finally{refreshing=false;}
}
function snapshot(){
  const value=feed.solUsd?equity(state,feed.markets,feed.solUsd):state.cashSol;
  const closed=state.trades.filter(t=>t.side==='SELL');
  return {...state,rankings:feed.markets.map(m=>({...m,...rankMarket(m,state.settings)})).sort((a,b)=>b.score-a.score),mode:'paper',readOnly,feed,equitySol:feed.solUsd?value:null,pnlSol:feed.solUsd?value-state.settings.initialSol:null,winRate:closed.length?closed.filter(t=>t.pnlSol>0).length/closed.length:null,closedCount:closed.length};
}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
async function body(req){let raw='';for await(const c of req){raw+=c;if(raw.length>4096)throw Error('Yêu cầu quá lớn.');}return JSON.parse(raw||'{}');}
const assets={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,snapshot());
    if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{status:'ok',mode:'paper',running:state.running,readOnly,marketReady:!!feed.updatedAt,marketFresh:!!feed.updatedAt&&!feed.error&&Date.now()-feed.updatedAt<90000});
    if(req.method==='GET'&&url.pathname==='/api/export'){
      res.writeHead(200,{'Content-Type':'application/json','Content-Disposition':'attachment; filename="paper-trades.json"','Cache-Control':'no-store'});return res.end(JSON.stringify({mode:'paper',exportedAt:new Date().toISOString(),settings:state.settings,trades:state.trades},null,2));
    }
    if(req.method==='POST'&&url.pathname==='/api/command'){
      if(readOnly)return json(res,403,{error:'Bản demo công khai chỉ cho xem. Bot mô phỏng tự vận hành trên server.'});
      // JSON + same-origin browser request required; no cross-origin mutations.
      if(!req.headers['content-type']?.startsWith('application/json')||req.headers['x-requested-with']!=='meme-desk')return json(res,403,{error:'Yêu cầu không hợp lệ.'});
      if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'Origin không hợp lệ.'});
      const command=await body(req);
      return await serial(async()=>{
        const {action,mint}=command;
        if(action==='start'){
          if(!feed.updatedAt||feed.error||Date.now()-feed.updatedAt>90000)throw Error('Chưa có dữ liệu thị trường mới.');
          if(state.halted)throw Error(state.halted);
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
        await save();return json(res,200,snapshot());
      });
    }
    if(req.method==='GET'&&assets[url.pathname]){
      const [name,type]=assets[url.pathname];res.writeHead(200,{'Content-Type':type+'; charset=utf-8','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});return res.end(await readFile(path.join(root,'public',name)));
    }
    json(res,404,{error:'Không tìm thấy.'});
  }catch(e){json(res,400,{error:e.message});}
});
const host=process.env.HOST??(onRailway?'0.0.0.0':'127.0.0.1'),port=Number(process.env.PORT??3000);
server.listen(port,host,()=>{console.log(`Meme Desk listening on ${host}:${server.address().port} — PAPER ONLY`);refresh();});
const timer=setInterval(refresh,30000);
async function shutdown(){clearInterval(timer);server.close();await serial(async()=>{state.running=false;await save();});process.exit(0);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
