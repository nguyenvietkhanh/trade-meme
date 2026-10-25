import {LiveTreasury} from './live-treasury.js';
import {AutomaticSigner} from './automatic-signer.js';
const fail=code=>Object.assign(Error(code),{code});
export class AutomaticTreasury extends LiveTreasury{
 constructor(dir,execution,options={}){super(dir,execution,options);this.vault=new AutomaticSigner(this.owner,options.signerEnv);this.ownerConnected=false;}
 status(){return {...super.status(),signingMode:'server-owner-signer',walletConnected:this.ownerConnected,unattendedSigningAvailable:this.vault.status().configured,requiresWalletSignature:false};}
 async connect(){this.ownerConnected=true;await this.vault.reloadIfUnavailable();if(this.storageMode==='ephemeral')throw fail('LIVE_PERSISTENT_VOLUME_REQUIRED');if(this.lastError?.startsWith('LIVE_LEGACY'))throw fail(this.lastError);if(!this.vault.status().configured)throw fail(this.vault.status().error??'LIVE_SIGNER_NOT_CONFIGURED');try{await this.reconcile();await this.sync();this.vault.enable();this.running=true;this.lastError=null;}catch(e){this.vault.lock();this.running=false;throw e;}}
 pause(paused){if(typeof paused!=='boolean')throw fail('INVALID_PAUSE_REQUEST');if(!paused){if(!this.ownerConnected)throw fail('LIVE_WALLET_NOT_CONNECTED');if(!this.signingReady())throw fail(this.vault.status().error??'LIVE_SIGNER_NOT_CONFIGURED');if(this.storageMode==='ephemeral')throw fail('LIVE_PERSISTENT_VOLUME_REQUIRED');}this.running=!paused;}
 lock(){this.ownerConnected=false;super.lock();}
 async disconnect(){this.lock();return this.serial(async()=>{for(const o of Object.values(this.s.orders))if(!o.terminal&&!o.signature){o.terminal=true;o.status='cancelled';delete o.unsignedTransaction;}await this.save();});}
 async unsignedReconcile(o){await super.unsignedReconcile(o);delete o.unsignedTransaction;}
 view(id){return {...super.view(id),requiresWalletSignature:false};}
}
