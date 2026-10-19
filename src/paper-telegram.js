import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {randomBytes,scryptSync,createCipheriv,createDecipheriv} from 'node:crypto';
import {TelegramReporter} from './telegram.js';
import {writeDurable} from './persistence.js';
import {OwnerSignerVault} from './owner-vault.js';
import {DEFAULT_OWNER} from './security.js';
function key(password,salt){if(typeof password!=='string'||password.length<12||password.length>256)throw Error('Mật khẩu Telegram cần 12–256 ký tự.');return scryptSync(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});}
export class PaperTelegram extends TelegramReporter{
 constructor(dir,legacyDir,fetcher=globalThis.fetch){super(dir,DEFAULT_OWNER,fetcher);this.file=path.join(dir,'paper-telegram.json');this.legacyDir=legacyDir;}
 use(token,chatId){if(typeof token!=='string'||!/^\d{6,14}:[A-Za-z0-9_-]{30,100}$/.test(token)||typeof chatId!=='string'||! /^-?[1-9]\d{0,19}$/.test(chatId))throw Error('Telegram token hoặc Chat ID không hợp lệ.');this.creds={token,chatId};this.enabled=true;this.configured=true;this.error=null;}
 async load(){try{this.doc=JSON.parse(await readFile(this.file,'utf8'));if(this.doc.version!==2)throw Error('invalid');this.enabled=!this.doc.disabled;this.configured=this.enabled;}catch(e){if(e.code!=='ENOENT')this.error='Cấu hình Telegram paper không đọc được.';}if(process.env.TELEGRAM_BOT_TOKEN&&process.env.TELEGRAM_CHAT_ID)this.use(process.env.TELEGRAM_BOT_TOKEN,process.env.TELEGRAM_CHAT_ID);else if(this.configured&&process.env.PAPER_REPORT_PASSPHRASE)try{await this.open(process.env.PAPER_REPORT_PASSPHRASE);}catch{this.error='Chưa mở được cấu hình Telegram paper bằng biến môi trường.';}}
 async configurePaper(token,chatId,password){this.use(token.trim(),chatId.trim());const salt=randomBytes(16),iv=randomBytes(12),k=key(password,salt);try{const cipher=createCipheriv('aes-256-gcm',k,iv);cipher.setAAD(Buffer.from('paper-telegram-v2'));const ciphertext=Buffer.concat([cipher.update(JSON.stringify(this.creds)),cipher.final()]);const doc={version:2,salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};await writeDurable(this.file,doc);this.doc=doc;}finally{k.fill(0);}}
 async open(password){let k,plain;try{if(!this.doc||this.doc.disabled)throw Error('missing');k=key(password,Buffer.from(this.doc.salt,'base64'));const decipher=createDecipheriv('aes-256-gcm',k,Buffer.from(this.doc.iv,'base64'));decipher.setAAD(Buffer.from('paper-telegram-v2'));decipher.setAuthTag(Buffer.from(this.doc.tag,'base64'));plain=Buffer.concat([decipher.update(Buffer.from(this.doc.ciphertext,'base64')),decipher.final()]);const c=JSON.parse(plain);this.use(c.token,c.chatId);}catch{throw Error('Không mở được Telegram paper; kiểm tra mật khẩu.');}finally{k?.fill(0);plain?.fill(0);}}
 // Read legacy credentials only on an authenticated owner request; immediately lock the old vault.
 async migrate(password){const vault=new OwnerSignerVault(path.join(this.legacyDir,'owner-signer.json'));try{await vault.load();await vault.unlock(password);const old=new TelegramReporter(this.legacyDir,DEFAULT_OWNER,this.fetcher);await old.load();await old.unlock(vault.keypair);if(!old.creds)throw Error('Chưa đọc được Telegram cũ.');await this.configurePaper(old.creds.token,old.creds.chatId,password);old.creds=null;}finally{vault.lock();}}
 async unlock(){} // Never retain/unlock a trading key as part of notification processing.
 async disable(){await writeDurable(this.file,{version:2,disabled:true});this.doc=null;this.creds=null;this.enabled=false;this.configured=false;}
}
