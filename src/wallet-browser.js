import {VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {connectedWalletAddress} from './wallet-provider.js';
import {createOwnerLedger,nextOwnerOrder,ownerExit,applyOwnerReceipt} from './owner-ledger.js';
import {DEFAULTS,equity,event} from './engine.js';
const $=id=>document.getElementById(id);
let provider=null,owner=null,ledger=null,wallet=null,feed=null,proposal=null,refreshing=false,signing=false;
async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Requested-With':'meme-desk'}:{},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error||'Yêu cầu thất bại.');return data;}
const storageKey=()=>`meme-pilot-owner-ledger-v1:${owner}`;
function message(text){$('wallet-error').textContent=text;}
function validateLedger(value){
 if(value?.ownerLedgerVersion!==1||value.owner!==owner||!Array.isArray(value.positions)||value.positions.length>5||!Array.isArray(value.trades)||!Array.isArray(value.events)||!Array.isArray(value.curve)||!Array.isArray(value.recordedSignatures)||!Number.isFinite(value.cashSol)||!(value.settings?.initialSol>0&&value.settings.initialSol<=.3))throw Error('Nhật ký không hợp lệ hoặc thuộc ví khác. Không ghi đè dữ liệu đang có.');
 for(const p of value.positions)if(typeof p.rawQuantity!=='string'||!/^\d{1,20}$/.test(p.rawQuantity)||BigInt(p.rawQuantity)<=0n||!Number.isInteger(p.decimals)||p.decimals<0||p.decimals>9||!Number.isFinite(p.quantity)||!(p.quantity>0))throw Error('Vị thế trong nhật ký không hợp lệ.');
 return {...value,settings:{...DEFAULTS,initialSol:value.settings.initialSol},running:false};
}
function save(){
 try{localStorage.setItem(storageKey(),JSON.stringify(ledger));}catch{if(ledger)ledger.running=false;throw Error('Không lưu được nhật ký trên trình duyệt. Đã dừng chuẩn bị lệnh; cho phép lưu trữ hoặc xuất bản sao trước khi tiếp tục.');}
}
function load(){const text=localStorage.getItem(storageKey());if(!text)return;ledger=validateLedger(JSON.parse(text));save();}
async function watch(){const mints=[...new Set([...(ledger?.positions??[]).map(p=>p.mint),...(ledger?.pending?[ledger.pending.intent.mint]:[])])];await api('/api/direct/watch',{mints});}
function publish(){
 if(!wallet){window.dispatchEvent(new CustomEvent('meme-owner-state',{detail:null}));return;}
 const s=ledger??{positions:[],trades:[],curve:[],events:[],settings:DEFAULTS,running:false,halted:null,peakEquity:null,maxDrawdownObservedPct:null};
 const closed=s.trades.filter(t=>t.side==='SELL'&&t.closed),value=feed?.solUsd?equity(s,feed.markets,feed.solUsd):null;
 window.dispatchEvent(new CustomEvent('meme-owner-state',{detail:{walletMode:'owner',running:s.running,settings:s.settings,cashSol:wallet.balanceSol,equitySol:wallet.balanceSol,budgetCashSol:s.cashSol,pnlSol:value===null||!ledger?null:value-s.settings.initialSol,positions:s.positions,trades:s.trades,curve:s.curve,events:s.events,halted:s.halted,peakEquity:s.peakEquity,maxDrawdownObservedPct:s.maxDrawdownObservedPct,closedCount:closed.length,winRate:closed.length?closed.filter(t=>(t.positionPnlSol??t.pnlSol)>0).length/closed.length:null,bought:s.trades.filter(t=>t.side==='BUY').length}}));
}
function render(){
 $('live-address').textContent=owner??'';
 $('live-balance').textContent=wallet?`${wallet.balanceSol.toFixed(6)} SOL khả dụng trong ví chủ`:'Đang đọc số dư ví chủ…';
 $('live-detail').textContent=ledger?.pending?(ledger.pending.transaction?'Đang đối soát giao dịch đã ký. Không ký lệnh mới.':'Còn yêu cầu chưa gửi. Nếu phiên ký bị gián đoạn, bấm Hủy yêu cầu chưa gửi.'):`RPC: ${wallet?.rpcProvider??'chưa kết nối'} · Jupiter ${wallet?.apiKeyConfigured?'đã cấu hình':'chưa có API key'}. Mỗi lệnh cần bạn xác nhận trong ứng dụng ví.`;
 $('live-enable').disabled=!!ledger?.running||!wallet?.apiKeyConfigured||!!ledger?.pending;
 $('live-pause').disabled=!ledger?.running;
 $('cancel-order').disabled=!ledger?.pending||!!ledger?.pending?.transaction||signing;
 $('sign-order').disabled=signing||!proposal||!!ledger?.pending||!ledger?.running;
 $('sign-order').textContent=proposal?`Ký ${proposal.side==='BUY'?'mua':'bán'} ${proposal.symbol}`:'Chưa có lệnh cần ký';
 $('order-preview').textContent=ledger?.pending?'Signature: '+(ledger.pending.signature??'đang chờ ký'):proposal?`${proposal.side==='BUY'?'MUA 0,03 SOL':'BÁN token đang quản lý'} · ${proposal.symbol} · ${proposal.reason}`:ledger?.running?'Đang chờ tín hiệu đạt bộ lọc.':'Bật theo dõi để bot chọn tín hiệu mua và thoát lệnh.';
 $('live-position-list').replaceChildren();
 for(const p of ledger?.positions??[]){const row=document.createElement('div');row.textContent=`${p.symbol}: ${p.quantity} token · ${p.phase} `;const button=document.createElement('button');button.textContent='Ký bán toàn bộ vị thế';button.disabled=signing||!!ledger.pending;button.onclick=()=>action(()=>lockedSign(ownerExit(ledger,p.mint,1,'owner-exit',feed?.solUsd)));row.appendChild(button);$('live-position-list').appendChild(row);}
 if(!ledger?.positions.length)$('live-position-list').textContent='Chưa có vị thế được ứng dụng ghi nhận. Token khác trong ví không tự động bị bán.';
 $('live-fills').textContent=ledger?.trades.map(t=>`${new Date(t.at).toLocaleTimeString('vi-VN')} ${t.side} ${t.symbol} ${t.sol.toFixed(6)} SOL ${t.signature}`).join('\n')||'Lệnh đã xác nhận sẽ hiện tại đây.';
 publish();
}
async function reconcile(){
 if(!ledger?.pending?.transaction||signing)return;
 const pending=ledger.pending,result=await api('/api/direct/reconcile',{intent:pending.intent,transaction:pending.transaction});
 if(result.status==='pending')return;
 const confirmed=applyOwnerReceipt(ledger,pending,result);save();
 if(confirmed)window.dispatchEvent(new CustomEvent('meme-trade',{detail:{id:result.signature,side:pending.intent.side,symbol:pending.intent.symbol,mode:'live'}}));
 if(result.status!=='confirmed')message(result.status==='failed'?'Lệnh thất bại trên Solana; đã ghi nhận phí mạng.':'Lệnh hết hạn; không gửi lại tự động.');
 await watch();
}
async function refresh(){
 if(refreshing)return;refreshing=true;
 try{
  const auth=await api('/api/auth/status');$('wallet-connect').textContent=auth.authenticated?'Kết nối lại ví chủ':'Kết nối ví chủ';$('owner-controls').hidden=!auth.authenticated;
  if(!auth.authenticated){if(ledger)ledger.running=false;window.dispatchEvent(new CustomEvent('meme-owner-state',{detail:null}));return;}
  if(owner!==auth.owner){owner=auth.owner;ledger=null;load();}
  await watch();await reconcile();wallet=await api('/api/direct/status');feed=(await api('/api/state')).feed;
  if(ledger&&!ledger.pending){
   for(const p of ledger.positions)if(BigInt(wallet.tokenBalances[p.mint]??'0')<BigInt(p.rawQuantity)){ledger.running=false;throw Error('Số token trong ví thấp hơn sổ ứng dụng. Đã dừng theo dõi; kiểm tra giao dịch ngoài ứng dụng trước khi tiếp tục.');}
   proposal=ledger.running?nextOwnerOrder(ledger,feed,wallet.balanceSol):null;
   if((ledger.running||ledger.trades.length>0)&&feed.updatedAt&&feed.solUsd&&!feed.error&&Date.now()-feed.updatedAt<90000&&ledger.lastMarkAt!==feed.updatedAt){ledger.curve.push({at:Date.now(),equitySol:equity(ledger,feed.markets,feed.solUsd)});ledger.curve=ledger.curve.slice(-1440);ledger.lastMarkAt=feed.updatedAt;}
   save();
  }else proposal=null;
  render();
 }catch(e){if(ledger)ledger.running=false;proposal=null;message(e.message);render();}
 finally{refreshing=false;}
}
async function connect(){
 const walletProvider=window.phantom?.solana??window.solflare??window.solana;
 if(!walletProvider?.connect||!walletProvider.signMessage)throw Error('Mở trang trong Phantom hoặc Solflare rồi kết nối ví chủ.');
 const auth=await api('/api/auth/status'),result=await walletProvider.connect();let address;
 try{address=connectedWalletAddress(walletProvider,result);if(address!==auth.owner)throw Error('Ví không được phép. Chỉ ví chủ '+auth.owner+' được kết nối.');}
 catch(e){provider=null;try{await walletProvider.disconnect?.();}catch{}throw e;}
 const challenge=await api('/api/auth/challenge',{address}),signed=await walletProvider.signMessage(new TextEncoder().encode(challenge.message),'utf8');
 await api('/api/auth/login',{nonce:challenge.nonce,signature:bs58.encode(signed.signature??signed)});provider=walletProvider;
 walletProvider.on?.('accountChanged',async key=>{if(provider===walletProvider&&(!key||key.toString()!==auth.owner)){provider=null;if(ledger)ledger.running=false;await api('/api/auth/logout',{}).catch(()=>{});message('Đã ngắt phiên vì thay sang ví khác.');await refresh();}});
 await refresh();
}
async function signOrder(order){
 if(signing||ledger?.pending)throw Error('Còn lệnh đang ký hoặc đang đối soát.');
 if(!provider)await connect();
 if(!ledger||!order)throw Error('Chưa có tín hiệu để ký.');
 const auth=await api('/api/auth/status');if(!auth.authenticated)throw Error('Phiên đăng nhập hết hạn. Kết nối lại ví chủ.');
 if(connectedWalletAddress(provider)!==auth.owner)throw Error('Chọn lại đúng ví chủ trước khi ký.');
 if(typeof provider.signTransaction!=='function')throw Error('Ví cần hỗ trợ signTransaction. Cập nhật Phantom/Solflare rồi thử lại.');
 signing=true;let prepared;
 try{
  // Re-read the shared journal under the browser's signing lock before preparing an order.
  const latest=localStorage.getItem(storageKey());if(latest){const current=JSON.parse(latest);if(current.pending)throw Error('Tab khác còn giao dịch đang đối soát.');const wasRunning=ledger.running;ledger=validateLedger(current);ledger.running=wasRunning&&current.running;}
  if(order.reason!=='owner-exit'&&!ledger.running)throw Error('Đã dừng theo dõi; không chuẩn bị lệnh mới.');
  if(order.side==='BUY'&&nextOwnerOrder(ledger,feed,wallet.balanceSol)?.mint!==order.mint)throw Error('Tín hiệu hoặc ngân sách đã thay đổi. Chờ vòng quét mới.');
  prepared=await api('/api/direct/prepare',order);
  if(order.side==='SELL'&&BigInt(prepared.intent.amount)>BigInt(ledger.positions.find(p=>p.mint===order.mint)?.rawQuantity??'0'))throw Error('Báo giá yêu cầu bán quá lượng token ứng dụng quản lý.');
  ledger.pending={intent:prepared.intent,unsignedTransaction:prepared.transaction,transaction:null};save();render();
  const unsigned=VersionedTransaction.deserialize(Uint8Array.from(atob(prepared.transaction),c=>c.charCodeAt(0))),expected=bs58.encode(unsigned.message.serialize());
  const signed=await provider.signTransaction(unsigned);
  if(typeof signed?.serialize!=='function'||bs58.encode(signed.message.serialize())!==expected||signed.signatures[0].every(b=>b===0))throw Error('Ví chưa ký đúng nội dung giao dịch.');
  if(order.reason!=='owner-exit'&&!ledger.running)throw Error('Đã dừng theo dõi trong lúc chờ ký; không gửi giao dịch.');
  const stored=JSON.parse(localStorage.getItem(storageKey())??'null');if(stored?.pending?.intent?.id!==prepared.intent.id)throw Error('Yêu cầu đã bị hủy hoặc thay đổi ở tab khác.');
  ledger.pending={intent:prepared.intent,transaction:btoa(String.fromCharCode(...signed.serialize())),signature:bs58.encode(signed.signatures[0])};save();
  // The signed signature is stored locally BEFORE any broadcast request.
  await api('/api/direct/submit',{id:prepared.intent.id,transaction:ledger.pending.transaction});
  message('Đã gửi giao dịch ví chủ ký. Chờ Solana xác nhận.');
 }catch(e){
  if(!ledger?.pending?.transaction){if(prepared)await api('/api/direct/cancel',{id:prepared.intent.id}).catch(()=>{});if(ledger){ledger.pending=null;ledger.running=false;save();}}
  else message('Đang giữ signature để đối soát; không ký lại lệnh này.');
  throw e;
 }finally{signing=false;render();}
}
async function lockedSign(order){if(navigator.locks)return navigator.locks.request('meme-pilot-owner-sign',{ifAvailable:true},async lock=>{if(!lock)throw Error('Tab khác đang ký lệnh.');return signOrder(order);});return signOrder(order);}
async function action(fn){message('');try{await fn();}catch(e){message(e.message);}finally{await refresh();}}
$('wallet-connect').onclick=()=>action(connect);
$('rpc-form').onsubmit=e=>{e.preventDefault();action(async()=>{await api('/api/direct/config',{apiKey:$('jupiter-key').value,heliusKey:$('helius-key').value});$('jupiter-key').value='';$('helius-key').value='';});};
$('live-enable').onclick=()=>action(async()=>{if(!wallet)throw Error('Chờ đọc số dư ví chủ.');if(!ledger){ledger=createOwnerLedger(owner,wallet.balanceSol);save();}ledger.running=true;save();});
$('live-pause').onclick=()=>action(async()=>{if(ledger){ledger.running=false;proposal=null;save();render();}});
$('cancel-order').onclick=()=>action(async()=>{if(signing)throw Error('Ví đang ký. Hủy trong ứng dụng ví trước.');const current=JSON.parse(localStorage.getItem(storageKey())??'null');if(!current?.pending||current.pending.transaction)throw Error('Chỉ hủy được yêu cầu chưa gửi.');await api('/api/direct/cancel',{id:current.pending.intent.id});ledger=validateLedger(current);ledger.pending=null;save();});
$('sign-order').onclick=()=>action(()=>lockedSign(proposal));
$('ledger-export').onclick=()=>{if(!ledger)return message('Chưa có nhật ký để xuất.');const blob=new Blob([JSON.stringify(ledger,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='meme-pilot-owner-ledger.json';a.click();URL.revokeObjectURL(url);};
$('ledger-import').onchange=e=>action(async()=>{if(signing||ledger?.pending)throw Error('Đợi đối soát xong trước khi khôi phục.');const file=e.target.files[0];if(!file)return;if(file.size>2*1024*1024)throw Error('Tệp nhật ký quá lớn.');ledger=validateLedger(JSON.parse(await file.text()));save();});
window.addEventListener('storage',e=>{if(e.key===storageKey()&&!signing){if(ledger)ledger.running=false;ledger=null;proposal=null;try{load();}catch(err){message(err.message);}refresh();}});
refresh();setInterval(refresh,10000);
