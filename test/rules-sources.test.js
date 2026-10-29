import test from 'node:test';import assert from 'node:assert/strict';import {PUMP_PROGRAM_ID,pumpIdl} from '@pump-fun/pump-sdk';import bs58 from 'bs58';
import {RulesSources,migrationMints} from '../src/rules-sources.js';import {DiscoveryQueue} from '../src/discovery.js';
const mint='9v4airX4Vt45ADFg3QQG9pXX68LkX9Big4GiYEuJpump';
test('migration candidate requires a confirmed, successful pump instruction with SDK discriminator and account index',()=>{
 const spec=pumpIdl.instructions.find(i=>i.name==='migrate'),accounts=spec.accounts.map(()=>PUMP_PROGRAM_ID);accounts[spec.accounts.findIndex(a=>a.name==='mint')]=mint;
 const ix={programId:PUMP_PROGRAM_ID,data:bs58.encode(Uint8Array.from(spec.discriminator)),accounts},tx={meta:{err:null},transaction:{message:{instructions:[ix]}}};assert.deepEqual(migrationMints(tx),[mint]);assert.deepEqual(migrationMints({...tx,meta:{err:{failed:true}}}),[]);assert.deepEqual(migrationMints({...tx,transaction:{message:{instructions:[{...ix,data:'invalid!'}]}}}),[]);
});
test('missing WS/RPC configuration is unavailable; public source is rate bounded, supplies IDs only and flags 429',async()=>{
 let time=1900000000000,calls=0,bad=false;const discovery=new DiscoveryQueue(),s=new RulesSources({discovery,execution:{},env:{},clock:()=>time,fetcher:async()=>{calls++;return bad?new Response('',{status:429}):new Response(JSON.stringify([{chainId:'solana',tokenAddress:mint,marketCap:999999,price:'do not trust'}]));}});await s.start();assert.equal(s.status().migration.status,'unavailable');assert.match(s.status().migration.required,/SOLANA_WS_URL/);await s.tick();await s.tick();assert.equal(calls,1);assert.deepEqual(discovery.snapshot().map(r=>r.mint),[mint]);assert.ok(!JSON.stringify(discovery.snapshot()).includes('do not trust'));time+=60001;bad=true;await s.tick();assert.equal(s.status().publicTrending.status,'unavailable');assert.equal(s.status().publicTrending.httpStatus,429);
});
