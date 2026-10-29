import {Connection} from '@solana/web3.js';
import {PUMP_PROGRAM_ID,pumpIdl} from '@pump-fun/pump-sdk';
import bs58 from 'bs58';
import {withRpcPriority} from './rpc-priority.js';
const valid=s=>typeof s==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const migrations=pumpIdl.instructions.filter(i=>['migrate','migratev2'].includes(i.name.replaceAll('_','').toLowerCase()));
export function migrationMints(tx){
 if(!tx?.meta||tx.meta.err)return [];
 const instructions=[...(tx.transaction?.message?.instructions??[]),...(tx.meta.innerInstructions??[]).flatMap(i=>i.instructions??[])],mints=[];
 for(const ix of instructions){if(String(ix.programId)!==PUMP_PROGRAM_ID.toBase58()||typeof ix.data!=='string'||!Array.isArray(ix.accounts))continue;
  let bytes;try{bytes=bs58.decode(ix.data);}catch{continue;}
  for(const spec of migrations){if(!spec.discriminator.every((v,i)=>bytes[i]===v))continue;const index=spec.accounts.findIndex(a=>a.name==='mint');if(index>=0&&valid(String(ix.accounts[index])))mints.push(String(ix.accounts[index]));}
 }
 return [...new Set(mints)];
}
// These sources supply public candidate IDs only; they never supply executable prices or approve safety.
export class RulesSources {
 constructor({execution,discovery,env=process.env,fetcher=globalThis.fetch,clock=Date.now,connectionFactory=(http,ws)=>new Connection(http,{commitment:'confirmed',wsEndpoint:ws,disableRetryOnRateLimit:true})}={}){
  this.execution=execution;this.discovery=discovery;this.env=env;this.fetcher=fetcher;this.clock=clock;this.connectionFactory=connectionFactory;this.queue=[];this.seen=new Set();this.nextPublicAt=0;this.nextReceiptAt=0;this.statuses={migration:{status:'unavailable',required:'SOLANA_WS_URL (wss:// RPC logsSubscribe enabled) and authenticated SOLANA_RPC_URL or HELIUS_API_KEY for confirmed transaction reads'},publicTrending:{status:'unavailable',source:'DexScreener token-boosts/top/v1'}};
 }
 async start(){
  if(this.env.MIGRATION_SOURCE_ENABLED==='false'||!this.env.SOLANA_WS_URL)return;
  if(!this.env.SOLANA_RPC_URL&&!this.env.HELIUS_API_KEY)return;
  try{const ws=new URL(this.env.SOLANA_WS_URL);if(ws.protocol!=='wss:')throw Error('scheme');const http=this.env.SOLANA_RPC_URL??'https://mainnet.helius-rpc.com/?api-key='+encodeURIComponent(this.env.HELIUS_API_KEY);this.connection=this.connectionFactory(http,ws.toString());
   this.subscription=this.connection.onLogs(PUMP_PROGRAM_ID,row=>{this.statuses.migration={status:'listening',lastEventAt:this.clock(),confirmedOnly:true};if(row.err||!row.logs?.some(l=>/Instruction: Migrate(?:V2|_v2)?$/.test(l))||this.seen.has(row.signature))return;this.seen.add(row.signature);while(this.seen.size>256)this.seen.delete(this.seen.values().next().value);if(this.queue.length<32)this.queue.push(row.signature);else this.statuses.migration.dropped=(this.statuses.migration.dropped??0)+1;},'confirmed');this.statuses.migration={status:'subscribed_unconfirmed',note:'No event received yet; subscription registration is not proof of live coverage.'};
  }catch{this.statuses.migration={status:'unavailable',code:'WS_CONFIGURATION_OR_SUBSCRIPTION_FAILED'};}
 }
 async tick(){
  const now=this.clock();
  if(this.env.PUBLIC_TRENDING_ENABLED!=='false'&&now>=this.nextPublicAt){this.nextPublicAt=now+60000;
   try{const r=await this.fetcher('https://api.dexscreener.com/token-boosts/top/v1',{signal:AbortSignal.timeout(4000),redirect:'error'});if(!r.ok)throw Object.assign(Error('HTTP'),{status:r.status});const raw=await r.text();if(Buffer.byteLength(raw)>512000)throw Error('size');const rows=JSON.parse(raw);if(!Array.isArray(rows))throw Error('shape');const mints=[...new Set(rows.filter(r=>r.chainId==='solana'&&valid(r.tokenAddress)).map(r=>r.tokenAddress))].slice(0,30);this.discovery.remember(mints.map(mint=>({mint})),now);this.statuses.publicTrending={status:'available',checkedAt:now,candidates:mints.length,intervalMs:60000,source:'DexScreener boosts (paid visibility, not evidence of quality)'};
   }catch(e){this.statuses.publicTrending={status:'unavailable',checkedAt:now,httpStatus:e.status??null,retryAt:this.nextPublicAt};}
  }
  if(this.queue.length&&now>=this.nextReceiptAt){this.nextReceiptAt=now+3000;const signature=this.queue.shift();try{const tx=await withRpcPriority('background',()=>this.execution.rpc.getParsedTransaction(signature,{maxSupportedTransactionVersion:0,commitment:'confirmed'}));if(!tx){this.statuses.migration={status:'unavailable',code:'CONFIRMED_RECEIPT_NOT_AVAILABLE',checkedAt:now};return;}const mints=migrationMints(tx);this.discovery.remember(mints.map(mint=>({mint})),now);this.statuses.migration={status:'available',checkedAt:now,candidates:mints.length,confirmedOnly:true};}catch{this.statuses.migration={status:'unavailable',code:'MIGRATION_RPC_READ_FAILED',checkedAt:now};this.nextReceiptAt=now+30000;}}
 }
 status(){return {...this.statuses,pendingMigrationReads:this.queue.length,note:'Missing sources remain unavailable; new/trending IDs pass the same market, pre_filter, safety and quote checks. Boosts can be paid.'};}
 async stop(){if(this.connection&&this.subscription!==undefined)await this.connection.removeOnLogsListener(this.subscription);}
}
