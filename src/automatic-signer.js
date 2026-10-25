import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
// Only the parent process owns this capability. Status contains no key material.
export class AutomaticSigner{
 #env;#keypair=null;#enabled=false;#error=null;
 constructor(owner,env=process.env){this.owner=owner;this.#env=env;}
 async load(){if(this.#env===null)return;let bytes;try{const value=this.#env.LIVE_SIGNER_SECRET_KEY;if(typeof value!=='string'||!value.trim()){this.#error='LIVE_SIGNER_NOT_CONFIGURED';return;}if(value.length>1000)throw Error('invalid');if(value.trim().startsWith('[')){const a=JSON.parse(value);if(!Array.isArray(a)||a.length!==64||a.some(n=>!Number.isInteger(n)||n<0||n>255))throw Error('invalid');bytes=Uint8Array.from(a);}else bytes=bs58.decode(value.trim());if(bytes.length!==64)throw Error('invalid');const keypair=Keypair.fromSecretKey(Uint8Array.from(bytes));if(keypair.publicKey.toBase58()!==this.owner){this.#error='LIVE_SIGNER_OWNER_MISMATCH';return;}this.#keypair=keypair;this.#error=null;}catch{this.#error='LIVE_SIGNER_INVALID';}finally{bytes?.fill(0);this.#env=null;}}
 enable(){if(!this.#keypair)throw Object.assign(Error(this.#error??'LIVE_SIGNER_NOT_CONFIGURED'),{code:this.#error??'LIVE_SIGNER_NOT_CONFIGURED'});this.#enabled=true;}
 lock(){this.#enabled=false;}
 get keypair(){return this.#enabled?this.#keypair:null;}
 status(){return {owner:this.owner,mode:'server-owner-signer',configured:!!this.#keypair,exists:!!this.#keypair,unlocked:this.#enabled,automatic:true,error:this.#error};}
}
