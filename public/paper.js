import {authenticate} from '/paper-wallet.js';
let renderedTrade=null;
const $=id=>document.getElementById(id),num=n=>Number.isFinite(n)?n.toFixed(6):'chưa xác định',short=m=>'…'+String(m).slice(-6);
async function post(url,value={}){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'meme-desk'},body:JSON.stringify(value)}),v=await r.json();if(!r.ok)throw Error(v.error??'Request failed');return v;}
function rows(id,values){const nodes=values.map(text=>{const p=document.createElement('p');p.textContent=text;return p;});$(id).replaceChildren(...nodes);}
async function refresh(){try{const r=await fetch('/api/state'),s=await r.json();$('balance').textContent=`SOL ảo khả dụng: ${num(s.cashSol)} · Equity: ${num(s.equitySol)} · P/L: ${num(s.pnlSol)} SOL · Rent khóa: ${num(s.rentLockedSol)} · Cỡ lệnh hiện tại: ${num(s.currentOrderSol)} SOL`;
 $('storage').textContent=s.storageMode==='ephemeral'?'Railway chưa có Volume: sổ mô phỏng và báo cáo có thể mất khi thay container. Cần gắn Volume để lưu bền.':'Lưu trữ: '+s.storageMode;
 $('status').textContent=`${s.running?'Đang xét BUY':'Đã dừng BUY'}; vẫn theo dõi SELL mô phỏng. ${s.diagnostics.message} ${s.feed.error??''} ${s.staleMints.length?'Có quote vị thế cũ; equity chưa xác định và tạm dừng BUY.':''}`;
 $('telegram').textContent=`${s.telegram.unlocked?'Sẵn sàng gửi':s.telegram.configured?'Đã lưu, cần mở khóa':'Chưa cấu hình'} · ${s.telegram.pending} tin chờ · ${s.telegram.failed} lỗi. ${s.telegram.error??''} ${s.reporting.error??''}`;
 $('scans').textContent=`${s.feed.markets.length} token · ${s.decisionStats.totalEvaluated??0} lượt đánh giá · ${JSON.stringify(s.diagnostics.counts)}`;
 rows('positions',s.positions.map(p=>`${p.symbol} ${short(p.mint)} · ${p.quantity} token · giá vốn ${num(p.costSol)} SOL · ${p.phase}`));
 rows('trades',s.trades.slice(0,30).map(t=>`PAPER ${new Date(t.at).toLocaleTimeString()} ${t.side} ${t.symbol} ${short(t.mint)} · ${num(t.sol)} SOL · P/L ${num(t.pnlSol)} · ${t.reason}`));
 rows('decisions',s.decisions.slice(0,50).map(d=>`${d.symbol} ${short(d.mint)} · ${d.score}/${d.minScore??60} · ${d.blockingStage} · ${d.reason} · Bỏ qua: ${(d.relaxedFlags??[]).join(', ')||'không'}`));$('revision').textContent='PAPER · '+s.buildRevision;
 const latest=s.trades[0];if(latest?.id&&latest.id!==renderedTrade){if(renderedTrade)window.dispatchEvent(new CustomEvent('meme-trade',{detail:{...latest,id:latest.id,text:'PAPER '+latest.side+' '+latest.symbol,anchor:'#trades'}}));renderedTrade=latest.id;}else window.dispatchEvent(new CustomEvent('meme-activity',{detail:{id:'paper-scan:'+s.lastEvaluationAt,text:'Quét thị trường · mô phỏng',anchor:'#scans'}}));
 }catch{$('message').textContent='Chưa đọc được trạng thái; thử lại sau.';}}
function action(id,fn){$(id).addEventListener('click',async()=>{try{$(id).disabled=true;await fn();$('message').textContent='Đã thực hiện.';await refresh();}catch(e){$('message').textContent=e.message;}finally{$(id).disabled=false;$('password').value='';$('token').value='';}});}
action('auth',()=>authenticate(post));action('pause',()=>post('/api/paper/pause',{paused:true}));action('resume',()=>post('/api/paper/pause',{paused:false}));
action('configure',()=>post('/api/paper/telegram-config',{token:$('token').value,chatId:$('chat').value,password:$('password').value}));action('migrate',()=>post('/api/paper/telegram-migrate',{password:$('password').value}));action('unlock',()=>post('/api/paper/telegram-unlock',{password:$('password').value}));action('test',()=>post('/api/paper/telegram-test'));
refresh();setInterval(refresh,5000);
