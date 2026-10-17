import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {WalletVault} from '../src/vault.js';
test('wallet persists encrypted, cannot be overwritten, unlocks with password and detects tampering',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'vault-')),file=path.join(dir,'wallet.json');
 try{const v=new WalletVault(file);await v.load();await v.create('test-password-very-long','test-api-key-only','helius-private-test-key');const publicKey=v.publicKey;
 const text=await readFile(file,'utf8');assert.ok(!text.includes('test-api-key-only'));assert.ok(!text.includes('helius-private-test-key'));assert.ok(!text.includes('secret'));await assert.rejects(v.create('another-long-password'));
 v.lock();assert.equal(v.status().unlocked,false);const other=new WalletVault(file);await other.load();await assert.rejects(other.unlock('incorrect-but-long-password'));assert.equal(other.status().unlocked,false);
 await other.unlock('test-password-very-long','replacement-api-key','replacement-helius-key');assert.equal(other.publicKey,publicKey);assert.equal(other.apiKey,'replacement-api-key');other.lock();await other.unlock('test-password-very-long');assert.equal(other.apiKey,'replacement-api-key');assert.equal(other.heliusKey,'replacement-helius-key');other.lock();await assert.rejects(other.unlock('test-password-very-long',null,'bad\nkey'));assert.equal(other.keypair,null);assert.equal(other.heliusKey,null);
 const doc=JSON.parse(await readFile(file,'utf8'));doc.tag=Buffer.alloc(16).toString('base64');await writeFile(file,JSON.stringify(doc));const broken=new WalletVault(file);await assert.rejects(broken.unlock('test-password-very-long'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
