import {randomBytes,hkdfSync,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {writeDurable} from './persistence.js';

function credentials(token,chatId){
 if(typeof token!=='string'||!/^\d{6,14}:[A-Za-z0-9_-]{30,100}$/.test(token)||typeof chatId!=='string'||! /^-?[1-9]\d{0,19}$/.test(chatId))throw Error('Token Telegram hoặc Chat ID không hợp lệ.');
 return {token,chatId};
}
const keyFor=(keypair,salt)=>Buffer.from(hkdfSync('sha256',keypair.secretKey,salt,Buffer.from('meme-pilot/telegram-config/v1'),32));
const number=n=>Number.isFinite(n)?n.toFixed(6):'chưa xác định';
const signed=n=>(n>=0?'+':'')+number(n);
const label=s=>String(s??'?').replace(/[\u0000-\u001f]/g,' ').slice(0,60);

/** Enqueue in the same durable ledger update as a newly confirmed receipt. No HTTP here. */
export function enqueueTradeReport(s,pending,result){
 const intent=pending.intent;
 if(result.status!=='confirmed'||!['BUY','SELL'].includes(intent.side))return false;
 const trade=s.trades.find(t=>t.signature===result.signature);if(!trade)return false;
 s.telegramOutbox??=[];
 if(s.telegramOutbox.some(m=>m.id===result.signature))return false;
 const position=s.positions.find(p=>p.mint===intent.mint),positionPnl=trade.closed?trade.positionPnlSol:position?.realizedPnlSol;
 const text=[`Meme Pilot · ${intent.side==='BUY'?'MUA':'BÁN'} ĐÃ XÁC NHẬN`,`${label(trade.symbol)} · ${intent.mint}`,`SOL ${intent.side==='BUY'?'đã chi':'thực nhận'}: ${number(trade.sol)}`,`Phí mạng: ${number(trade.networkFeeSol)} SOL`,intent.side==='SELL'?`PnL lần bán sau phí: ${signed(trade.pnlSol)} SOL`:'PnL vị thế: chưa chốt',...(intent.side==='SELL'?[`PnL đã chốt của vị thế: ${signed(positionPnl)} SOL`]:[]),`Tổng PnL đã chốt sau phí: ${signed((s.realizedNetSol??0)-(s.payoutFeesSol??0))} SOL`,`Ngân sách SOL còn: ${number(s.cashSol)} · Vị thế mở: ${s.positions.length}/${s.settings.maxPositions}`,`Lý do: ${label(intent.reason)}`,new Date(trade.at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}),`https://solscan.io/tx/${result.signature}`].join('\n');
 s.telegramOutbox.push({id:result.signature,text,createdAt:Date.now(),attempts:0,nextAttemptAt:0,status:'queued'});
 return true;
}

