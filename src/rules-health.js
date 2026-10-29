// Only fixed, public incident codes enter Telegram. No raw errors, URLs or keys.
export class RulesHealth {
 constructor({clock=Date.now,cooldownMs=300000}={}){this.clock=clock;this.cooldownMs=cooldownMs;this.startedAt=clock();this.lastMonitorAt=null;this.last=new Map();}
 monitor(at=this.clock()){this.lastMonitorAt=at;}
 check({rpcError=false,signerError=false,positions=0,workerHeartbeatAt=null}={}){
  const now=this.clock(),codes=[];if(rpcError)codes.push('RPC_UNAVAILABLE');if(signerError)codes.push('SIGNER_UNAVAILABLE');
  if(positions>0&&(now-(this.lastMonitorAt??this.startedAt)>60000||now-(workerHeartbeatAt??this.startedAt)>60000))codes.push('POSITION_MONITOR_STALLED');
  return codes.filter(code=>now-(this.last.get(code)??-Infinity)>=this.cooldownMs).map(code=>{this.last.set(code,now);return {id:'health:'+code+':'+Math.floor(now/this.cooldownMs),createdAt:now,status:'queued',attempts:0,nextAttemptAt:0,text:'Meme Pilot · CẢNH BÁO '+code+'\n'+(code==='POSITION_MONITOR_STALLED'?'Vòng theo dõi vị thế không cập nhật quá 60 giây. Kiểm tra ngay RPC và worker.':'Kiểm tra RPC/signer; không đảm bảo SELL bảo vệ thực thi khi dịch vụ lỗi.')};});
 }
}
