// Only fixed, public incident codes enter Telegram. No raw errors, URLs or keys.
const CODES=['RPC_UNAVAILABLE','SIGNER_UNAVAILABLE','POSITION_MONITOR_STALLED'];
export function signerUnavailable(status,required,starting=false){
 if(!required)return false;
 if(!status.signer?.configured)return true;
 return !status.signer.unlocked&&status.connection?.error!=='RPC_UNAVAILABLE'&&!starting;
}
export function compactHealthAlerts(rows,active){const seen=new Set();let changed=false;for(const row of [...rows].reverse()){if(row.status!=='queued'||typeof row.id!=='string'||!row.id.startsWith('health:'))continue;const code=row.id.split(':')[1];if(!CODES.includes(code))continue;if(!active.includes(code)){row.status='resolved';changed=true;}else if(seen.has(code)){row.status='superseded';changed=true;}else seen.add(code);}return changed;}
export class RulesHealth {
 constructor({clock=Date.now}={}){this.clock=clock;this.startedAt=clock();this.lastMonitorAt=null;this.active=new Set();this.sequence=0;}
 restore(saved){this.active=new Set(saved?.version===1&&Array.isArray(saved.active)?saved.active.filter(c=>CODES.includes(c)):[]);this.sequence=Number.isSafeInteger(saved?.sequence)&&saved.sequence>=0?saved.sequence:0;}
 snapshot(){return {version:1,active:[...this.active].sort(),sequence:this.sequence};}
 monitor(at=this.clock()){this.lastMonitorAt=at;}
 check({rpcError=false,signerError=false,signerCode=null,positions=0,workerHeartbeatAt=null}={}){
  const now=this.clock(),codes=[];if(rpcError)codes.push('RPC_UNAVAILABLE');if(signerError)codes.push('SIGNER_UNAVAILABLE');
  if(positions>0&&(now-(this.lastMonitorAt??this.startedAt)>60000||now-(workerHeartbeatAt??this.startedAt)>60000))codes.push('POSITION_MONITOR_STALLED');
  const previous=this.active;this.active=new Set(codes);
  return codes.filter(code=>!previous.has(code)).map(code=>({id:'health:'+code+':'+now+':'+(++this.sequence),createdAt:now,status:'queued',attempts:0,nextAttemptAt:0,text:'Meme Pilot · CẢNH BÁO '+code+'\n'+(code==='POSITION_MONITOR_STALLED'?'Vòng theo dõi vị thế không cập nhật quá 60 giây. Kiểm tra ngay RPC và worker.':code==='RPC_UNAVAILABLE'?'RPC chưa phản hồi. Số dư gần nhất không phải số dư mới; SELL cần RPC hoạt động.':'Signer chưa sẵn sàng'+(['LIVE_SIGNER_NOT_CONFIGURED','LIVE_SIGNER_INVALID','LIVE_SIGNER_OWNER_MISMATCH','LIVE_SIGNER_PUBLIC_ADDRESS'].includes(signerCode)?' ('+signerCode+')':'')+'. Không đảm bảo SELL bảo vệ thực thi khi signer lỗi.')}));
 }
}
