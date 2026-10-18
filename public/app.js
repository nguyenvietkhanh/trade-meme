const $=id=>document.getElementById(id);
let state=null,busy=false,ownerState=null;
let commandError='';
let seenPaperTrades=null,lastActivityKey=null;
const fmt=(n,d=4)=>Number.isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const money=n=>Number.isFinite(n)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumSignificantDigits:5}).format(n):'—';
const time=n=>new Date(n).toLocaleTimeString('vi-VN');
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sign=n=>n>=0?'positive':'negative';
const signed=n=>Number.isFinite(n)?(n>=0?'+':'')+fmt(n,5):'—';
function rowEmpty(cols,text){return `<tr><td colspan="${cols}" class="empty">${text}</td></tr>`;}
function render(){
  if(!state)return;
  const s=state.mode==='live'&&state.ownerAuthenticated&&ownerState?{...state,...ownerState}:state, f=s.feed, cfg=s.settings, fresh=f.updatedAt&&Date.now()-f.updatedAt<cfg.maxPriceAgeMs&&!f.error;
  $('equity').textContent=fmt(s.equitySol)+' SOL';$('cash').textContent=s.cashSol===null?'Đăng nhập ví chủ để xem số dư':s.walletMode==='owner'&&Number.isFinite(s.budgetCashSol)?`Ngân sách ứng dụng còn ${fmt(s.budgetCashSol)} SOL`:`Tiền khả dụng ${fmt(s.cashSol)} SOL`;
  $('pnl').textContent=s.pnlSol===null?'—':signed(s.pnlSol)+' SOL';$('pnl').className=sign(s.pnlSol);
  $('return').textContent=s.pnlSol===null?'Chưa có dữ liệu vốn mainnet':`${signed(s.pnlSol/cfg.initialSol*100)}% so với vốn đầu`;
  $('win').textContent=s.winRate===null?'Chưa có win rate':fmt(s.winRate*100,1)+'% win';
  $('drawdown').textContent=s.maxDrawdownObservedPct===null?'—':'−'+fmt(s.maxDrawdownObservedPct,1)+'%';$('peak').textContent=`Đỉnh vốn ${fmt(s.peakEquity,5)} SOL`;
  $('copied').innerHTML=`${s.bought??s.decisionStats.bought} <span>lệnh mua</span>`;
  $('decision-summary').textContent=`${s.decisionStats.evaluated.toLocaleString('vi-VN')} / ${(s.diagnostics.scanCycleLimit??10000).toLocaleString('vi-VN')} lượt đánh giá · vòng ${s.decisionStats.cycle??1} · ${s.decisionStats.rejected} bỏ qua`;
  $('decision-log').innerHTML=s.decisions.map(l=>`<div class="decision-entry ${l.action.toLowerCase()}" data-spider-mint="${escape(l.mint)}" data-spider-role="decision"><time>${time(l.at)}</time><span class="tag">[${escape(l.action)}]</span>${escape(l.symbol)}${l.score===null?'':' · '+l.score+'/100'} → ${escape(l.reason)}</div>`).join('')||'<p class="fine">Chưa có quyết định. Khi bật bot, mỗi vòng quét ghi lại token được chọn hoặc bị bỏ qua cùng lý do.</p>';
  $('candidates').innerHTML=s.rankings.slice(0,8).map((m,i)=>`<article class="candidate-card ${m.eligible?'active':''}" data-spider-mint="${escape(m.mint)}" data-spider-role="candidate"><div class="candidate-card-head"><span class="avatar">${escape(m.symbol.slice(0,1))}</span><strong>${escape(m.symbol)}</strong><small>#${i+1}</small></div><span class="candidate-score ${m.eligible?'positive':''}">${m.score}<small> / 100</small></span><span class="mint">${m.valuationSource==='fdv'?'FDV':'Market cap'} ${money(m.valuationUsd)}</span><span class="mint" title="${escape(m.mint)}">${escape(m.mint.slice(0,8))}…${escape(m.mint.slice(-6))}</span><div class="candidate-foot"><small>${m.eligible?'Đạt bộ lọc':escape(m.reasons[0]??'Đang đánh giá')}</small></div></article>`).join('')||'<p class="fine">Đang chờ dữ liệu thật. Không tạo token hoặc lợi nhuận giả.</p>';
  $('watchlist').innerHTML=s.watchlist.map(m=>`<span class="watch-token">${escape(m.slice(0,8))}…${escape(m.slice(-5))} <button data-action="remove-token" data-mint="${escape(m)}" aria-label="Xóa token">×</button></span>`).join('');
  $('closed').textContent=`${s.closedCount} lệnh đã đóng`;
  $('status').textContent=s.mode==='live'?(!s.ownerAuthenticated?'● ĐĂNG NHẬP VÍ':s.running?(s.signingMode==='owner-agent'?'● AUTO · VÍ CHỦ':'● THEO DÕI · KÝ BẰNG VÍ'):'● VÍ CHỦ · CHỜ BẬT'):(s.running?'● AUTO · PAPER':'● TẠM DỪNG');
  const d=s.diagnostics;
  $('activity-message').textContent=s.walletMode==='owner'&&ownerState?(s.halted||s.entryStatus?.message|| (s.running?(s.signingMode==='owner-agent'?'Bot tự ký mua/bán trên server; không cần giữ tab mở.':'Đang theo dõi. Bot đề xuất lệnh; bạn xác nhận bằng ví chủ.'):'Đã kết nối ví chủ. Bật theo dõi để chọn tín hiệu.')):d.message;
  $('scan-counts').textContent=`${d.candidates} token trong tập quét · ${d.eligible} đạt bộ lọc · ${s.positions.length} vị thế đang theo dõi`+(d.stages?` · Bị chặn: nguồn ${d.stages.discovery}, thị trường ${d.stages.market}, an toàn ${d.stages.safety}, xác nhận ${d.stages.confirmation}, điểm ${d.stages.score}`:'');
  $('last-evaluation').textContent=(d.lastEvaluationAt?'Đánh giá gần nhất '+time(d.lastEvaluationAt):'Chưa có vòng đánh giá tự động')+` · Mục tiêu ${(d.scanIntervalMs??5000)/1000} giây/lần`;
  $('scan-blockers').innerHTML=d.topBlockers.map(b=>`<span class="blocker">${b.count} token: ${escape(b.reason)}</span>`).join('');
  $('feed-warnings').textContent=(f.warnings??[]).join(' ');
  $('build-revision').textContent='Bản chạy: '+s.buildRevision.slice(0,7);
  $('connection').textContent=fresh?'● Dữ liệu trực tuyến':'● Dữ liệu chưa sẵn sàng';
  $('feed-time').textContent=f.updatedAt?`Giá SOL ${money(f.solUsd)} · ${time(f.updatedAt)}`:'Đang lấy giá thật…';
  $('start').disabled=busy||s.running||!fresh;$('pause').disabled=busy||!s.running;
  $('error').textContent=commandError||s.halted||f.error||'';
  $('risk-summary').innerHTML=[['Vốn hóa tối thiểu',money(cfg.minMarketCapUsd)],['Xu hướng mua','M5 và H1 cùng tăng'],['Nến H4','Tránh đỏ mạnh / tăng vọt rồi xả'],['Mỗi lệnh','0,02–0,03 SOL theo điểm và H4'],['Số vị thế',cfg.maxPositions==null?'Theo vốn khả dụng':cfg.maxPositions],['Dự phòng',`${cfg.reserveSol} SOL`],['Cắt lỗ',`−${cfg.stopLossPct}%`],['Chốt lần đầu',`+${cfg.takeProfitTriggerPct}% → bán 78%`],['Phần thả nổi','2×/4×/8× bán 50% · trailing −30/25/20%'],['Time-stop','45 phút chưa vượt +20%'],['Giữ tối đa','6 giờ'],['Mua lại cùng token','Nghỉ 24 giờ'],['Giá mua','Phải mới ≤30 giây'],['Quote khứ hồi','Hao hụt ≤6%'],['Priority + tip','≤0,002 SOL/chiều'],['Retry','Tối đa 3 lần sau lần đầu'],['Thua liên tiếp','3 lệnh → nghỉ BUY 2 giờ'],['Giới hạn lỗ/ngày',`${cfg.maxDailyLossSol} SOL (UTC)`],['Drawdown tối đa',`${cfg.maxDrawdownPct}%`],['Slippage tối đa','Mua 4% · bán 3% · khẩn 10%'],['Phí đã khớp',s.mode==='live'?'Theo receipt Solana':`${cfg.feeSol} SOL`]].map(([a,b])=>`<div><span>${a}</span><strong>${b}</strong></div>`).join('');
  const curve=s.curve;
  $('chart-empty').hidden=curve.length>0;
  if(curve.length){
    const values=curve.map(p=>p.equitySol), min=Math.min(...values,cfg.initialSol)*.995,max=Math.max(...values,cfg.initialSol)*1.005;
    const points=values.map((v,i)=>`${20+(i/Math.max(1,values.length-1))*720},${210-(v-min)/(max-min)*185}`);
    if(points.length===1)points.push(`740,${points[0].split(',')[1]}`);
    $('line').setAttribute('d','M'+points.join(' L'));$('area').setAttribute('d','M'+points.join(' L')+' L740,230 L20,230 Z');
    $('curve-start').textContent=time(curve[0].at);$('curve-end').textContent=`${fmt(values.at(-1),5)} SOL · ${time(curve.at(-1).at)}`;
  }else{$('line').setAttribute('d','');$('area').setAttribute('d','');}
  $('position-count').textContent=cfg.maxPositions==null?`${s.positions.length} vị thế · theo vốn khả dụng`:`${s.positions.length} / ${cfg.maxPositions}`;
  $('positions').innerHTML=s.positions.map(p=>{
    const m=f.markets.find(m=>m.mint===p.mint),price=m?.priceUsd??p.lastPriceUsd;
    const pnl=p.priceBasis==='sol'?(p.lastQuoteAt&&Date.now()-p.lastQuoteAt<=cfg.maxPriceAgeMs?p.quantity*p.lastPriceSol-p.costSol:null):p.quantity*price*(1-cfg.slippageBps/10000)/f.solUsd-cfg.feeSol-p.costSol;
    return `<tr data-spider-mint="${escape(p.mint)}" data-spider-role="position"><td><strong>${escape(p.symbol)}</strong><span class="mint">${p.phase==='runner'?'Đã thu hồi vốn · x2 tiếp bán 50%':'Chờ +80% thu hồi vốn'}</span><span class="mint">${escape(p.mint)}</span></td><td>${fmt(p.costSol,5)}</td><td>${money(price)}</td><td class="${sign(pnl)}">${signed(pnl)}</td><td><button data-action="sell" data-mint="${escape(p.mint)}" ${!fresh||!m||busy?'disabled':''}>Bán</button></td></tr>`;
  }).join('')||rowEmpty(5,'Chưa có vị thế đã xác nhận.');
  const q=$('search').value.toLowerCase();
  $('markets').innerHTML=f.markets.filter(m=>(m.symbol+m.name+m.mint).toLowerCase().includes(q)).map(m=>{
    const eligible=m.liquidityUsd>=cfg.minLiquidityUsd&&m.volume24hUsd>=cfg.minVolume24hUsd;
    return `<tr><td><strong>${escape(m.symbol)}</strong><span class="mint" title="${escape(m.mint)}">${escape(m.mint.slice(0,8))}…${escape(m.mint.slice(-6))}</span></td><td>${money(m.priceUsd)}</td><td class="${sign(m.change5mPct)}">${m.change5mPct>0?'+':''}${fmt(m.change5mPct,2)}%</td><td>${money(m.liquidityUsd)}</td><td>${money(m.volume24hUsd)}</td><td>${m.buys5m} / ${m.sells5m}</td><td><button data-action="buy" data-mint="${escape(m.mint)}" ${busy||!fresh||!eligible||s.halted||s.positions.some(p=>p.mint===m.mint)?'disabled':''}>${eligible?'Mua':'Lọc thanh khoản'}</button></td></tr>`;
  }).join('')||rowEmpty(7,'Chưa có token phù hợp hoặc đang chờ dữ liệu.');
  $('events').innerHTML=s.events.map(e=>`<div class="event"><time>${time(e.at)}</time>${escape(e.message)}</div>`).join('')||'<p>Nhật ký sẽ xuất hiện khi bot hoạt động.</p>';
  $('trades').innerHTML=s.trades.map(t=>`<div class="event"><time>${time(t.at)}</time><span class="${t.side==='BUY'?'positive':'negative'}">${t.side}</span> ${escape(t.symbol)} · ${fmt(t.sol,5)} SOL${t.pnlSol!==undefined?` · P/L <span class="${sign(t.pnlSol)}">${signed(t.pnlSol)}</span>`:''}<br><span class="subtle">MAINNET · ${escape(t.reason)}</span></div>`).join('')||'<p>Chưa có giao dịch đã xác nhận trên Solana.</p>';
  $('paper-controls').hidden=s.readOnly;$('reset').hidden=s.readOnly;
  const ids=new Set(s.trades.map(t=>[t.at,t.mint,t.side,t.quantity,t.sol].join(':')));
  if(seenPaperTrades)for(const t of [...s.trades].reverse())if(!seenPaperTrades.has([t.at,t.mint,t.side,t.quantity,t.sol].join(':')))window.dispatchEvent(new CustomEvent('meme-trade',{detail:{id:t.signature??[t.at,t.mint,t.side,t.quantity,t.sol].join(':'),side:t.side,mint:t.mint,symbol:t.symbol,mode:s.mode}}));
  seenPaperTrades=ids;
  const activityKey=[s.running,s.halted,s.ownerAuthenticated,s.decisions?.[0]?.at].join(':');
  if(lastActivityKey!==null&&lastActivityKey!==activityKey)window.dispatchEvent(new CustomEvent('meme-activity',{detail:{id:'activity:'+activityKey,text:s.halted?'Đã chạm giới hạn rủi ro':s.running?'Đang phân tích tín hiệu':'Đang theo dõi thị trường',mint:s.halted?undefined:s.decisions?.[0]?.mint,anchor:s.halted?'#risk-summary':s.decisions?.length?'#decision-log':'#activity-message'}}));
  lastActivityKey=activityKey;
  if(s.readOnly){
    for(const button of document.querySelectorAll('#start,#pause,#reset,button[data-action]'))button.disabled=true;
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
window.addEventListener('meme-owner-state',e=>{ownerState=e.detail;render();});
update();setInterval(update,5000);
