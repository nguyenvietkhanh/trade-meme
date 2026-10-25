import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
const fail=code=>Object.assign(Error(code),{code});
// Decode common Solana wallet exports. A derived owner match is mandatory for
// every encoding; a public wallet address is never accepted as signing authority.
export function decodeSignerSecret(value,owner){
 if(typeof value!=='string'||value.length>4096)throw fail('LIVE_SIGNER_INVALID');let text=value.trim(),format='unknown',bytes;
 try{
  if(text.startsWith("'")&&text.endsWith("'"))text=text.slice(1,-1).trim();
  if(text.startsWith('"')){const inner=JSON.parse(text);if(typeof inner!=='string')throw Error();text=inner.trim();}
  if(text.startsWith('{')){const doc=JSON.parse(text),inner=doc.secretKey??doc.privateKey;if(Array.isArray(inner))text=JSON.stringify(inner);else if(typeof inner==='string')text=inner.trim();else throw Error();}
  if(text.startsWith('[')){const a=JSON.parse(text);if(!Array.isArray(a)||![32,64].includes(a.length)||a.some(n=>!Number.isInteger(n)||n<0||n>255))throw Error();bytes=Uint8Array.from(a);format='json-array';}
  else{const encoded=text.replace(/\s/g,'');
   if(/^(?:0x)?(?:[a-fA-F0-9]{64}|[a-fA-F0-9]{128})$/.test(encoded)){bytes=Uint8Array.from(Buffer.from(encoded.replace(/^0x/,''),'hex'));format='hex';}
   else{try{const raw=bs58.decode(encoded);if([32,64].includes(raw.length)){bytes=raw;format='base58';}else raw.fill(0);}catch{}if(!bytes){const raw=Buffer.from(encoded,'base64');if(![32,64].includes(raw.length)||raw.toString('base64').replace(/=+$/,'')!==encoded.replace(/=+$/,''))throw Error();bytes=Uint8Array.from(raw);raw.fill(0);format='base64';}}
  }
  if(bytes.length===32&&bs58.encode(bytes)===owner)throw fail('LIVE_SIGNER_PUBLIC_ADDRESS');
  const keypair=bytes.length===32?Keypair.fromSeed(Uint8Array.from(bytes)):Keypair.fromSecretKey(Uint8Array.from(bytes));
  if(keypair.publicKey.toBase58()!==owner)throw fail('LIVE_SIGNER_OWNER_MISMATCH');return {keypair,format};
 }catch(error){throw fail(['LIVE_SIGNER_PUBLIC_ADDRESS','LIVE_SIGNER_OWNER_MISMATCH'].includes(error.code)?error.code:'LIVE_SIGNER_INVALID');}finally{bytes?.fill(0);}
}
// Only the parent process owns the signing capability. No raw values are logged,
// saved in the ledger, returned by status, or inherited by AI worker processes.
export class AutomaticSigner{
 #read;#keypair=null;#enabled=false;#error=null;#loaded=false;#checkedAt=null;#format=null;#present=false;
 constructor(owner,env=process.env){this.owner=owner;this.#read=()=>env.LIVE_SIGNER_SECRET_KEY;}
 async load({retry=false}={}){if(this.#enabled||this.#loaded&&!retry)return;this.#loaded=true;this.#checkedAt=Date.now();const value=this.#read();this.#present=typeof value==='string'&&!!value.trim();if(!this.#present){this.#error='LIVE_SIGNER_NOT_CONFIGURED';return;}try{const result=decodeSignerSecret(value,this.owner);this.#keypair=result.keypair;this.#format=result.format;this.#error=null;}catch(error){this.#keypair=null;this.#format=null;this.#error=error.code;}}
 async reloadIfUnavailable(){if(!this.#keypair)await this.load({retry:true});}
 enable(){if(!this.#keypair)throw fail(this.#error??'LIVE_SIGNER_NOT_CONFIGURED');this.#enabled=true;}
 lock(){this.#enabled=false;}
 get keypair(){return this.#enabled?this.#keypair:null;}
 status(){const current=this.#read();return {owner:this.owner,mode:'server-owner-signer',configured:!!this.#keypair,exists:!!this.#keypair,unlocked:this.#enabled,automatic:true,error:this.#error,runtimeVariablePresent:typeof current==='string'&&!!current.trim(),lastLoadHadValue:this.#present,checkedAt:this.#checkedAt,format:this.#format};}
}
