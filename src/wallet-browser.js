import {VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';
const $=id=>document.getElementById(id);
let provider=null,live=null,seenLiveTrades=null;
async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Requested-With':'meme-desk'}:{},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error||'Yêu cầu thất bại.');return data;}
function message(text){$('wallet-error').textContent=text;}
async function refresh(){
 try{
  const auth=await api('/api/auth/status');$('wallet-connect').textContent=auth.authenticated?'Đã xác thực ví chủ':'Kết nối ví chủ';
  $('owner-controls').hidden=!auth.authenticated;
  if(!auth.authenticated)return;
  live=await api('/api/live/status');
  const ids=new Set(live.trades.map(t=>t.signature));if(seenLiveTrades)for(const t of [...live.trades].reverse())if(t.signature&&!seenLiveTrades.has(t.signature))window.dispatchEvent(new CustomEvent('meme-trade',{detail:{id:t.signature,side:t.side,symbol:t.symbol,mode:'live'}}));seenLiveTrades=ids;$('live-address').textContent=live.publicKey??'Chưa tạo ví bot';
  $('live-balance').textContent=`${live.lastSyncAt?live.balanceSol.toFixed(6):'Đang đọc số dư'} SOL thật · ${live.enabled?'ĐANG TỰ GIAO DỊCH':live.needsUnlock?'KÉT ĐANG KHÓA':'CHƯA BẬT'}`;
  $('vault-create').hidden=live.exists;$('vault-unlock').hidden=!live.exists||live.unlocked;
  $('fund-bot').disabled=!live.exists||!live.persistentStorage||!live.backupDownloaded||!live.apiKeyConfigured||live.funded;
  $('live-enable').disabled=!live.unlocked||!live.apiKeyConfigured||!live.persistentStorage||live.enabled;
  $('live-pause').disabled=!live.enabled;
  $('vault-lock').disabled=!live.unlocked;
  $('vault-backup').hidden=!live.exists;
  $('live-detail').textContent=live.error||live.entryBlockedReason||(!live.persistentStorage?'Chưa có ổ lưu bền vững trên Railway. Chưa được tạo/nạp ví thật.':!live.apiKeyConfigured?'Cần Jupiter API key để lấy route swap.':live.pending?'Đang đối soát giao dịch: '+live.pending.signature:`RPC: ${live.rpcProvider}. Két mã hóa; chỉ ghi nhận lệnh đã xác nhận trên Solana.`);
  $('live-position-list').replaceChildren();
  for(const p of live.positions){const row=document.createElement('div');row.textContent=`${p.symbol}: ${p.quantity} token · ${p.phase}`;const button=document.createElement('button');button.textContent='Thoát toàn bộ';button.onclick=()=>action(()=>api('/api/live/close',{mint:p.mint}));button.disabled=!live.unlocked||!!live.pending;row.appendChild(button);$('live-position-list').appendChild(row);}
  if(!live.positions.length)$('live-position-list').textContent='Chưa có vị thế mainnet.';
  $('live-withdraw').disabled=!live.unlocked||live.positions.length>0||!!live.pending;
  $('live-fills').textContent=live.trades.map(t=>`${new Date(t.at).toLocaleTimeString('vi-VN')} ${t.side} ${t.symbol} ${t.sol.toFixed(6)} SOL ${t.signature??''}`).join('\n')||'Chưa có giao dịch mainnet xác nhận.';
 }catch(e){message(e.message);}
}
async function connect(){
 provider=window.phantom?.solana??window.solflare??window.solana;
 if(!provider?.connect||!provider.signMessage)throw Error('Cần Phantom hoặc Solflare. Trên điện thoại, mở trang trong trình duyệt của ứng dụng ví.');
 const ownerStatus=await api('/api/auth/status');
 const result=await provider.connect();const address=result.publicKey.toString();
 if(address!==ownerStatus.owner){await provider.disconnect?.();provider=null;throw Error('Ví không được phép. Chỉ ví chủ '+ownerStatus.owner+' được kết nối.');}
 provider.on?.('accountChanged',async key=>{if(provider&&(!key||key.toString()!==ownerStatus.owner)){const previous=provider;provider=null;await api('/api/auth/logout',{}).catch(()=>{});await previous.disconnect?.();message('Đã ngắt phiên vì ví được chọn không phải ví chủ.');await refresh();}});
 const challenge=await api('/api/auth/challenge',{address});const signed=await provider.signMessage(new TextEncoder().encode(challenge.message),'utf8');
 await api('/api/auth/login',{nonce:challenge.nonce,signature:bs58.encode(signed.signature??signed)});await refresh();
}
async function action(fn){message('');try{await fn();}catch(e){message(e.message);}finally{await refresh();}}
$('wallet-connect').onclick=()=>action(connect);
$('vault-form').onsubmit=e=>{e.preventDefault();action(async()=>{const password=$('vault-password').value,apiKey=$('jupiter-key').value,heliusKey=$('helius-key').value;await api(live?.exists?'/api/live/unlock':'/api/live/create',{password,apiKey,heliusKey});$('vault-password').value='';$('jupiter-key').value='';$('helius-key').value='';});};
$('vault-create').onclick=()=>{};
$('fund-bot').onclick=()=>action(async()=>{
 if(!provider)await connect();
 const prepared=await api('/api/live/fund',{});const bytes=Uint8Array.from(atob(prepared.transaction),c=>c.charCodeAt(0));
 await provider.signAndSendTransaction(VersionedTransaction.deserialize(bytes));message('Đã gửi yêu cầu nạp. Chờ mạng xác nhận trước khi bật bot.');
});
$('live-enable').onclick=()=>action(async()=>{if(!confirm('Bật giao dịch MAINNET thật? Bot được tự ký tối đa 0,03 SOL/lệnh, 5 vị thế, giới hạn lỗ/ngày 0,03 SOL. Bạn có thể mất vốn.'))return;await api('/api/live/enable',{confirm:'ENABLE MAINNET 0.3 SOL'});});
$('live-pause').onclick=()=>action(()=>api('/api/live/pause',{}));
$('live-withdraw').onclick=()=>action(async()=>{if(!confirm('Rút SOL về đúng ví chủ đã cấu hình? Cần đóng hết vị thế trước.'))return;await api('/api/live/withdraw',{confirm:'WITHDRAW TO OWNER'});});
$('vault-lock').onclick=()=>action(()=>api('/api/live/lock',{}));
refresh();setInterval(refresh,10000);
