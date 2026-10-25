// Display-only activity. Polling this endpoint never requests market/RPC data.
const local=new Map(),flashes=new Map(),seen=new Set();let remote=[],painted=new Set(),primed=false,previous=null,sequence=0,polling=false;
function targets(item){const out=(item.panels??[]).map(id=>document.getElementById(id)).filter(Boolean);if(item.mint)for(const el of document.querySelectorAll('[data-token-mint]'))if(el.dataset.tokenMint===item.mint&&(!item.roles||item.roles.includes(el.dataset.activityRole)))out.push(el);return out;}
export function syncActivity(){
 const now=Date.now();for(const [key,item]of flashes)if(item.until<=now)flashes.delete(key);
 const next=new Map();for(const item of [...flashes.values(),...remote,...local.values()])for(const el of targets(item)){const old=next.get(el);if(!old||item.active||!old.active)next.set(el,item);}
 for(const el of new Set([...painted,...next.keys()])){const item=next.get(el);el.classList.toggle('activity-working',!!item?.active);el.classList.toggle('activity-updated',!!item&&!item.active);if(item)el.dataset.activityTone=item.tone??'work';else delete el.dataset.activityTone;
  if(el.hasAttribute('data-activity-panel')){el.setAttribute('aria-busy',String(!!item?.active));const label=el.querySelector('[data-activity-label]');if(label)label.textContent=item?.label??'';}
 }painted=new Set(next.keys());
}
function flash(key,item){if(seen.has(key))return;seen.add(key);if(seen.size>200)seen.delete(seen.values().next().value);flashes.set(key,{...item,active:false,until:Date.now()+2800});}
export function showFillActivity(trade){const sell=trade.side==='SELL',label=trade.side==='EXTERNAL'?'Đã đồng bộ số dư ví · PnL chưa xác minh':trade.side==='FEE'?'Đã ghi nhận phí mạng':trade.mode==='live'?'Đã xác nhận '+trade.side+' on-chain':sell?'Đã khớp SELL mô phỏng':'Đã khớp BUY mô phỏng';flash('fill:'+trade.id,{panels:['account-panel','positions-panel','trades-panel'],mint:trade.mint,roles:['position','trade','candidate'],tone:sell?'sell':'work',label});syncActivity();}
export async function runActivity(panel,label,work){const key='local:'+ ++sequence;local.set(key,{panels:[panel],label,active:true});syncActivity();try{const result=await work();flash(key,{panels:[panel],label:'Đã xử lý'});return result;}finally{local.delete(key);syncActivity();}}
function update(value){
 remote=[];if(!value){syncActivity();return;}
 if(value.scanning)remote.push({panels:['gainers-panel','scanner-panel'],active:true,label:'Đang quét thị trường'});
 for(const row of value.verification??[])remote.push({panels:['gainers-panel','scanner-panel'],mint:row.mint,roles:['candidate','decision'],active:true,label:'Đang kiểm tra an toàn token'});
 for(const row of value.market?.active??[]){const sell=row.kind==='SELL',buy=row.kind==='BUY',quote=sell||buy;remote.push({panels:quote?['positions-panel','gainers-panel']:['gainers-panel','scanner-panel'],mint:row.mint,roles:['position','candidate','decision'],active:true,tone:sell?'sell':'work',label:quote?`Đang lấy quote ${row.kind}`:'Đang xác minh token / quote vòng'});}
 for(const pending of value.pendingEntries??[])remote.push({panels:['positions-panel'],mint:pending.mint,roles:['candidate','position'],active:true,label:'BUY trong hàng chờ riêng'});
 if(value.pending)remote.push({panels:['account-panel','positions-panel','trades-panel'],mint:value.pending.mint,roles:['position','candidate','trade'],active:true,tone:value.pending.side==='SELL'?'sell':'work',label:value.pending.label??`Đang chờ khớp ${value.pending.side} mô phỏng`});
 if(value.reporting||value.telegram)remote.push({panels:['telegram-panel'],active:true,label:value.telegram?'Đang gửi Telegram':'Đang lập báo cáo'});
 if(primed){if(value.scanCompletedAt&&value.scanCompletedAt!==previous?.scanCompletedAt)flash('scan:'+value.scanCompletedAt,{panels:['scanner-panel','gainers-panel'],label:'Đã cập nhật vòng quét'});
  if(value.lastSentAt&&value.lastSentAt!==previous?.lastSentAt)flash('telegram:'+value.lastSentAt,{panels:['telegram-panel'],label:'Telegram đã xác nhận gửi'});
  if(value.reportQueuedEnd!==previous?.reportQueuedEnd)flash('report:'+value.reportQueuedEnd,{panels:['telegram-panel'],label:'Đã lập báo cáo'});
  for(const row of value.market?.recent??[])if(row.status==='done')flash('read:'+row.id,{panels:row.kind==='SELL'||row.kind==='BUY'?['positions-panel']:['gainers-panel'],mint:row.mint,roles:['position','candidate','decision'],tone:row.kind==='SELL'?'sell':'work',label:row.kind==='SELL'||row.kind==='BUY'?'Đã nhận quote mới':'Đã cập nhật kiểm chứng'});
 }else{for(const row of value.market?.recent??[])seen.add('read:'+row.id);primed=true;}
 previous=value;syncActivity();
}
async function poll(){if(polling||document.hidden)return;polling=true;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),4000);try{const response=await fetch('/api/activity',{signal:controller.signal,cache:'no-store'});if(!response.ok)throw Error('activity unavailable');const value=await response.json();if(!document.hidden)update(value);}catch{update(null);}finally{clearTimeout(timeout);polling=false;}}
document.addEventListener('visibilitychange',()=>{if(document.hidden)update(null);else poll();});
poll();setInterval(poll,1000);
