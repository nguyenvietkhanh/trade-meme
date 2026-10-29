// Coalesce only reconstructible state/snapshot/book updates. Never use this for financial requests/replies.
export class LatestIpc {
 constructor(channel,{onError=()=>{}}={}){this.channel=channel;this.onError=onError;this.active=false;this.pending=new Map();}
 send(type,payload){if(!['state','snapshot','book','running'].includes(type))throw Error('IPC_TYPE_NOT_RECONSTRUCTIBLE');this.pending.set(type,{type,...payload});this.drain();}
 drain(){if(this.active||!this.channel.connected||!this.pending.size)return;const type=['running','book','state','snapshot'].find(k=>this.pending.has(k)),message=this.pending.get(type);this.pending.delete(type);this.active=true;try{this.channel.send(message,error=>{this.active=false;if(error){this.pending.clear();this.onError(error);return;}this.drain();});}catch(error){this.active=false;this.pending.clear();this.onError(error);}}
}
