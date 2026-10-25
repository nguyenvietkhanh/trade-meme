import {LiveTreasury} from './live-treasury.js';
import {AutomaticSigner} from './automatic-signer.js';
import {aiBuyLimit,validAIStop} from './autonomous-policy.js';
import {initAIProfit,reservedAIProfit,stepAIProfit,earnedAIProfit} from './automatic-profit.js';
import {treasuryAvailable} from './live-treasury.js';
import {PROFIT_RECIPIENT} from './desk-rules.js';
const fail=code=>Object.assign(Error(code),{code});
export class AutomaticTreasury extends LiveTreasury{
 constructor(dir,execution,options={}){super(dir,execution,options);this.vault=new AutomaticSigner(this.owner,options.signerEnv);this.ownerConnected=false;}
 async load(){await super.load();initAIProfit(this.s,this.clock());await this.save();}
 availableLamports(balance){return aiBuyLimit(balance,Math.max(0,treasuryAvailable(balance,this.s.orders)-reservedAIProfit(this.s)));}
 hasPendingTransfer(){return !!this.s.aiProfit?.pending;}
 async sweepProfit(){return this.serial(()=>stepAIProfit(this));}
 status(){return {...super.status(),signingMode:'server-owner-signer',walletConnected:this.ownerConnected,unattendedSigningAvailable:this.vault.status().configured,requiresWalletSignature:false,aiOnly:true,profit:{recipient:PROFIT_RECIPIENT,withdrawnSol:(this.s.aiProfit?.paidLamports??0)/1e9,feesSol:(this.s.aiProfit?.feeLamports??0)/1e9,earnedSol:this.s.aiProfit?earnedAIProfit(this.s)/1e9:0,pending:!!this.s.aiProfit?.pending,error:this.s.aiProfit?.error??null}};}
 async connect(){this.ownerConnected=true;await this.vault.reloadIfUnavailable();if(this.storageMode==='ephemeral')throw fail('LIVE_PERSISTENT_VOLUME_REQUIRED');if(this.lastError?.startsWith('LIVE_LEGACY'))throw fail(this.lastError);if(!this.vault.status().configured)throw fail(this.vault.status().error??'LIVE_SIGNER_NOT_CONFIGURED');try{await this.reconcile();await this.sync();this.vault.enable();this.running=true;this.lastError=null;}catch(e){this.vault.lock();this.running=false;throw e;}}
 pause(paused){if(typeof paused!=='boolean')throw fail('INVALID_PAUSE_REQUEST');if(!paused){if(!this.ownerConnected)throw fail('LIVE_WALLET_NOT_CONNECTED');if(!this.signingReady())throw fail(this.vault.status().error??'LIVE_SIGNER_NOT_CONFIGURED');if(this.storageMode==='ephemeral')throw fail('LIVE_PERSISTENT_VOLUME_REQUIRED');}this.running=!paused;}
 lock(){this.ownerConnected=false;super.lock();}
 async disconnect(){this.lock();return this.serial(async()=>{for(const o of Object.values(this.s.orders))if(!o.terminal&&!o.signature){o.terminal=true;o.status='cancelled';delete o.unsignedTransaction;}await this.save();});}
 async unsignedReconcile(o){await super.unsignedReconcile(o);delete o.unsignedTransaction;}
 async adoptPortfolio(){return this.serial(async()=>{let changed=false;for(const p of this.s.positions)if(p.agentId!=='kade'&&!Object.values(this.s.orders).some(o=>!o.terminal&&(o.positionId===p.paperPositionId||o.mint===p.mint))){p.originAgentId??=p.agentId;p.agentId='kade';changed=true;}if(changed)await this.save();});}
 request(input,m,id){if(input.side==='SET_STOP')return this.serial(async()=>{if(id!=='kade'||!this.ownerConnected||!this.signingReady()||!validAIStop(input.aiStopLossPct))throw fail('LIVE_AI_STOP_REQUIRED');const p=this.s.positions.find(p=>p.agentId===id&&p.paperPositionId===input.positionId&&p.mint===input.mint);if(!p)throw fail('LIVE_SELL_LOT_MISMATCH');p.aiStopLossPct=input.aiStopLossPct;await this.save();return {terminal:true,status:'stop-updated',view:this.view(id)};});if(input.side==='BUY'&&!Object.hasOwn(this.s.orders,input.id)&&!validAIStop(input.aiStopLossPct))throw fail('LIVE_AI_STOP_REQUIRED');if(id!=='kade'&&!Object.hasOwn(this.s.orders,input.id))throw fail('LIVE_RETIRED_AGENT');return super.request(input,m,id);}
 view(id){return {...super.view(id),requiresWalletSignature:false,aiOnly:true};}
}
