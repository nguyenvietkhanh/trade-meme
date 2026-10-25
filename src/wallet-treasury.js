import {VersionedTransaction} from '@solana/web3.js';
import {LiveTreasury,treasuryAvailable} from './live-treasury.js';
import {verifyOwnerTransaction} from './direct-wallet.js';
const fail=code=>Object.assign(Error(code),{code});
export class WalletTreasury extends LiveTreasury{
 constructor(dir,execution,options){super(dir,execution,options);this.connected=false;this.vault={keypair:null,load:async()=>{},lock:()=>{},status:()=>({mode:'browser-wallet',exists:false,unlocked:false,connected:this.connected,automatic:false,owner:this.owner})};}
 signingReady(){return this.connected;}
 status(){return {...super.status(),signingMode:'connected-owner-wallet',walletConnected:this.connected,unattendedSigningAvailable:false};}
 assertConnected(){if(!this.connected)throw fail('LIVE_WALLET_NOT_CONNECTED');if(this.storageMode==='ephemeral')throw fail('LIVE_PERSISTENT_VOLUME_REQUIRED');if(this.lastError?.startsWith('LIVE_LEGACY'))throw fail(this.lastError);}
 async connect(){if(this.storageMode==='ephemeral')throw fail('LIVE_PERSISTENT_VOLUME_REQUIRED');if(this.lastError?.startsWith('LIVE_LEGACY'))throw fail(this.lastError);await this.reconcile();await this.sync();this.connected=true;this.running=true;}
 pause(paused){if(typeof paused!=='boolean')throw fail('INVALID_PAUSE_REQUEST');if(!paused)this.assertConnected();this.running=!paused;}
 lock(){this.connected=false;this.running=false;}
 async disconnect(){this.lock();return this.serial(async()=>{for(const o of Object.values(this.s.orders))if(!o.terminal&&!o.signature){o.terminal=true;o.status='cancelled';delete o.unsignedTransaction;}await this.save();});}
 async authorizePrepared(order,prepared){
  this.assertConnected();if(order.side==='BUY'&&!this.running)throw fail('LIVE_BUY_NOT_ADMITTED');const tx=VersionedTransaction.deserialize(prepared.bytes);
  if(tx.message.header.numRequiredSignatures!==1||tx.message.staticAccountKeys[0].toBase58()!==this.owner||tx.signatures.some(s=>s.some(b=>b!==0)))throw fail('LIVE_SIGNER_MISMATCH');
  Object.assign(order,{status:'awaiting-wallet',unsignedTransaction:Buffer.from(prepared.bytes).toString('base64'),preparedAt:this.clock(),lastValidBlockHeight:prepared.lastValidBlockHeight,quote:prepared.quote});await this.save();return {status:order.status,terminal:false,view:this.view(order.agentId)};
 }
 expired(o){return this.clock()-o.decisionAt>30000&&o.side==='BUY'||this.clock()-(o.preparedAt??o.at)>90000;}
 async unsignedReconcile(o){if(o.status==='awaiting-wallet'&&!this.expired(o)&&await this.execution.height()<=o.lastValidBlockHeight)return;o.terminal=true;o.status=o.status==='awaiting-wallet'?'expired':'rejected';delete o.unsignedTransaction;}
 view(id){return {...super.view(id),requiresWalletSignature:true};}
 request(input,m,id){if(!Object.hasOwn(this.s.orders,input.id))this.assertConnected();return super.request(input,m,id);}
 orders(){return Object.values(this.s.orders).filter(o=>!o.terminal&&o.status==='awaiting-wallet'&&!this.expired(o)&&(!(!this.running&&o.side==='BUY'))).sort((a,b)=>Number(b.side==='SELL')-Number(a.side==='SELL')||a.at-b.at).map(o=>({id:o.id,agentId:o.agentId,side:o.side,mint:o.mint,pairAddress:o.pairAddress,symbol:o.symbol,amount:o.amount,transaction:o.unsignedTransaction,decisionAt:o.decisionAt,preparedAt:o.preparedAt,lastValidBlockHeight:o.lastValidBlockHeight,owner:this.owner,requiresWalletSignature:true}));}
 submit(id,encoded){return this.serial(async()=>{
  const o=typeof id==='string'&&Object.hasOwn(this.s.orders,id)?this.s.orders[id]:null;if(!o)throw fail('LIVE_WALLET_ORDER_NOT_FOUND');
  let signed;try{signed=verifyOwnerTransaction(encoded,this.owner);}catch{throw fail('LIVE_WALLET_SIGNATURE_INVALID');}
  if(o.signature){if(o.signature!==signed.signature)throw fail('LIVE_WALLET_TRANSACTION_CHANGED');return {status:o.status,terminal:o.terminal,signature:o.signature};}
  if(o.terminal||o.status!=='awaiting-wallet')throw fail('LIVE_WALLET_ORDER_EXPIRED');this.assertConnected();if(o.side==='BUY'&&!this.running)throw fail('LIVE_BUY_NOT_ADMITTED');
  if(this.expired(o)||await this.execution.height()>o.lastValidBlockHeight){o.terminal=true;o.status='expired';delete o.unsignedTransaction;await this.save();throw fail('LIVE_WALLET_ORDER_EXPIRED');}
  const expected=VersionedTransaction.deserialize(Buffer.from(o.unsignedTransaction,'base64'));if(!Buffer.from(signed.tx.message.serialize()).equals(Buffer.from(expected.message.serialize())))throw fail('LIVE_WALLET_TRANSACTION_CHANGED');
  if(o.side==='BUY'){const balance=Math.round(await this.execution.balance(this.owner,this.s.lastReceiptSlot||undefined)*1e9),others=Object.fromEntries(Object.entries(this.s.orders).filter(([key])=>key!==id));if(Number(o.amount)>treasuryAvailable(balance,others))throw fail('LIVE_CAPITAL_CHANGED');}
  this.assertConnected();if(o.side==='BUY'&&(!this.running||this.expired(o)))throw fail('LIVE_BUY_NOT_ADMITTED');
  // Persist the owner's exact signature before any attempt to broadcast. A retry
  // reads this same signature; no second transaction is ever generated here.
  o.signature=signed.signature;o.transaction=encoded;o.status='signed';delete o.unsignedTransaction;await this.save();return this.broadcast(o,signed.bytes);
 });}
 cancel(id){return this.serial(async()=>{const o=typeof id==='string'&&Object.hasOwn(this.s.orders,id)?this.s.orders[id]:null;if(!o)throw fail('LIVE_WALLET_ORDER_NOT_FOUND');if(o.signature)throw fail('LIVE_WALLET_ALREADY_SUBMITTED');if(!o.terminal){o.terminal=true;o.status='cancelled';delete o.unsignedTransaction;await this.save();}return {ok:true,status:o.status};});}
}