export class TelegramReporter{
 constructor(dir,owner,fetcher=globalThis.fetch){this.file=path.join(dir,'telegram-config.json');this.owner=owner;this.fetcher=fetcher;this.enabled=false;this.configured=false;this.creds=null;this.doc=null;this.busy=false;this.error=null;}
 async load(){
  try{const doc=JSON.parse(await readFile(this.file,'utf8'));if(doc.version!==1||doc.owner!==this.owner)throw Error('invalid');this.doc=doc;this.configured=!doc.disabled;this.enabled=this.configured;}
  catch(e){if(e.code!=='ENOENT')this.error='Cấu hình Telegram không đọc được; chưa bật thông báo.';}
 }
 async configure(token,chatId,keypair){
  if(!keypair||keypair.publicKey.toBase58()!==this.owner)throw Error('Mở khóa bộ ký ví chủ trước khi lưu Telegram.');
  const value=credentials(typeof token==='string'?token.trim():token,typeof chatId==='string'?chatId.trim():chatId),salt=randomBytes(16),iv=randomBytes(12),key=keyFor(keypair,salt);
  try{const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(this.owner));const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
   const doc={version:1,owner:this.owner,salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
   await writeDurable(this.file,doc);this.doc=doc;this.creds=value;this.enabled=true;this.configured=true;this.error=null;
  }finally{key.fill(0);}
 }
 async unlock(keypair){
  if(this.creds||!this.enabled||!this.doc||!keypair)return;
  let key,plain;try{key=keyFor(keypair,Buffer.from(this.doc.salt,'base64'));const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(this.doc.iv,'base64'));decipher.setAAD(Buffer.from(this.owner));decipher.setAuthTag(Buffer.from(this.doc.tag,'base64'));plain=Buffer.concat([decipher.update(Buffer.from(this.doc.ciphertext,'base64')),decipher.final()]);const value=JSON.parse(plain.toString());this.creds=credentials(value.token,value.chatId);this.error=null;}
  catch{this.error='Chưa giải mã được cấu hình Telegram bằng khóa ví chủ.';}finally{key?.fill(0);plain?.fill(0);}
 }
 async disable(){await writeDurable(this.file,{version:1,owner:this.owner,disabled:true});this.doc=null;this.creds=null;this.enabled=false;this.configured=false;this.error=null;}
 status(state){return {configured:this.configured,enabled:this.enabled,unlocked:!!this.creds,pending:(state?.telegramOutbox??[]).filter(m=>m.status==='queued').length,failed:(state?.telegramOutbox??[]).filter(m=>m.status==='failed').length,error:this.error};}
 async send(text){
  if(!this.creds)throw Error('Mở khóa bộ ký và lưu cấu hình Telegram trước khi gửi thử.');
  let response;try{response=await this.fetcher('https://api.telegram.org/bot'+this.creds.token+'/sendMessage',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:this.creds.chatId,text,link_preview_options:{is_disabled:true}}),signal:AbortSignal.timeout(5000)});}catch{throw Error('Không kết nối được Telegram; kết quả gửi có thể chưa rõ.');}
  let value;try{value=await response.json();}catch{throw Error('Telegram trả dữ liệu không hợp lệ.');}
  if(!response.ok||value.ok!==true)throw Object.assign(Error('Telegram HTTP '+response.status+'; kiểm tra token, Chat ID và đã Start bot.'),{retryAfter:Number.isSafeInteger(value.parameters?.retry_after)?Math.min(3600,Math.max(1,value.parameters.retry_after)):null});
  if(!Number.isSafeInteger(value.result?.message_id))throw Error('Telegram chưa xác nhận mã thông báo.');
  return value.result.message_id;
 }
 async test(keypair){await this.unlock(keypair);await this.send('Meme Pilot · Kết nối Telegram thành công. Đây là tin thử, không phải giao dịch.');this.error=null;}
 async tick(agent){
  if(this.busy||!this.enabled)return;this.busy=true;
  try{
   await this.unlock(agent.vault.keypair);if(!this.creds)return;
   let message;
   await agent.serial(async()=>{const s=agent.state;if(!s)return;const next=(s.telegramOutbox??[]).find(m=>m.status==='queued'&&m.nextAttemptAt<=Date.now());if(!next)return;next.attempts++;next.nextAttemptAt=Date.now()+60000;await agent.save();message={id:next.id,text:next.text};});
   if(!message)return;
   let messageId,error;try{messageId=await this.send(message.text);}catch(e){error=e;}
   await agent.serial(async()=>{
    const s=agent.state,entry=s?.telegramOutbox?.find(m=>m.id===message.id);if(!entry)return;
    if(!error){entry.status='sent';entry.messageId=messageId;entry.sentAt=Date.now();this.error=null;}
    else{this.error=error.message;entry.status=entry.attempts>=6?'failed':'queued';entry.nextAttemptAt=Date.now()+(error.retryAfter??Math.min(600,2**entry.attempts*5))*1000;}
    const sent=s.telegramOutbox.filter(m=>m.status==='sent');if(sent.length>100){const keep=new Set(sent.slice(-100).map(m=>m.id));s.telegramOutbox=s.telegramOutbox.filter(m=>m.status!=='sent'||keep.has(m.id));}
    await agent.save();
   });
  }catch{this.error='Không lưu/gửi được thông báo Telegram; giao dịch vẫn được xử lý riêng.';}finally{this.busy=false;}
 }
}
