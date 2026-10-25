import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {WalletTelegram} from '../src/wallet-telegram.js';
const token='123456789:'+('x'.repeat(35)),chatId='12345678';
test('Telegram stores no plaintext token and reopens on restart without user password or wallet signing key',async t=>{const dir=await mkdtemp(path.join(tmpdir(),'wallet-tele-'));t.after(()=>rm(dir,{recursive:true,force:true}));const reporter=new WalletTelegram(dir,dir);await reporter.configure(token,chatId);const stored=await readFile(reporter.file,'utf8');assert.ok(!stored.includes(token));assert.equal(JSON.parse(stored).version,3);assert.equal(reporter.vault,undefined);const next=new WalletTelegram(dir,dir);await next.load();assert.equal(next.creds.token,token);assert.equal(next.creds.chatId,chatId);assert.equal(next.status({}).unlocked,true);});
test('old password-encrypted Telegram config is preserved and requests token/chat reconfiguration, never guessed or overwritten',async t=>{const dir=await mkdtemp(path.join(tmpdir(),'old-tele-'));t.after(()=>rm(dir,{recursive:true,force:true}));const reporter=new WalletTelegram(dir,dir),original=JSON.stringify({version:2,ciphertext:'not-readable-without-old-key'});await writeFile(reporter.file,original);await reporter.load();assert.equal(reporter.creds,null);assert.match(reporter.error,/Bot token/);assert.equal(await readFile(reporter.file,'utf8'),original);});
