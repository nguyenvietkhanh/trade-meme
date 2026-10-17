const $=id=>document.getElementById(id);
let state=null,busy=false;
let commandError='';
const fmt=(n,d=4)=>Number.isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const money=n=>Number.isFinite(n)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumSignificantDigits:5}).format(n):'—';
const time=n=>new Date(n).toLocaleTimeString('vi-VN');
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sign=n=>n>=0?'positive':'negative';
const signed=n=>(n>=0?'+':'')+fmt(n,5);
function rowEmpty(cols,text){return `<tr><td colspan="${cols}" class="empty">${text}</td></tr>`;}
function render(){
  if(!state)return;
  const s=state, f=s.feed, cfg=s.settings, fresh=f.updatedAt&&Date.now()-f.updatedAt<cfg.maxPriceAgeMs&&!f.error;
  $('equity').textContent=fmt(s.equitySol)+' SOL';$('cash').textContent=`Tiền khả dụng ${fmt(s.cashSol)} SOL`;
  $('pnl').textContent=s.pnlSol===null?'—':signed(s.pnlSol)+' SOL';$('pnl').className=sign(s.pnlSol);
  $('return').textContent=s.pnlSol===null?'Chờ giá SOL':`${signed(s.pnlSol/cfg.initialSol*100)}% so với vốn đầu`;
  $('win').textContent=s.winRate===null?'Chưa có win rate':fmt(s.winRate*100,1)+'% win';
  $('drawdown').textContent='−'+fmt(s.maxDrawdownObservedPct??0,1)+'%';$('peak').textContent=`Đỉnh vốn ${fmt(s.peakEquity,5)} SOL`;
  $('copied').innerHTML=`${s.decisionStats.bought} <span>lệnh mua</span>`;
  $('decision-summary').textContent=`${s.decisionStats.evaluated} lượt đánh giá · ${s.decisionStats.rejected} bỏ qua`;
  $('decision-log').innerHTML=s.decisions.map(l=>`<div class="decision-entry ${l.action.toLowerCase()}"><time>${time(l.at)}</time><span class="tag">[${escape(l.action)}]</span>${escape(l.symbol)}${l.score===null?'':' · '+l.score+'/100'} → ${escape(l.reason)}</div>`).join('')||'<p class="fine">Chưa có quyết định. Khi bật bot, mỗi vòng quét ghi lại token được chọn hoặc bị bỏ qua cùng lý do.</p>';
  $('candidates').innerHTML=s.rankings.slice(0,8).map((m,i)=>`<article class="candidate-card ${m.eligible?'active':''}"><div class="candidate-card-head"><span class="avatar">${escape(m.symbol.slice(0,1))}</span><strong>${escape(m.symbol)}</strong><small>#${i+1}</small></div><span class="candidate-score ${m.eligible?'positive':''}">${m.score}<small> / 100</small></span><span class="mint" title="${escape(m.mint)}">${escape(m.mint.slice(0,8))}…${escape(m.mint.slice(-6))}</span><div class="candidate-foot"><small>${m.eligible?'Đạt bộ lọc':escape(m.reasons[0]??'Đang đánh giá')}</small></div></article>`).join('')||'<p class="fine">Đang chờ dữ liệu thật. Không tạo token hoặc lợi nhuận giả.</p>';
  $('watchlist').innerHTML=s.watchlist.map(m=>`<span class="watch-token">${escape(m.slice(0,8))}…${escape(m.slice(-5))} <button data-action="remove-token" data-mint="${escape(m)}" aria-label="Xóa token">×</button></span>`).join('');
  $('closed').textContent=`${s.closedCount} lệnh đã đóng`;
  $('status').textContent=s.halted?'● KHÓA MUA':s.running?'● AUTO · PAPER':'● TẠM DỪNG';
  $('connection').textContent=fresh?'● Dữ liệu trực tuyến':'● Dữ liệu chưa sẵn sàng';
  $('feed-time').textContent=f.updatedAt?`Giá SOL ${money(f.solUsd)} · ${time(f.updatedAt)}`:'Đang lấy giá thật…';
  $('start').disabled=busy||s.running||!fresh||!!s.halted;$('pause').disabled=busy||!s.running;
  $('error').textContent=commandError||s.halted||f.error||'';
  $('risk-summary').innerHTML=[['Mỗi lệnh',`${cfg.orderSol} SOL`],['Dự phòng',`${cfg.reserveSol} SOL`],['Cắt lỗ / Chốt lời',`−${cfg.stopLossPct}% / +${cfg.takeProfitPct}%`],['Giới hạn lỗ/ngày',`${cfg.maxDailyLossSol} SOL (UTC)`],['Drawdown tối đa',`${cfg.maxDrawdownPct}%`],['Trượt giá mỗi chiều',`${cfg.slippageBps/100}%`],['Phí giả định mỗi lệnh',`${cfg.feeSol} SOL`]].map(([a,b])=>`<div><span>${a}</span><strong>${b}</strong></div>`).join('');
  const curve=s.curve;
  $('chart-empty').hidden=curve.length>0;
  if(curve.length){
    const values=curve.map(p=>p.equitySol), min=Math.min(...values,cfg.initialSol)*.995,max=Math.max(...values,cfg.initialSol)*1.005;
    const points=values.map((v,i)=>`${20+(i/Math.max(1,values.length-1))*720},${210-(v-min)/(max-min)*185}`);
    if(points.length===1)points.push(`740,${points[0].split(',')[1]}`);
    $('line').setAttribute('d','M'+points.join(' L'));$('area').setAttribute('d','M'+points.join(' L')+' L740,230 L20,230 Z');
    $('curve-start').textContent=time(curve[0].at);$('curve-end').textContent=`${fmt(values.at(-1),5)} SOL · ${time(curve.at(-1).at)}`;
  }else{$('line').setAttribute('d','');$('area').setAttribute('d','');}
  $('position-count').textContent=`${s.positions.length} / ${cfg.maxPositions}`;
  $('positions').innerHTML=s.positions.map(p=>{
    const m=f.markets.find(m=>m.mint===p.mint),price=m?.priceUsd??p.lastPriceUsd;
    const pnl=p.quantity*price*(1-cfg.slippageBps/10000)/f.solUsd-cfg.feeSol-p.costSol;
    return `<tr><td><strong>${escape(p.symbol)}</strong><span class="mint">${escape(p.mint)}</span></td><td>${fmt(p.costSol,5)}</td><td>${money(price)}</td><td class="${sign(pnl)}">${signed(pnl)}</td><td><button data-action="sell" data-mint="${escape(p.mint)}" ${!fresh||!m||busy?'disabled':''}>Bán mô phỏng</button></td></tr>`;
  }).join('')||rowEmpty(5,'Chưa có vị thế. Bật bot hoặc chọn mua mô phỏng bên dưới.');
  const q=$('search').value.toLowerCase();
  $('markets').innerHTML=f.markets.filter(m=>(m.symbol+m.name+m.mint).toLowerCase().includes(q)).map(m=>{
    const eligible=m.liquidityUsd>=cfg.minLiquidityUsd&&m.volume24hUsd>=cfg.minVolume24hUsd;
    return `<tr><td><strong>${escape(m.symbol)}</strong><span class="mint" title="${escape(m.mint)}">${escape(m.mint.slice(0,8))}…${escape(m.mint.slice(-6))}</span></td><td>${money(m.priceUsd)}</td><td class="${sign(m.change5mPct)}">${m.change5mPct>0?'+':''}${fmt(m.change5mPct,2)}%</td><td>${money(m.liquidityUsd)}</td><td>${money(m.volume24hUsd)}</td><td>${m.buys5m} / ${m.sells5m}</td><td><button data-action="buy" data-mint="${escape(m.mint)}" ${busy||!fresh||!eligible||s.halted||s.positions.some(p=>p.mint===m.mint)?'disabled':''}>${eligible?'Mua mô phỏng':'Lọc thanh khoản'}</button></td></tr>`;
  }).join('')||rowEmpty(7,'Chưa có token phù hợp hoặc đang chờ dữ liệu.');
  $('events').innerHTML=s.events.map(e=>`<div class="event"><time>${time(e.at)}</time>${escape(e.message)}</div>`).join('')||'<p>Nhật ký sẽ xuất hiện khi bot hoạt động.</p>';
  $('trades').innerHTML=s.trades.map(t=>`<div class="event"><time>${time(t.at)}</time><span class="${t.side==='BUY'?'positive':'negative'}">${t.side}</span> ${escape(t.symbol)} · ${fmt(t.sol,5)} SOL${t.pnlSol!==undefined?` · P/L <span class="${sign(t.pnlSol)}">${signed(t.pnlSol)}</span>`:''}<br><span class="subtle">PAPER · ${escape(t.reason)}</span></div>`).join('')||'<p>Chưa có giao dịch. Số liệu sẽ không được tạo giả.</p>';
  $('public-notice').hidden=!s.readOnly;
  if(s.readOnly){
    for(const button of document.querySelectorAll('button'))button.disabled=true;
    $('token-form').hidden=true;
  }
}
async function update(){try{const r=await fetch('/api/state');if(!r.ok)throw Error('Không tải được trạng thái.');state=await r.json();render();}catch(e){$('connection').textContent='● Mất kết nối máy chủ';$('error').textContent=e.message;}}
async function command(action,mint,extra={}){
  if(busy||state?.readOnly)return;
  let confirm;
  if(action==='reset'){if(!window.confirm('Lưu trữ lịch sử và tạo lại tài khoản MÔ PHỎNG 0,3 SOL?'))return;confirm='RESET PAPER';}
  busy=true;commandError='';render();
  try{
    const r=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'meme-desk'},body:JSON.stringify({action,mint,address:action==='remove-token'?mint:undefined,confirm,...extra})});const data=await r.json();if(!r.ok)throw Error(data.error);state=data;render();
  }catch(e){commandError=e.message;}finally{busy=false;render();}
}
for(const action of ['start','pause','reset'])$(action).addEventListener('click',()=>command(action));
document.addEventListener('click',e=>{const button=e.target.closest('button[data-action]');if(button)command(button.dataset.action,button.dataset.mint);});
$('search').addEventListener('input',render);
$('token-form').addEventListener('submit',async e=>{e.preventDefault();await command('add-token',undefined,{address:$('token-address').value.trim()});if(!commandError)e.target.reset();});
update();setInterval(update,5000);
