import path from 'node:path';
// Read-only evidence adapter. Bounded background reads, no quote/sign/send APIs.
import {readFile,writeFile,rename,stat,mkdir} from 'node:fs/promises';
import {PublicKey} from '@solana/web3.js';
import {getPumpProgram,PUMP_PROGRAM_ID} from '@pump-fun/pump-sdk';
import {withRpcPriority} from './rpc-priority.js';
const valid=s=>typeof s==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
export function pumpEvents(tx,coder,mint){
 if(!tx?.meta||tx.meta.err||!Array.isArray(tx.meta.logMessages)||tx.meta.logMessages.some(l=>/truncated/i.test(l)))return {complete:false,events:[]};
 const stack=[],events=[];let complete=true,expectedTrades=0,decodedTrades=0;
 for(const line of tx.meta.logMessages){const invoke=/^Program (\w+) invoke \[\d+\]$/.exec(line),end=/^Program (\w+) (?:success|failed:)/.exec(line);
  if(invoke)stack.push(invoke[1]);else if(end){if(stack.at(-1)===end[1])stack.pop();else{stack.length=0;complete=false;}}
  else if(stack.at(-1)===PUMP_PROGRAM_ID.toBase58()&&/^Program log: Instruction: (Buy|Sell)/.test(line))expectedTrades++;
  else if(stack.at(-1)===PUMP_PROGRAM_ID.toBase58()&&line.startsWith('Program data: ')){try{const e=coder.decode(line.slice(14));if(e&&/^tradeEvent$/i.test(e.name))decodedTrades++;if(e&&String(e.data.mint)===mint)events.push(e);}catch{complete=false;}}
 }
 return {complete:complete&&stack.length===0&&decodedTrades>=expectedTrades,events};
}
export async function boundedProjectText(response,limit){
 const length=Number(response.headers?.get?.('content-length'));if(Number.isFinite(length)&&length>limit)throw Error('RESEARCH_TOO_LARGE');
 if(!response.body?.getReader){const text=await response.text();if(Buffer.byteLength(text)>limit)throw Error('RESEARCH_TOO_LARGE');return text;}
 const reader=response.body.getReader(),chunks=[];let bytes=0;try{for(;;){const row=await reader.read();if(row.done)break;bytes+=row.value.byteLength;if(bytes>limit){await reader.cancel();throw Error('RESEARCH_TOO_LARGE');}chunks.push(Buffer.from(row.value));}}finally{reader.releaseLock();}return Buffer.concat(chunks).toString('utf8');
}
export class ProjectResearch{
 constructor({execution,file,fetcher=globalThis.fetch,env=process.env,clock=Date.now}={}){this.execution=execution;this.file=file;this.fetcher=fetcher;this.env=env;this.clock=clock;this.cache=new Map();this.nextAt=0;this.wallets=new Set();this.walletsAvailable=false;this.walletsCheckedAt=0;this.busy=false;this.interval=30000;this.url=env.PROJECT_RESEARCH_URL??null;if(this.url&&new URL(this.url).protocol!=='https:')throw Error('PROJECT_RESEARCH_URL_REQUIRES_HTTPS');}
 async saveWallets(text){
  if(typeof text!=='string'||Buffer.byteLength(text)>3500)throw Object.assign(Error('WALLETS_LIST_INVALID'),{code:'WALLETS_LIST_INVALID'});
  const rows=text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#')),addresses=rows.map(x=>x.split(/[\s,]/)[0]);
  if(addresses.some(a=>!valid(a)))throw Object.assign(Error('WALLETS_LIST_INVALID'),{code:'WALLETS_LIST_INVALID'});for(const a of addresses)new PublicKey(a);
  if(path.basename(this.file)!=='wallets.txt')throw Object.assign(Error('WALLETS_PATH_INVALID'),{code:'WALLETS_PATH_INVALID'});await mkdir(path.dirname(this.file),{recursive:true,mode:0o700});await this.listJob;const temp=this.file+'.tmp';await writeFile(temp,text,{encoding:'utf8',mode:0o600});await rename(temp,this.file);await this.listJob;this.walletsCheckedAt=0;await this.list();return this.status();
 }
 async list(){if(this.listJob)return this.listJob;const task=this.loadList();this.listJob=task;try{await task;}finally{if(this.listJob===task)this.listJob=null;}}
 async loadList(){if(this.walletsCheckedAt&&this.clock()-this.walletsCheckedAt<10000)return;this.walletsCheckedAt=this.clock();this.walletsAvailable=false;
  try{if((await stat(this.file)).size>262144)return;const text=await readFile(this.file,'utf8');if(Buffer.byteLength(text)>262144)return;const rows=text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#')),addresses=rows.map(x=>x.split(/[\s,]/)[0]);if(addresses.length>4096||addresses.some(a=>!valid(a)))return;for(const a of addresses)new PublicKey(a);if(!addresses.length&&!/^#\s*allow-empty\s*$/m.test(text))return;this.wallets=new Set(addresses);this.walletsAvailable=true;}catch{}
 }
 async read(m,facts){
  await this.list();const now=this.clock(),key=m.mint+':'+m.pairAddress,old=this.cache.get(key);
  if((!old||now-old.checkedAt>=60000)&&!this.busy&&now>=this.nextAt){this.busy=true;this.nextAt=now+this.interval;
   this.job=withRpcPriority('research',()=>this.probe(m)).then(value=>{this.cache.set(key,value);while(this.cache.size>128)this.cache.delete(this.cache.keys().next().value);}).catch(()=>{this.cache.set(key,{checkedAt:this.clock(),status:'unavailable'});}).finally(()=>{while(this.cache.size>128)this.cache.delete(this.cache.keys().next().value);this.busy=false;});
  }
  const evidence=old&&now-old.checkedAt<=60000?old:{checkedAt:now,status:'pending'},addresses=facts.top10Wallets;
  return {...evidence,top10Wallets:addresses??null,top10WalletsVerified:facts.top10ExcludesPool===true&&Array.isArray(addresses),walletsListAvailable:this.walletsAvailable,blockedWalletMatches:this.walletsAvailable&&Array.isArray(addresses)?addresses.filter(w=>this.wallets.has(w.address??w)).map(w=>w.address??w):null};
 }
 async probe(m){
  if(this.url){const u=new URL(this.url);u.searchParams.set('mint',m.mint);u.searchParams.set('pool',m.pairAddress);const response=await this.fetcher(u,{redirect:'error',signal:AbortSignal.timeout(4000)});if(!response.ok)throw Error('RESEARCH_PROVIDER_UNAVAILABLE');const text=await boundedProjectText(response,131072);const d=JSON.parse(text);if(d.mint!==m.mint||d.pool!==m.pairAddress||!Number.isFinite(d.checkedAt)||d.checkedAt>this.clock()||this.clock()-d.checkedAt>60000)throw Error('RESEARCH_IDENTITY_OR_TIME');return {checkedAt:d.checkedAt,source:'configured-research-provider',devSellHistoryVerified:d.coverage?.devFirst15m===true,devSoldFirst15m:typeof d.devSoldFirst15m==='boolean'?d.devSoldFirst15m:null,creationBlockComplete:d.coverage?.creationBlock===true&&Array.isArray(d.creationBlockBuyers)&&d.creationBlockBuyers.every(b=>valid(b.wallet)&&Number.isFinite(b.sol)&&b.sol>0),creationBlockBuyers:d.creationBlockBuyers??null,socials:d.socials?.verified===true?{ageHours:d.socials.ageHours,followers:d.socials.followers,verified:true,source:d.socials.source??null}:null,devHistory:d.devHistory??null};}
  const rpc=this.execution.rpc,coder=getPumpProgram(rpc).coder.events,signatures=await rpc.getSignaturesForAddress(new PublicKey(m.mint),{limit:64},'confirmed');
  if(!Array.isArray(signatures)||signatures.length>=64)return {checkedAt:this.clock(),source:'confirmed-rpc',status:'creation_history_incomplete'};
  const history=signatures.filter(s=>!s.err).sort((a,b)=>a.slot-b.slot),transactions=[];
  // Never fan out a block or scan an unbounded transaction history.
  for(const s of history.slice(0,8)){const tx=await rpc.getParsedTransaction(s.signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});if(!tx||tx.slot!==s.slot||tx.transaction?.signatures?.[0]!==s.signature)continue;transactions.push({tx,decoded:pumpEvents(tx,coder,m.mint)});}
  let creation=null;for(const row of transactions)for(const e of row.decoded.events)if(/^createEvent$/i.test(e.name)){const creator=String(e.data.creator??e.data.user);if(m.creatorAddress&&creator!==m.creatorAddress)continue;creation={slot:row.tx.slot,at:row.tx.blockTime*1000,creator};break;}
  if(!creation||!Number.isFinite(creation.at))return {checkedAt:this.clock(),source:'confirmed-rpc',status:'creation_unverified'};
  const blockRows=history.filter(s=>s.slot===creation.slot),covered=new Set(transactions.filter(r=>r.decoded.complete).map(r=>r.tx.transaction.signatures[0])),buyers=[],sells=[];
  for(const row of transactions){const keys=row.tx.transaction.message.accountKeys,signers=new Set(keys.filter(k=>k.signer).map(k=>String(k.pubkey)));
   for(const e of row.decoded.events){if(!/^tradeEvent$/i.test(e.name))continue;const d=e.data,user=String(d.user),rawAmount=Number(String(d.solAmount??d.sol_amount)),amount=rawAmount/1e9,isBuy=d.isBuy??d.is_buy;if(!signers.has(user)||!Number.isSafeInteger(rawAmount)||amount<=0){row.decoded.complete=false;covered.delete(row.tx.transaction.signatures[0]);continue;}if(isBuy&&row.tx.slot===creation.slot)buyers.push({wallet:user,sol:amount});if(!isBuy&&user===creation.creator&&row.tx.blockTime*1000>=creation.at&&row.tx.blockTime*1000<=creation.at+900000)sells.push({at:row.tx.blockTime*1000,sol:amount});}
  }
  const allCovered=history.every(s=>covered.has(s.signature));
  return {checkedAt:this.clock(),source:'confirmed-rpc',creationSlot:creation.slot,creationAt:creation.at,creationBlockComplete:blockRows.every(s=>covered.has(s.signature)),creationBlockBuyers:buyers,devSellHistoryVerified:allCovered,devSoldFirst15m:sells.length?true:allCovered?false:null,devSells:sells,socials:null,devHistory:{tokensCreated:null,diedWithin1h:null,coverage:'unverified; full creator index unavailable'}};
 }
 status(){return {enabled:true,cached:this.cache.size,busy:this.busy,walletsListAvailable:this.walletsAvailable,walletsListed:this.wallets.size,source:this.url?'configured-research-provider':'confirmed-rpc',socials:this.url?'provider-required':'unverified; no authenticated social history source',intervalMs:this.interval};}
}
