import {LiveFleet} from './live-fleet.js';
import {WalletTreasury} from './wallet-treasury.js';
export class WalletFleet extends LiveFleet{
 constructor(dir,data,options={}){super(dir,data,options);this.treasury=new WalletTreasury(dir,options.execution,options);this.agentVersion='three-ai-owner-wallet-v1';}
 async connectWallet(){if(!this.modelClient?.status().configured)throw Object.assign(Error('MODEL_NOT_CONFIGURED'),{code:'MODEL_NOT_CONFIGURED'});await this.treasury.connect();this.meta.running=true;try{await this.save();}catch(e){await this.treasury.disconnect();this.meta.running=false;throw e;}this.supervisor?.running(true);this.publish();}
 async disconnectWallet(){this.meta.running=false;this.supervisor?.running(false);await this.treasury.disconnect();await this.save();this.publish();}
 async pause(paused){if(typeof paused!=='boolean')throw Object.assign(Error('INVALID_PAUSE_REQUEST'),{code:'INVALID_PAUSE_REQUEST'});if(!paused&&!this.modelClient?.status().configured)throw Object.assign(Error('MODEL_NOT_CONFIGURED'),{code:'MODEL_NOT_CONFIGURED'});try{return await super.pause(paused);}catch(error){this.treasury.pause(true);this.meta.running=false;this.supervisor?.running(false);this.publish();throw error;}}
 admission(){const t=this.treasury.status();return {allowed:t.running&&t.walletConnected&&t.availableSol>=.0025,code:!t.walletConnected?'LIVE_WALLET_NOT_CONNECTED':t.availableSol<.0025?'LIVE_INSUFFICIENT_SPENDABLE':'LIVE_WALLET_READY',message:!t.walletConnected?'Kết nối và ký thông điệp xác thực ví chủ; không cần mật khẩu':t.running?'AI tự quyết giao dịch; ví chủ ký từng lệnh, giữ 0,1 SOL gas':'BUY tạm dừng; vẫn theo dõi SELL',operationalCapacity:3};}
}
