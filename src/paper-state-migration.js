import path from 'node:path';
import {readFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {BOT_CONFIGS,INDEPENDENT_VERSION} from './paper-bot-config.js';
import {BotStateStore,initialBotState,lamports,sol} from './paper-bot-state.js';
import {writeDurable} from './persistence.js';
export function migrationPlan(legacy,now=Date.now()){
 const states=BOT_CONFIGS.map(a=>initialBotState(a,now));if(!legacy)return {states,source:'fresh',deltaLamports:0};
 if(!Number.isFinite(legacy.cashSol)||legacy.cashSol<0||!Array.isArray(legacy.positions))throw Error('Migration: invalid legacy ledger');
 const known=new Set(states.map(s=>s.id));if(legacy.positions.some(p=>!known.has(p.agentId)))throw Error('Migration blocked: unattributed open positions');
 for(const s of states){
  s.positions=structuredClone(legacy.positions.filter(p=>p.agentId===s.id));s.trades=structuredClone((legacy.trades??[]).filter(t=>t.agentId===s.id));
  const g=legacy.agentStats?.[s.id],realized=g?.realizedPnlSol??s.trades.filter(t=>t.side==='SELL').reduce((n,t)=>n+(t.pnlSol??0),0);
  if(!Number.isFinite(realized))throw Error('Migration: unknown PnL');
  s.realizedPnlSol=realized;if(g)s.metrics=structuredClone(g);s.rentLockedSol=sol(s.positions.reduce((n,p)=>n+(p.rentSol??.00203928),0));
  s.cashSol=sol(2+realized-s.positions.reduce((n,p)=>n+p.costSol,0)-s.rentLockedSol);
  if(s.cashSol<0)throw Error('Migration blocked: negative isolated wallet '+s.id);
  s.cooldowns=structuredClone(legacy.promptCooldowns?.[s.id]??{});s.running=legacy.running!==false;s.startedAt=legacy.startedAt??now;
  s.migration={at:now,sourceSession:legacy.session,realizedPnlSol:realized,cancelledPendingBuys:true};
  // Pending orders have no booked transfer. Re-evaluate their BUY or exit against fresh data.
 }
 const cash=states.reduce((n,s)=>n+lamports(s.cashSol),0),rent=states.reduce((n,s)=>n+lamports(s.rentLockedSol),0);
 const deltaLamports=lamports(legacy.cashSol)-cash;
 if(Math.abs(deltaLamports)>2||Math.abs(lamports(legacy.rentLockedSol??0)-rent)>2)throw Error('Migration blocked: legacy cash/rent does not reconcile; history or explicit allocation required (cash delta '+deltaLamports+' lamports)');
 if(deltaLamports){states[0].cashSol=sol(states[0].cashSol+deltaLamports/1e9);states[0].migration.roundingLamports=deltaLamports;}
 return {states,source:'legacy',deltaLamports};
}
export async function migrateFleet(dir,now=Date.now()){
 const manifest=path.join(dir,'fleet.json');let previous;
 try{previous=JSON.parse(await readFile(manifest,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(previous){if(previous.version!==INDEPENDENT_VERSION)throw Error('Unknown fleet version');await Promise.all(BOT_CONFIGS.map(a=>new BotStateStore(dir,a.id).load()));return previous;}
 let legacy=null,raw;try{raw=await readFile(path.join(dir,'ledger.json'),'utf8');legacy=JSON.parse(raw);}catch(e){if(e.code!=='ENOENT')throw e;}
 // A missing manifest alongside state files is an interrupted migration, not fresh capital.
 await mkdir(path.join(dir,'state'),{recursive:true,mode:0o700});const plan=migrationPlan(legacy,now),intentFile=path.join(dir,'migration-intent.json');
 const fingerprint=createHash('sha256').update(raw??'fresh').digest('hex');
 let intent;try{intent=JSON.parse(await readFile(intentFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(intent&&intent.fingerprint!==fingerprint)throw Error('Migration source changed');
 const files=await readdir(path.join(dir,'state'));if(files.some(f=>f.endsWith('.json'))&&!intent)throw Error('Orphan bot files: refusing to reissue virtual money');
 if(!intent){intent={fingerprint,at:now,states:plan.states};await writeDurable(intentFile,intent);if(raw)await writeDurable(path.join(dir,'ledger-before-isolation.json'),raw);}
 for(const s of intent.states){const store=new BotStateStore(dir,s.id);try{const old=await store.load();if(JSON.stringify(old)!==JSON.stringify(s))throw Error('Partial migration state changed');}catch(e){if(e.code!=='ENOENT')throw e;await store.save(s);}}
 const meta={version:INDEPENDENT_VERSION,session:legacy?.session??'isolated-'+now,startedAt:legacy?.startedAt??now,migratedAt:now,source:plan.source,running:legacy?.running!==false,reportLastEnd:legacy?.reportLastEnd,telegramOutbox:legacy?.telegramOutbox??[],discovery:legacy?.discovery??null,legacyHistory:legacy?{trades:legacy.trades??[],events:legacy.events??[]}:null};
 await writeDurable(manifest,meta);return meta;
}
