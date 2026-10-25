import {LiveFleet} from './live-fleet.js';
import {AutomaticTreasury} from './automatic-treasury.js';
export class AutomaticFleet extends LiveFleet{
 constructor(dir,data,options={}){super(dir,data,options);this.treasury=new AutomaticTreasury(dir,options.execution,options);this.agentVersion='three-ai-autonomous-v1';}
 async connectWallet(){await this.modelClient.verify({reuseForMs:60000});await this.treasury.connect();this.meta.running=true;try{await this.save();}catch(e){await this.treasury.disconnect();this.meta.running=false;throw e;}this.supervisor?.running(true);this.publish();}
 async disconnectWallet(){this.meta.running=false;this.supervisor?.running(false);await this.treasury.disconnect();await this.save();this.publish();}
 async pause(paused){if(typeof paused!=='boolean')throw Object.assign(Error('INVALID_PAUSE_REQUEST'),{code:'INVALID_PAUSE_REQUEST'});if(!paused){await this.modelClient.verify({reuseForMs:60000});if(this.treasury.ownerConnected&&!this.treasury.signingReady())await this.treasury.connect();}try{return await super.pause(paused);}catch(e){this.treasury.pause(true);this.meta.running=false;this.supervisor?.running(false);this.publish();throw e;}}
 admission(){const t=this.treasury.status(),ready=t.signer.unlocked;return {allowed:t.running&&ready&&t.availableSol>=.0025,code:!ready?(t.signer.error??'LIVE_WALLET_NOT_CONNECTED'):t.availableSol<.0025?'LIVE_INSUFFICIENT_SPENDABLE':'LIVE_AUTONOMOUS_READY',message:!ready?(t.signer.error?'Chưa cấu hình bộ ký server cho ví chủ':'Kết nối và xác thực ví chủ để bật AI tự giao dịch'):t.running?'AI tự quyết, tự ký và gửi BUY/SELL; không chờ duyệt từng lệnh':'BUY tạm dừng; SELL vẫn tự động theo dõi',operationalCapacity:3};}
}
