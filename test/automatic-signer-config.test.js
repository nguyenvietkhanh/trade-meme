import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
import {AutomaticSigner,decodeSignerSecret} from '../src/automatic-signer.js';
import {AutomaticTreasury} from '../src/automatic-treasury.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
test('common Solana wallet exports, quoted Railway strings and whitespace preserve the exact authorized owner',async()=>{
 const kp=Keypair.generate(),owner=kp.publicKey.toBase58(),secret=bs58.encode(kp.secretKey),seed=kp.secretKey.slice(0,32);
 const inputs=[secret,JSON.stringify(secret),"'"+secret+"'",' \n'+secret+'\n ',secret.slice(0,40)+'\n'+secret.slice(40),JSON.stringify([...kp.secretKey]),JSON.stringify({secretKey:[...kp.secretKey]}),JSON.stringify({privateKey:secret}),Buffer.from(kp.secretKey).toString('base64'),Buffer.from(kp.secretKey).toString('hex'),'0x'+Buffer.from(seed).toString('hex'),JSON.stringify([...seed]),bs58.encode(seed)];
 for(const value of inputs){const signer=new AutomaticSigner(owner,{LIVE_SIGNER_SECRET_KEY:value});await signer.load();assert.equal(signer.status().configured,true);assert.equal(signer.status().runtimeVariablePresent,true);signer.enable();assert.equal(signer.keypair.publicKey.toBase58(),owner);assert.ok(!JSON.stringify(signer.status()).includes(secret));}
});
test('public SOL addresses, malformed keys and wrong-owner private keys never authorize signing',()=>{
 const kp=Keypair.generate(),owner=kp.publicKey.toBase58();assert.throws(()=>decodeSignerSecret(owner,owner),{code:'LIVE_SIGNER_PUBLIC_ADDRESS'});
 for(const bad of ['not-a-key','[1,2,3]','{"secretKey":"bad"}','"unterminated',JSON.stringify(Array(64).fill(256)),JSON.stringify(Array(64).fill(.1))])assert.throws(()=>decodeSignerSecret(bad,owner),{code:'LIVE_SIGNER_INVALID'});
 assert.throws(()=>decodeSignerSecret(bs58.encode(Keypair.generate().secretKey),owner),{code:'LIVE_SIGNER_OWNER_MISMATCH'});
});
test('failed startup configuration can be re-read on connect, with no secret in diagnostics and no silent active-key replacement',async()=>{
 const kp=Keypair.generate(),owner=kp.publicKey.toBase58(),env={},signer=new AutomaticSigner(owner,env);await signer.load();assert.equal(signer.status().error,'LIVE_SIGNER_NOT_CONFIGURED');assert.equal(signer.status().runtimeVariablePresent,false);
 env.LIVE_SIGNER_SECRET_KEY=JSON.stringify(bs58.encode(kp.secretKey));assert.equal(signer.status().runtimeVariablePresent,true);assert.equal(signer.status().configured,false);await signer.reloadIfUnavailable();assert.equal(signer.status().configured,true);assert.equal(signer.status().error,null);signer.enable();env.LIVE_SIGNER_SECRET_KEY=bs58.encode(Keypair.generate().secretKey);await signer.load({retry:true});assert.equal(signer.keypair.publicKey.toBase58(),owner,'a running signer must not rotate keys underneath existing orders');
});
test('reconnecting after initial missing runtime variable enables the signer only after owner match and ledger reconciliation',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'signer-reload-'));t.after(()=>rm(dir,{recursive:true,force:true}));const kp=Keypair.generate(),owner=kp.publicKey.toBase58(),env={},execution={network:async()=>{},balance:async()=>1},treasury=new AutomaticTreasury(path.join(dir,'live'),execution,{owner,legacyDir:dir,signerEnv:env});await treasury.load();await assert.rejects(treasury.connect(),{code:'LIVE_SIGNER_NOT_CONFIGURED'});assert.equal(treasury.signingReady(),false);env.LIVE_SIGNER_SECRET_KEY=bs58.encode(kp.secretKey);await treasury.connect();assert.equal(treasury.signingReady(),true);assert.equal(treasury.status().signer.error,null);assert.equal(treasury.s.initialSol,1);assert.equal(treasury.status().requiresWalletSignature,false);
});
