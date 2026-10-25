import path from 'node:path';
import {mkdir,readFile} from 'node:fs/promises';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {PaperTelegram} from './paper-telegram.js';
import {TelegramReporter} from './telegram.js';
import {writeDurable} from './persistence.js';
// Server-managed encryption, unrelated to wallet signing. No dashboard password.
export class WalletTelegram extends PaperTelegram{
 constructor(dir,legacyDir,fetcher=globalThis.fetch,{chatId=null}={}){super(dir,legacyDir,fetcher);this.preferredChatId=chatId;this.keyFile=path.join(dir,'report-storage-key.json');this.chain=Promise.resolve();}
 use(token,chatId){super.use(token,this.preferredChatId??chatId);}
 async restoreLegacy(keypair){if(this.creds||!keypair||this.doc?.disabled)return;const old=new TelegramReporter(this.legacyDir,this.owner,this.fetcher);try{await old.load();await old.unlock(keypair);if(old.creds)await this.configure(old.creds.token,this.preferredChatId??old.creds.chatId);}finally{old.creds=null;}}
 async storageKey(create=false){try{const doc=JSON.parse(await readFile(this.keyFile,'utf8')),key=Buffer.from(doc.key??'','base64');if(doc.version!==1||key.length!==32)throw Error('invalid');return key;}catch(e){if(e.code!=='ENOENT'||!create)throw Error('TELEGRAM_STORAGE_KEY_UNAVAILABLE');const key=randomBytes(32);await writeDurable(this.keyFile,{version:1,key:key.toString('base64')},{exclusive:true});return key;}}
 async load(){
  const env=process.env;if(env.TELEGRAM_BOT_TOKEN&&(env.TELEGRAM_CHAT_ID||this.preferredChatId)){this.use(env.TELEGRAM_BOT_TOKEN,env.TELEGRAM_CHAT_ID??this.preferredChatId);return;}
  let doc;try{doc=JSON.parse(await readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')this.error='Chưa đọc được cấu hình Telegram.';return;}
  if(doc.disabled){this.doc=doc;return;}
  if(doc.version!==3){if(env.PAPER_REPORT_PASSPHRASE){await super.load();if(this.creds)await this.configure(this.creds.token,this.creds.chatId);return;}this.error='Cấu hình Telegram cũ đang mã hóa bằng mật khẩu. Lưu lại Bot token + Chat ID hoặc cấu hình Telegram qua Railway Variables; bản này không còn nhập mật khẩu.';return;}
  let key,plain;try{key=await this.storageKey();const d=createDecipheriv('aes-256-gcm',key,Buffer.from(doc.iv,'base64'));d.setAAD(Buffer.from('meme-pilot/wallet-reports/v3'));d.setAuthTag(Buffer.from(doc.tag,'base64'));plain=Buffer.concat([d.update(Buffer.from(doc.ciphertext,'base64')),d.final()]);const creds=JSON.parse(plain.toString());this.use(creds.token,creds.chatId);this.doc=doc;}catch{this.error='Không mở được cấu hình Telegram trên Volume. Lưu lại Bot token + Chat ID; không cần mật khẩu.';}finally{key?.fill(0);plain?.fill(0);}
 }
 configure(token,chatId){const task=this.chain.then(async()=>{await mkdir(path.dirname(this.file),{recursive:true,mode:0o700});const old={creds:this.creds,enabled:this.enabled,configured:this.configured,error:this.error,doc:this.doc};this.use(typeof token==='string'?token.trim():token,typeof chatId==='string'?chatId.trim():chatId);let key;try{key=await this.storageKey(true);const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('meme-pilot/wallet-reports/v3'));const ciphertext=Buffer.concat([cipher.update(JSON.stringify(this.creds)),cipher.final()]),doc={version:3,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};await writeDurable(this.file,doc);this.doc=doc;}catch(e){Object.assign(this,old);throw e;}finally{key?.fill(0);}});this.chain=task.catch(()=>{});return task;}
}
