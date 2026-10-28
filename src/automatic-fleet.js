import {tradingProduct} from './trading-product.js';
import {LiveFleet} from './live-fleet.js';
import {AutomaticTreasury} from './automatic-treasury.js';
export class AutomaticFleet extends LiveFleet{
 constructor(dir,data,options={}){super(dir,data,options);this.product=options.product??tradingProduct({});this.treasury=new AutomaticTreasury(dir,options.execution,{...options,spotEntriesAllowed:this.product.spotEntriesAllowed,marketSnapshot:()=>data.snapshot()});this.agentVersion='single-ai-autonomous-v1';}
 error(error){const now=Date.now(),message=(this.mode??'live').toUpperCase()+' · '+(error.bot??'data')+': '+(error.message??String(error)),prior=this.errors.find(e=>e.message===message&&now-e.at<30000);if(prior){prior.count=(prior.count??1)+1;prior.lastAt=now;return;}super.error(error);this.errors[0].count=1;this.errors[0].lastAt=now;}
 async prepareModelContext(context){if(!this.product.spotEntriesAllowed)return {...context,candidates:[],wallet:{...context.wallet,running:false},transition:{target:this.product.label,spotEntriesAllowed:false,perpsEnabled:false,task:'Manage existing spot holdings only. Do not propose new spot buys or derivatives orders.'}};const read=this.treasury.execution.readModelMintFacts;let facts={};if(typeof read==='function')try{facts=await read.call(this.treasury.execution,context.candidates.map(c=>c.mint));}catch{}return {...context,candidates:context.candidates.map(c=>({...c,mintSafety:facts[c.mint]??{status:'unknown',facts:null,reason:'MINT_FACTS_NOT_AVAILABLE'},otherSecurity:{holders:null,lpLock:null,rugCheck:null,note:'Not verified by the supplied data; never imply certified safety'}}))};}
 async load(){await super.load();await this.treasury.adoptPortfolio();this.publish();}
 async pulse(){
  try{
   if(this.meta.walletAuthorized&&!this.treasury.signingReady()){
    if(this.clock()<(this.reconnectAt??0))return;
    this.reconnectAt=this.clock()+15000;
    await this.connectWallet({resumeBuys:this.meta.buyEnabledWanted!==false});
   }
   if(this.clock()<(this.rpcRetryAt??0))return;
   await this.treasury.reconcile();await this.treasury.adoptPortfolio();await this.treasury.reconcileInventory();await this.treasury.sweepProfit();await this.treasury.sync();this.rpcIssue=null;this.rpcRetryAt=0;
  }catch(e){
   if(e.code==='RPC_UNAVAILABLE'||/RPC_UNAVAILABLE|Các RPC đã cấu hình/.test(e.message??'')){
    const diagnostics=this.treasury.execution.rpc?.rpcDiagnostics?.(),retryAt=Math.min(...(diagnostics?.cooldowns??[]).map(r=>r.retryAt).filter(at=>at>this.clock()));
    this.rpcIssue='RPC_UNAVAILABLE';this.rpcRetryAt=Number.isFinite(retryAt)?retryAt:this.clock()+15000;this.reconnectAt=Math.max(this.reconnectAt??0,this.rpcRetryAt);
   }
   throw e;
  }finally{this.publish();}
 }
 async connectWallet({resumeBuys=true}={}){await this.modelClient.verify({reuseForMs:60000});await this.treasury.connect();if(!resumeBuys)this.treasury.pause(true);this.meta.running=this.treasury.running;this.meta.walletAuthorized=true;this.meta.buyEnabledWanted=this.treasury.running;try{await this.save();}catch(e){await this.treasury.disconnect();this.meta.running=false;throw e;}this.supervisor?.running(this.meta.running);this.publish();}
 async disconnectWallet(){this.rpcIssue=null;this.rpcRetryAt=0;this.meta.walletAuthorized=false;this.meta.buyEnabledWanted=false;this.meta.running=false;this.supervisor?.running(false);await this.treasury.disconnect();await this.save();this.publish();}
 async pause(paused){if(typeof paused!=='boolean')throw Object.assign(Error('INVALID_PAUSE_REQUEST'),{code:'INVALID_PAUSE_REQUEST'});if(!paused&&!this.product.spotEntriesAllowed)throw Object.assign(Error('PERPS_NOT_READY'),{code:'PERPS_NOT_READY'});if(!paused){await this.modelClient.verify({reuseForMs:60000});if(this.treasury.ownerConnected&&!this.treasury.signingReady())await this.treasury.connect();}try{this.meta.buyEnabledWanted=!paused;return await super.pause(paused);}catch(e){this.treasury.pause(true);this.meta.running=false;this.supervisor?.running(false);this.publish();throw e;}}
 admission(){if(!this.product.spotEntriesAllowed)return {allowed:false,code:'PERPS_NOT_READY',message:this.product.message,operationalCapacity:0};const t=this.treasury.status(),ready=t.signer.unlocked;return {allowed:t.running&&ready&&!this.rpcIssue&&t.connection.balanceFresh&&t.availableSol>=.0025,code:!ready?(t.connection.error??t.signer.error??(t.connection.ownerAuthorized?'LIVE_SIGNER_LOCKED':'LIVE_WALLET_NOT_CONNECTED')):this.rpcIssue||!t.connection.balanceFresh?'RPC_UNAVAILABLE':t.availableSol<.0025?'LIVE_INSUFFICIENT_SPENDABLE':'LIVE_AUTONOMOUS_READY',message:this.rpcIssue||t.connection.error==='RPC_UNAVAILABLE'||ready&&!t.connection.balanceFresh?'Chờ RPC phục hồi để xác minh số dư và đối soát; giữ nguyên vị thế và chữ ký lệnh cũ':!ready?(t.signer.error?'Chưa cấu hình bộ ký server cho ví chủ':'Kết nối và xác thực ví chủ để bật AI tự giao dịch'):t.running?'AI tự quyết, tự ký và gửi BUY/SELL; không chờ duyệt từng lệnh':'BUY tạm dừng; SELL vẫn tự động theo dõi',operationalCapacity:100};}
}
