import {randomBytes,scrypt as derive,createCipheriv,createDecipheriv} from 'node:crypto';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
import {writeDurable} from './persistence.js';
import {DEFAULT_OWNER} from './security.js';

const scrypt=promisify(derive);
async function passwordKey(password,salt){
 if(typeof password!=='string'||password.length<12||password.length>256)throw Error('Mật khẩu mã hóa cần 12–256 ký tự.');
 return scrypt(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
}
export class OwnerSignerVault{
 constructor(file,owner=DEFAULT_OWNER){this.owner=owner;this.file=file;this.keypair=null;this.exists=false;}
 async load(){try{const doc=JSON.parse(await readFile(this.file,'utf8'));if(doc.version!==1||doc.owner!==this.owner)throw Error('invalid');this.exists=true;}catch(e){if(e.code!=='ENOENT')throw Error('Két ký tự động không hợp lệ; không tự tạo đè.');}}
 async importKey(secret,password){
  if(this.exists)throw Error('Đã có két ký tự động. Dùng mở khóa; không ghi đè khóa đang có.');
  let bytes,key,kp;
  try{
   if(typeof secret!=='string'||secret.length>1000)throw Error('invalid');
   if(secret.trim().startsWith('[')){const values=JSON.parse(secret);if(!Array.isArray(values)||values.length!==64||values.some(n=>!Number.isInteger(n)||n<0||n>255))throw Error('invalid');bytes=Buffer.from(values);}
   else bytes=Buffer.from(bs58.decode(secret.trim()));
   if(bytes.length!==64)throw Error('invalid');kp=Keypair.fromSecretKey(Uint8Array.from(bytes));
   if(kp.publicKey.toBase58()!==this.owner)throw Error('wrong owner');
  }catch{bytes?.fill(0);throw Error('Khóa không hợp lệ hoặc không thuộc ví chủ đã cố định. Không nhập seed phrase.');}
  try{
   const salt=randomBytes(16),iv=randomBytes(12);key=await passwordKey(password,salt);
   const cipher=createCipheriv('aes-256-gcm',key,iv),ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);
   await writeDurable(this.file,{version:1,owner:this.owner,salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')},{exclusive:true});
   this.exists=true;this.keypair=kp;
  }finally{bytes.fill(0);key?.fill(0);}
 }
 async unlock(password){
  if(this.keypair)return;
  let bytes,key;
  try{
   const doc=JSON.parse(await readFile(this.file,'utf8'));if(doc.owner!==this.owner||doc.version!==1)throw Error('invalid');
   key=await passwordKey(password,Buffer.from(doc.salt,'base64'));
   const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(doc.iv,'base64'));decipher.setAuthTag(Buffer.from(doc.tag,'base64'));
   bytes=Buffer.concat([decipher.update(Buffer.from(doc.ciphertext,'base64')),decipher.final()]);
   const kp=Keypair.fromSecretKey(Uint8Array.from(bytes));if(kp.publicKey.toBase58()!==this.owner)throw Error('invalid');this.keypair=kp;
  }catch{throw Error('Không mở được két: kiểm tra mật khẩu và dữ liệu bộ ký.');}
  finally{bytes?.fill(0);key?.fill(0);}
 }
 lock(){this.keypair=null;}
 status(){return {exists:this.exists,unlocked:!!this.keypair,owner:this.owner};}
}
