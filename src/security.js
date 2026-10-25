import {randomBytes,createPublicKey,verify} from 'node:crypto';
import bs58 from 'bs58';
export const DEFAULT_OWNER='7JePGU7MFtRo9z5jMh2486UniD4EB4PpRd8tv2Jhqpsy';
export class OwnerAuth{
 constructor({owner=DEFAULT_OWNER,origin,clock=Date.now}={}){this.owner=owner;this.origin=origin;this.clock=clock;this.nonces=new Map();this.sessions=new Map();this.attempts=new Map();}
 limit(key){const now=this.clock();const v=this.attempts.get(key);if(v&&now-v.at<60000&&v.count>=10)throw Object.assign(Error('Quá nhiều yêu cầu xác thực. Thử lại sau một phút.'),{code:'RATE_LIMITED',retryAfterSeconds:Math.ceil((60000-(now-v.at))/1000)});this.attempts.set(key,{at:v&&now-v.at<60000?v.at:now,count:v&&now-v.at<60000?v.count+1:1});if(this.attempts.size>1000)this.attempts.delete(this.attempts.keys().next().value);}
 challenge(address){
  if(address!==this.owner)throw Error('Ví này không phải chủ hệ thống.');
  const nonce=randomBytes(32).toString('hex'),at=this.clock(),expires=at+180000;
  const message=`Meme Pilot owner authentication\nDomain: ${this.origin}\nWallet: ${address}\nNonce: ${nonce}\nIssued at: ${new Date(at).toISOString()}\nExpires at: ${new Date(expires).toISOString()}\nThis signature only authenticates dashboard access. It does not transfer SOL or tokens.`;
  for(const [k,v] of this.nonces)if(v.expires<at)this.nonces.delete(k);
  if(this.nonces.size>=100)this.nonces.delete(this.nonces.keys().next().value);
  this.nonces.set(nonce,{message,expires});return {nonce,message,expiresAt:expires};
 }
 login(nonce,signature){
  const challenge=this.nonces.get(nonce);this.nonces.delete(nonce);
  if(!challenge||challenge.expires<this.clock())throw Error('Yêu cầu xác thực đã hết hạn hoặc đã dùng.');
  const bytes=bs58.decode(signature),pub=bs58.decode(this.owner);
  if(bytes.length!==64||pub.length!==32)throw Error('Chữ ký không hợp lệ.');
  const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(pub)]),format:'der',type:'spki'});
  if(!verify(null,Buffer.from(challenge.message),key,bytes))throw Error('Chữ ký không hợp lệ.');
  const token=randomBytes(32).toString('hex');this.sessions.set(token,this.clock()+900000);return token;
 }
 authenticated(req){const token=(req.headers.cookie??'').split(';').map(c=>c.trim()).find(c=>c.startsWith('mp_session='))?.slice(11);if(!token)return false;const expires=this.sessions.get(token);if(!expires||expires<this.clock()){this.sessions.delete(token);return false;}return true;}
 logout(req){const token=(req.headers.cookie??'').split(';').map(c=>c.trim()).find(c=>c.startsWith('mp_session='))?.slice(11);this.sessions.delete(token);}
 cookie(token){return `mp_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token?900:0}${this.origin.startsWith('https:')?'; Secure':''}`;}
 sameOrigin(req){return req.headers.origin===this.origin&&req.headers['x-requested-with']==='meme-desk'&&req.headers['content-type']?.startsWith('application/json');}
}
