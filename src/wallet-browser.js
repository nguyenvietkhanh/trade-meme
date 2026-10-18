import {VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {connectedWalletAddress} from './wallet-provider.js';
import {createOwnerLedger,nextOwnerOrder,ownerExit,applyOwnerReceipt,allocateOwnerCapital} from './owner-ledger.js';
import {DEFAULTS,equity,event} from './engine.js';
import {profitOrder,PROFIT_RECIPIENT} from './profit.js';
import {auditDesk} from './auditor.js';
import {clearLegacyDailyHalt,clearLegacyLossPause,walletOrderSol,WALLET_ORDER_FRACTION,WALLET_SIZING_VERSION,CURVE_RULES} from './desk-rules.js';
const $=id=>document.getElementById(id);
let provider=null,owner=null,ledger=null,wallet=null,feed=null,proposal=null,refreshing=false,signing=false,signerAvailable=false,signerStatus=null,recoveryProof=null;
async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Requested-With':'meme-desk'}:{},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error||'Yêu cầu thất bại.');return data;}
const storageKey=()=>`meme-pilot-owner-ledger-v1:${owner}`;
function message(text){$('wallet-error').textContent=text;}
function validateLedger(value){
 if(value?.ownerLedgerVersion!==1||value.owner!==owner||!Array.isArray(value.positions)||!Array.isArray(value.trades)||!Array.isArray(value.events)||!Array.isArray(value.curve)||!Array.isArray(value.recordedSignatures)||!Number.isFinite(value.cashSol)||!(Number.isFinite(value.settings?.initialSol)&&value.settings.initialSol>=0&&Number.isSafeInteger(Math.round(value.settings.initialSol*1e9))))throw Error('Nhật ký không hợp lệ hoặc thuộc ví khác. Không ghi đè dữ liệu đang có.');
 for(const p of value.positions)if(typeof p.rawQuantity!=='string'||!/^\d{1,20}$/.test(p.rawQuantity)||BigInt(p.rawQuantity)<=0n||!Number.isInteger(p.decimals)||p.decimals<0||p.decimals>9||!Number.isFinite(p.quantity)||!(p.quantity>0))throw Error('Vị thế trong nhật ký không hợp lệ.');
 const externalWithdrawnSol=value.externalWithdrawnSol??0;if(!Number.isFinite(externalWithdrawnSol)||externalWithdrawnSol<0)throw Error('Dòng tiền ngoài sổ không hợp lệ.');
 const withdrawnSol=value.withdrawnSol??0,payoutFeesSol=value.payoutFeesSol??0;
 if(!Number.isFinite(withdrawnSol)||withdrawnSol<0||!Number.isFinite(payoutFeesSol)||payoutFeesSol<0||!Array.isArray(value.payouts??[]))throw Error('Nhật ký chuyển lãi không hợp lệ.');
 const realizedNetSol=value.realizedNetSol??value.cashSol+value.positions.reduce((sum,p)=>sum+p.costSol,0)+withdrawnSol+externalWithdrawnSol+payoutFeesSol-value.settings.initialSol;
 if(!Number.isFinite(realizedNetSol))throw Error('Không xác minh được lãi đã chốt.');
 for(const p of value.payouts??[])if(p.recipient!==PROFIT_RECIPIENT||!Number.isFinite(p.amountSol)||p.amountSol<=0||!Number.isFinite(p.feeSol)||p.feeSol<0)throw Error('Lịch sử nhận lãi không hợp lệ.');
 clearLegacyDailyHalt(value);clearLegacyLossPause(value);
 return {...value,realizedNetSol,withdrawnSol,externalWithdrawnSol,payoutFeesSol,payouts:value.payouts??[],settings:{...DEFAULTS,initialSol:value.settings.initialSol,orderSol:walletOrderSol(value.cashSol),smallOrderSol:walletOrderSol(value.cashSol),orderFraction:WALLET_ORDER_FRACTION,sizingVersion:WALLET_SIZING_VERSION},running:false};
}
function save(){
 try{localStorage.setItem(storageKey(),JSON.stringify(ledger));}catch{if(ledger)ledger.running=false;throw Error('Không lưu được nhật ký trên trình duyệt. Đã dừng chuẩn bị lệnh; cho phép lưu trữ hoặc xuất bản sao trước khi tiếp tục.');}
}
function load(){const text=localStorage.getItem(storageKey());if(!text)return;ledger=validateLedger(JSON.parse(text));save();}
async function watch(){const mints=[...new Set([...(ledger?.positions??[]).map(p=>p.mint),...(ledger?.pending?[ledger.pending.intent.mint]:[])])].filter(Boolean);await api('/api/direct/watch',{mints});}
function publish(){
 if(!wallet){window.dispatchEvent(new CustomEvent('meme-owner-state',{detail:null}));return;}
 const s=ledger??{positions:[],trades:[],curve:[],events:[],settings:DEFAULTS,running:false,halted:null,peakEquity:null,maxDrawdownObservedPct:null};
 const closed=s.trades.filter(t=>t.side==='SELL'&&t.closed),value=feed?.solUsd?equity(s,feed.markets,feed.solUsd):null;
 window.dispatchEvent(new CustomEvent('meme-owner-state',{detail:{walletMode:'owner',signingMode:signerAvailable?'owner-agent':'owner-wallet',entryStatus:signerStatus?.entryStatus??null,running:s.running,settings:{...s.settings,orderSol:walletOrderSol(wallet.balanceSol),orderFraction:WALLET_ORDER_FRACTION,sizingVersion:WALLET_SIZING_VERSION},cashSol:wallet.balanceSol,equitySol:wallet.balanceSol,budgetCashSol:s.cashSol,pnlSol:value===null||!ledger||s.recoveryRequired||signerStatus?.recoveryMessage?null:value-s.settings.initialSol,positions:s.positions,trades:s.trades,curve:s.curve,events:s.events,halted:s.halted,peakEquity:s.peakEquity,maxDrawdownObservedPct:s.maxDrawdownObservedPct,closedCount:closed.length,winRate:closed.length?closed.filter(t=>(t.positionPnlSol??t.pnlSol)>0).length/closed.length:null,bought:s.trades.filter(t=>t.side==='BUY').length}}));
}
function setupSignerUI(){
 const panel=$('signer-controls');panel.hidden=!signerAvailable;if(!signerAvailable||panel.dataset.ready)return;
 panel.dataset.ready='true';panel.innerHTML=`<p class="fine">Khóa ví được mã hóa bằng mật khẩu trước khi ghi server. Sau khi mở khóa, bot có thể ký cho toàn bộ ví; PumpSwap dùng 20%, pump.fun trước migrate dùng 5% số dư SOL mới đọc, luôn giữ dự phòng gas 0,05 SOL. Đây là giới hạn phần mềm.</p><form id="signer-import-form"><label>Khóa riêng ví chủ (base58 hoặc JSON 64 byte, không nhập seed)<input id="owner-private-key" type="password" autocomplete="off" spellcheck="false" required></label><label>Mật khẩu mã hóa (ít nhất 12 ký tự)<input id="owner-vault-password" type="password" autocomplete="new-password" minlength="12" required></label><button type="submit">Mã hóa và lưu bộ ký</button></form><form id="signer-unlock-form"><label>Mật khẩu mở bộ ký<input id="owner-unlock-password" type="password" autocomplete="current-password" required></label><button type="submit">Mở khóa bộ ký</button></form><button id="signer-pause-buys">Tạm dừng BUY · vẫn quản lý SELL</button><button id="signer-lock">Dừng và khóa bộ ký</button><button id="signer-review-risk" hidden>Xác nhận đã xem lại drawdown</button><p id="signer-storage" class="fine"></p><h3>Token trong ví · Khôi phục tùy chọn</h3><p id="inventory-status" class="fine"></p><div id="wallet-inventory"></div><p id="recovery-warning" role="status"></p><form id="recovery-form"><label>Địa chỉ token<input id="recovery-mint" type="text" autocomplete="off" required></label><label>Link Solscan hoặc Transaction ID của lần mua<input id="recovery-signature" type="text" autocomplete="off" required></label><button id="recovery-preview" type="submit">Kiểm tra giao dịch mua</button></form><p id="recovery-detail" role="status" aria-live="polite"></p><button id="recovery-apply" type="button" hidden>Khôi phục vị thế đã xác minh</button><p class="fine">Khôi phục chỉ ghi sổ, không mua/bán hoặc ký giao dịch. Không tự quản lý token khác trong ví. Khôi phục là tùy chọn. Sau khôi phục bot vẫn dừng để bạn bật lại BUY/SELL; lịch sử tài khoản thiếu thì chưa tự chuyển lãi.</p><h3>Telegram · Báo cáo giao dịch</h3><p id="telegram-status" class="fine"></p><form id="telegram-form"><label>Bot token<input id="telegram-token" type="password" autocomplete="off" spellcheck="false" required></label><label>Chat ID<input id="telegram-chat-id" type="text" autocomplete="off" spellcheck="false" required></label><button type="submit">Lưu và bật báo cáo Telegram</button></form><button id="telegram-test" type="button">Gửi tin thử</button><button id="telegram-disable" type="button">Tắt Telegram</button>`;
 $('signer-import-form').onsubmit=e=>{e.preventDefault();action(async()=>{try{await api('/api/signer/import',{secret:$('owner-private-key').value,password:$('owner-vault-password').value});}finally{$('owner-private-key').value='';$('owner-vault-password').value='';}});};
 $('signer-unlock-form').onsubmit=e=>{e.preventDefault();action(async()=>{try{await api('/api/signer/unlock',{password:$('owner-unlock-password').value});}finally{$('owner-unlock-password').value='';}});};
 $('signer-review-risk').onclick=()=>action(async()=>{if(window.confirm('Đặt lại mốc drawdown theo vốn hiện tại sau khi bạn đã xem lại? Bot sẽ chưa tự bật.'))await api('/api/signer/review-risk',{confirm:'REVIEW DRAWDOWN'});});
 $('signer-pause-buys').onclick=()=>action(()=>api('/api/signer/pause-buys',{paused:!ledger?.buyPaused}));
 $('signer-lock').onclick=()=>action(()=>api('/api/signer/lock',{}));
 const params=new URLSearchParams(location.search);$('recovery-mint').value=params.get('recoverMint')??'';$('recovery-signature').value=params.get('recoverTx')??'';
 const invalidateRecovery=()=>{recoveryProof=null;$('recovery-apply').hidden=true;$('recovery-detail').textContent='';};
 $('recovery-mint').oninput=invalidateRecovery;$('recovery-signature').oninput=invalidateRecovery;
 $('recovery-form').onsubmit=e=>{e.preventDefault();action(async()=>{invalidateRecovery();$('recovery-detail').textContent='Đang đối chiếu receipt và số token hiện có…';try{const result=await api('/api/signer/recovery-preview',{mint:$('recovery-mint').value,signature:$('recovery-signature').value});recoveryProof=result.proof;$('recovery-detail').textContent=`Đã xác minh: ${recoveryProof.quantity} token · vốn thực trừ ví ${recoveryProof.costSol.toFixed(9)} SOL (đã gồm phí/rent trong delta, không cộng lần hai) · ${new Date(recoveryProof.openedAt).toLocaleString('vi-VN')}. Chưa khôi phục. Chưa đủ lịch sử để kết luận lãi/lỗ toàn tài khoản.`;$('recovery-apply').hidden=false;}catch(err){$('recovery-detail').textContent=err.message;throw err;}});};
 $('recovery-apply').onclick=()=>action(async()=>{if(!recoveryProof)return;await api('/api/signer/recovery-apply',{mint:recoveryProof.mint,signature:recoveryProof.signature});recoveryProof=null;$('recovery-apply').hidden=true;$('recovery-detail').textContent='Đã ghi lại vị thế từ receipt, không trừ SOL lần hai. Bot vẫn dừng. Mở khóa và bấm Bật tự giao dịch để tiếp tục BUY/SELL. Lịch sử tài khoản thiếu thì chưa tự chuyển lãi.';});
 $('telegram-form').onsubmit=e=>{e.preventDefault();action(async()=>{try{await api('/api/signer/telegram-config',{token:$('telegram-token').value,chatId:$('telegram-chat-id').value});}finally{$('telegram-token').value='';$('telegram-chat-id').value='';}});};
 $('telegram-test').onclick=()=>action(()=>api('/api/signer/telegram-test',{}));
 $('telegram-disable').onclick=()=>action(()=>api('/api/signer/telegram-disable',{}));
}
function render(){
 $('live-address').textContent=owner??'';
 $('live-balance').textContent=Number.isFinite(wallet?.balanceSol)?`${wallet.balanceSol.toFixed(6)} SOL khả dụng trong ví chủ`:'Đang đọc số dư ví chủ…';
 const nextSize=walletOrderSol(wallet?.balanceSol),nextCurveSize=walletOrderSol(wallet?.balanceSol,CURVE_RULES.orderFraction);$('next-order-size').textContent=!Number.isFinite(wallet?.balanceSol)?'':nextSize||nextCurveSize?`Lệnh PumpSwap: ${nextSize.toLocaleString('vi-VN',{maximumFractionDigits:9})} SOL (20% ví); pump.fun trước migrate: ${walletOrderSol(wallet?.balanceSol,CURVE_RULES.orderFraction).toLocaleString('vi-VN',{maximumFractionDigits:9})} SOL (5% ví). Giữ ít nhất 0,05 SOL dự phòng cùng phí dự tính.`:'Chưa đủ SOL cho lệnh mới mà vẫn giữ dự phòng gas và phí.';
 $('manual-sign-option').hidden=signerAvailable;$('sign-order').hidden=signerAvailable;$('cancel-order').hidden=signerAvailable;
 $('live-enable').textContent=signerAvailable?'Bật tự giao dịch':'Bật bot chọn lệnh';
 if(signerAvailable){$('owner-heading').textContent='BỘ KÝ TỰ ĐỘNG · VÍ CHỦ';$('signer-import-form').hidden=!!signerStatus?.vault?.exists;$('signer-unlock-form').hidden=!signerStatus?.vault?.exists||!!signerStatus?.vault?.unlocked;$('signer-pause-buys').textContent=ledger?.buyPaused?'Tiếp tục BUY':'Tạm dừng BUY · vẫn quản lý SELL';$('signer-review-risk').hidden=ledger?.haltKind!=='drawdown';$('signer-review-risk').disabled=!!ledger?.positions.length||!!ledger?.pending||!!ledger?.running;$('signer-lock').disabled=!signerStatus?.vault?.unlocked;$('signer-storage').textContent=signerStatus?.storageMode==='ephemeral'?'Railway đang dùng ổ tạm; bot vẫn hoạt động. Xuất nhật ký để giữ bản sao vì thay container có thể mất dữ liệu.':'Nhật ký và két được ghi trên ổ dữ liệu. Sau restart cần mở khóa lại; không xóa dữ liệu khi còn vị thế.';}
 if(signerAvailable){
  const assets=wallet?.inventory??[];$('inventory-status').textContent=wallet?.inventoryError??`Đối chiếu token lúc ${wallet?.inventoryAt?new Date(wallet.inventoryAt).toLocaleTimeString('vi-VN'):'chưa đọc được'} · ${assets.length} token có số dư.`;
  $('recovery-warning').textContent=signerStatus?.recoveryMessage??'';$('wallet-inventory').replaceChildren();
  for(const a of assets){const row=document.createElement('p');row.className='fine';row.textContent=`${a.mint} · số lượng thô ${a.rawQuantity} · ${a.tracked?'Đã có trong sổ':'Chưa được ứng dụng quản lý'} `;if(!a.tracked){const button=document.createElement('button');button.type='button';button.textContent='Khôi phục vị thế cũ';button.onclick=()=>{$('recovery-mint').value=a.mint;recoveryProof=null;$('recovery-apply').hidden=true;$('recovery-signature').focus();};row.append(button);}$('wallet-inventory').append(row);}
  $('recovery-apply').disabled=!!ledger?.running||!!ledger?.pending;
 }
 if(signerAvailable){const t=signerStatus?.telegram,training=signerStatus?.training;$('telegram-status').textContent=t?.configured?`${t.enabled?'Đã bật':'Đã tắt'} · ${t.unlocked?'Sẵn sàng gửi':'Cần mở khóa bộ ký'} · ${t.pending??0} tin chờ · ${t.failed??0} tin lỗi. Báo cáo lệnh thắng + JSON lúc 23:00 giờ Việt Nam, kỳ 23h–23h. ${training?.pending??0} log chờ lưu. ${training?.error??t.error??''}`:'Chưa cài Telegram. Bấm Start trong bot Telegram, sau đó mở khóa bộ ký và lưu token/Chat ID tại đây. Token được mã hóa trên server, không lưu trên trình duyệt.';$('telegram-test').disabled=!t?.configured;$('telegram-disable').disabled=!t?.configured;}
 $('live-detail').textContent=signerAvailable?`${signerStatus?.vault?.unlocked?'Bộ ký đã mở khóa':'Bộ ký đang khóa'} · ${ledger?.running?'Tự giao dịch trên server; có thể đóng tab.':'Bot chưa chạy.'} ${signerStatus?.error??''}`:ledger?.pending?(ledger.pending.transaction?'Đang đối soát giao dịch đã ký. Không ký lệnh mới.':'Còn yêu cầu chưa gửi. Nếu phiên ký bị gián đoạn, bấm Hủy yêu cầu chưa gửi.'):`RPC: ${wallet?.rpcProvider??'chưa kết nối'} · Swap: PumpSwap / pump.fun trực tiếp (không cần key riêng). Mỗi lệnh cần bạn xác nhận trong ứng dụng ví.`;
 $('live-enable').disabled=!!ledger?.running||!wallet?.swapReady||!!ledger?.pending||(signerAvailable&&!signerStatus?.vault?.unlocked);
 $('live-pause').disabled=!ledger?.running;
 $('cancel-order').disabled=!ledger?.pending||!!ledger?.pending?.transaction||signing;
 $('sign-order').disabled=signing||!proposal||!!ledger?.pending||!ledger?.running;
 $('sign-order').textContent=proposal?`Ký ${proposal.side==='PROFIT'?'chuyển lãi':proposal.side==='BUY'?'mua':'bán'} ${proposal.symbol}`:'Chưa có lệnh cần ký';
 $('order-preview').textContent=ledger?.pending?'Signature: '+(ledger.pending.signature??'đang chờ ký'):proposal?`${proposal.side==='PROFIT'?'CHUYỂN LÃI '+(Number(proposal.amount)/1e9).toFixed(6)+' SOL':proposal.side==='BUY'?'MUA '+proposal.orderSol.toLocaleString('vi-VN',{maximumFractionDigits:9})+' SOL ('+(proposal.venue==='pumpfun'?'5%':'20%')+' ví)':'BÁN token đang quản lý'} · ${proposal.symbol} · ${proposal.reason}`:ledger?.running?(signerAvailable?'Bot đang tự chọn và ký lệnh trên server.':'Đang chờ tín hiệu đạt bộ lọc.'):'Bật theo dõi để bot chọn tín hiệu mua và thoát lệnh.';
 if(ledger?.pending)window.dispatchEvent(new CustomEvent('meme-activity',{detail:{id:'pending:'+(ledger.pending.signature??ledger.pending.intent?.id),priority:true,anchor:'#order-preview',text:'Đang đối soát '+(ledger.pending.intent?.side==='BUY'?'lệnh mua':ledger.pending.intent?.side==='SELL'?'lệnh bán':'chuyển SOL')}}));
 $('live-position-list').replaceChildren();
 for(const p of ledger?.positions??[]){const row=document.createElement('div');row.dataset.spiderMint=p.mint;row.dataset.spiderRole='position';row.textContent=`${p.symbol}: ${p.quantity} token · ${p.phase}${p.recoverySignature?' · Đã khôi phục · vốn '+p.initialCostSol.toFixed(9)+' SOL':''} `;const button=document.createElement('button');button.textContent=signerAvailable?'Bán toàn bộ vị thế':'Ký bán toàn bộ vị thế';button.disabled=signing||!!ledger.pending;button.onclick=()=>action(()=>signerAvailable?api('/api/signer/close',{mint:p.mint}):lockedSign(ownerExit(ledger,p.mint,1,'owner-exit',feed?.solUsd)));row.appendChild(button);$('live-position-list').appendChild(row);}
 $('profit-recipient').textContent=PROFIT_RECIPIENT;
 $('profit-history').textContent=`Đã chuyển: ${(ledger?.withdrawnSol??0).toFixed(6)} SOL`+(ledger?.payouts?.map(p=>`\n${new Date(p.at).toLocaleString('vi-VN')} ${p.amountSol.toFixed(6)} SOL · ${p.signature}`).join('')??'');
 const audit=ledger?auditDesk(ledger):null;$('audit-report').textContent=audit?`7 ngày · ${audit.closedTrades}/40 lệnh đóng · Win rate ${audit.winRate===null?'chưa có':(audit.winRate*100).toFixed(1)+'%'} · Kỳ vọng ${audit.expectancyR===null?'chưa đủ dữ liệu':audit.expectancyR.toFixed(2)+'R'} · ${audit.status==='insufficient-data'?'Chưa đủ mẫu để kết luận':audit.status==='passed'?'Đạt ngưỡng tham chiếu':'Cần xem lại kết quả'}`:'Chưa có nhật ký để đánh giá.';
 const latency=ledger?.lastExecutionLatency;$('execution-latency').textContent=latency?`Lệnh gần nhất: chuẩn bị ${latency.prepareMs.toFixed(1)} ms · ký ${latency.signMs.toFixed(1)} ms · phản hồi gửi RPC ${latency.broadcastRpcMs.toFixed(1)} ms · xác nhận ${latency.confirmationMs===null?'đang chờ':latency.confirmationMs+' ms'}. Đây là số đo lệnh này, không phải cam kết độ trễ.`:'Chưa có số đo độ trễ giao dịch. Quét mục tiêu 5 giây; chưa có feed mili giây.';
 if(!ledger?.positions.length)$('live-position-list').textContent='Chưa có vị thế được ứng dụng ghi nhận. Token khác trong ví không tự động bị bán.';
 $('live-fills').textContent=ledger?.trades.map(t=>`${new Date(t.at).toLocaleTimeString('vi-VN')} ${t.side} ${t.symbol} ${t.sol.toFixed(6)} SOL ${t.signature}`).join('\n')||'Lệnh đã xác nhận sẽ hiện tại đây.';
 publish();
}
async function reconcile(){
 if(!ledger?.pending?.transaction||signing)return;
 const pending=ledger.pending,result=await api('/api/direct/reconcile',{intent:pending.intent,transaction:pending.transaction});
 if(result.status==='pending')return;
 const confirmed=applyOwnerReceipt(ledger,pending,result);if(result.status!=='confirmed')ledger.running=false;save();
 if(confirmed&&pending.intent.side!=='PROFIT')window.dispatchEvent(new CustomEvent('meme-trade',{detail:{id:result.signature,side:pending.intent.side,mint:pending.intent.mint,symbol:pending.intent.symbol,mode:'live'}}));
 if(result.status!=='confirmed')message(result.status==='failed'?'Lệnh thất bại trên Solana; đã ghi nhận phí mạng.':'Lệnh hết hạn; không gửi lại tự động.');
 await watch();
}
async function refresh(){
 if(refreshing)return;refreshing=true;
 try{
  const auth=await api('/api/auth/status');$('wallet-connect').textContent=auth.authenticated?'Kết nối lại ví chủ':'Kết nối ví chủ';$('owner-controls').hidden=!auth.authenticated;
  signerAvailable=auth.signerAvailable===true;setupSignerUI();
  if(!auth.authenticated){message('Kết nối ví chủ để đọc lại vị thế và lịch sử riêng. Phiên đăng nhập hết hạn không xóa sổ giao dịch.');if(ledger)ledger.running=false;window.dispatchEvent(new CustomEvent('meme-owner-state',{detail:null}));return;}
  if(owner!==auth.owner){owner=auth.owner;ledger=null;if(!signerAvailable)load();}
  if(signerAvailable){signerStatus=await api('/api/signer/status');ledger=signerStatus.ledger;wallet=signerStatus.wallet;feed=(await api('/api/state')).feed;proposal=null;render();return;}
  await watch();await reconcile();wallet=await api('/api/direct/status?minContextSlot='+(ledger?.lastReceiptSlot??0));feed=(await api('/api/state')).feed;
  if(ledger&&!ledger.pending){
   allocateOwnerCapital(ledger,wallet.balanceSol);
   for(const p of ledger.positions)if(BigInt(wallet.tokenBalances[p.mint]??'0')<BigInt(p.rawQuantity)){ledger.running=false;throw Error('Số token trong ví thấp hơn sổ ứng dụng. Đã dừng theo dõi; kiểm tra giao dịch ngoài ứng dụng trước khi tiếp tục.');}
   proposal=ledger.running?nextOwnerOrder(ledger,feed,wallet.balanceSol):null;
   if((ledger.running||ledger.trades.length>0)&&feed.updatedAt&&feed.solUsd&&!feed.error&&Date.now()-feed.updatedAt<90000&&ledger.lastMarkAt!==feed.updatedAt){ledger.curve.push({at:Date.now(),equitySol:equity(ledger,feed.markets,feed.solUsd)});ledger.curve=ledger.curve.slice(-1440);ledger.lastMarkAt=feed.updatedAt;}
   save();
  }else proposal=null;
  render();
  if(ledger?.running&&proposal&&!ledger.pending&&provider&&$('auto-request-sign').checked&&document.visibilityState==='visible')await lockedSign(proposal);
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
  if(order.side==='PROFIT'){const current=profitOrder(ledger,wallet.balanceSol);if(!current||current.amount!==order.amount)throw Error('Số lãi có thể chuyển đã thay đổi.');order=current;}
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
$('rpc-retry').onclick=()=>action(async()=>{});
$('live-enable').onclick=()=>action(async()=>{if(signerAvailable){await api('/api/signer/enable',{confirm:'ENABLE OWNER SIGNER'});return;}if(!provider)await connect();if(!wallet)throw Error('Chờ đọc số dư ví chủ.');if(!ledger){ledger=createOwnerLedger(owner,wallet.balanceSol);save();}ledger.running=true;save();});
$('live-pause').onclick=()=>action(async()=>{if(signerAvailable){await api('/api/signer/pause',{});return;}if(ledger){ledger.running=false;proposal=null;save();render();}});
$('cancel-order').onclick=()=>action(async()=>{if(signing)throw Error('Ví đang ký. Hủy trong ứng dụng ví trước.');const current=JSON.parse(localStorage.getItem(storageKey())??'null');if(!current?.pending||current.pending.transaction)throw Error('Chỉ hủy được yêu cầu chưa gửi.');await api('/api/direct/cancel',{id:current.pending.intent.id});ledger=validateLedger(current);ledger.pending=null;save();});
$('sign-order').onclick=()=>action(()=>lockedSign(proposal));
$('ledger-export').onclick=()=>action(async()=>{if(!ledger)return message('Chưa có nhật ký để xuất.');const exported=signerAvailable?await api('/api/signer/export',{}):ledger;const blob=new Blob([JSON.stringify({...exported,audit:auditDesk(exported)},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='meme-pilot-owner-ledger.json';a.click();URL.revokeObjectURL(url);});
$('ledger-import').onchange=e=>action(async()=>{if(signing||ledger?.pending)throw Error('Đợi đối soát xong trước khi khôi phục.');const file=e.target.files[0];if(!file)return;if(file.size>2*1024*1024)throw Error('Tệp nhật ký quá lớn.');const imported=JSON.parse(await file.text());if(signerAvailable){await api('/api/signer/restore',{ledger:imported});return;}ledger=validateLedger(imported);save();});
window.addEventListener('storage',e=>{if(!signerAvailable&&e.key===storageKey()&&!signing){if(ledger)ledger.running=false;ledger=null;proposal=null;try{load();}catch(err){message(err.message);}refresh();}});
refresh();setInterval(refresh,10000);
