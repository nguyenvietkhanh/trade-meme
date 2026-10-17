import {randomBytes,scrypt as derive,createCipheriv,createDecipheriv} from 'node:crypto';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {writeDurable} from './persistence.js';
import {Keypair} from '@solana/web3.js';
const scrypt=promisify(derive);
async function keyFor(password,salt){if(typeof password!=='string'||password.length<12||password.length>256)throw Error('Mật khẩu két ví cần 12–256 ký tự.');return scrypt(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});}
export class WalletVault{
 constructor(file){this.file=file;this.keypair=null;this.apiKey=null;this.heliusKey=null;this.publicKey=null;this.exists=false;}
 async load(){try{const doc=JSON.parse(await readFile(this.file,'utf8'));this.exists=true;this.publicKey=doc.publicKey;}catch(e){if(e.code!=='ENOENT')throw Error('Không đọc được két ví.');}}
 async create(password,apiKey='',heliusKey=''){
  if(this.exists)throw Error('Ví bot đã tồn tại. Không tạo đè ví đang giữ tài sản.');
  if(apiKey&&(!/^[\x21-\x7e]{8,256}$/.test(apiKey)))throw Error('API key không hợp lệ.');
  if(heliusKey&&!/^[\x21-\x7e]{8,256}$/.test(heliusKey))throw Error('Helius API key không hợp lệ.');
  const kp=Keypair.generate(),salt=randomBytes(16),iv=randomBytes(12),key=await keyFor(password,salt);
  const cipher=createCipheriv('aes-256-gcm',key,iv),plain=Buffer.from(JSON.stringify({secret:[...kp.secretKey],apiKey,heliusKey}));
  const ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]);plain.fill(0);key.fill(0);
  const doc={version:1,publicKey:kp.publicKey.toBase58(),salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
  await writeDurable(this.file,doc,{exclusive:true});
  this.exists=true;this.publicKey=doc.publicKey;this.keypair=kp;this.apiKey=apiKey;this.heliusKey=heliusKey;
 }
 async unlock(password,newApiKey,newHeliusKey){
  const doc=JSON.parse(await readFile(this.file,'utf8'));if(doc.version!==1)throw Error('Phiên bản két không được hỗ trợ.');
  const key=await keyFor(password,Buffer.from(doc.salt,'base64'));
  let plain;
  try{const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(doc.iv,'base64'));decipher.setAuthTag(Buffer.from(doc.tag,'base64'));plain=Buffer.concat([decipher.update(Buffer.from(doc.ciphertext,'base64')),decipher.final()]);const data=JSON.parse(plain.toString());const kp=Keypair.fromSecretKey(Uint8Array.from(data.secret));if(kp.publicKey.toBase58()!==doc.publicKey)throw Error('Invalid key');
   if(newApiKey||newHeliusKey){for(const value of [newApiKey,newHeliusKey])if(value&&!/^[\x21-\x7e]{8,256}$/.test(value))throw Error('Invalid API key');if(newApiKey)data.apiKey=newApiKey;if(newHeliusKey)data.heliusKey=newHeliusKey;const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),payload=Buffer.from(JSON.stringify(data)),encrypted=Buffer.concat([cipher.update(payload),cipher.final()]);payload.fill(0);const updated={...doc,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:encrypted.toString('base64')};await writeDurable(this.file,updated);}
   this.keypair=kp;this.publicKey=doc.publicKey;this.apiKey=data.apiKey??'';this.heliusKey=data.heliusKey??'';this.exists=true;}
  catch{throw Error('Mật khẩu không đúng hoặc két ví bị hỏng.');}
  finally{key.fill(0);plain?.fill(0);}
 }
 lock(){this.keypair=null;this.apiKey=null;this.heliusKey=null;}
 status(){return {exists:this.exists,publicKey:this.publicKey,unlocked:!!this.keypair,apiKeyConfigured:!!(this.apiKey||process.env.JUPITER_API_KEY)};}
 async backup(){return readFile(this.file,'utf8');}
}
