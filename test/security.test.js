import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import bs58 from 'bs58';
import {OwnerAuth} from '../src/security.js';
const keys=generateKeyPairSync('ed25519'),owner=bs58.encode(keys.publicKey.export({format:'der',type:'spki'}).subarray(-32));
const signature=message=>bs58.encode(sign(null,Buffer.from(message),keys.privateKey));
test('owner signature authenticates once and creates a secure scoped session cookie',()=>{
 const a=new OwnerAuth({owner,origin:'https://example.com'}),c=a.challenge(owner),session=a.login(c.nonce,signature(c.message));
 assert.ok(a.authenticated({headers:{cookie:'mp_session='+session}}));assert.match(a.cookie(session),/HttpOnly/);assert.match(a.cookie(session),/SameSite=Strict/);assert.match(a.cookie(session),/Secure/);
 assert.throws(()=>a.login(c.nonce,signature(c.message)));assert.throws(()=>a.challenge(bs58.encode(Buffer.alloc(32,1))));
 a.logout({headers:{cookie:'mp_session='+session}});assert.equal(a.authenticated({headers:{cookie:'mp_session='+session}}),false);
});
test('wrong signatures, expired challenges, expired sessions and cross-site requests fail closed',()=>{
 let now=1000;const a=new OwnerAuth({owner,origin:'https://example.com',clock:()=>now}),c=a.challenge(owner);
 assert.throws(()=>a.login(c.nonce,bs58.encode(Buffer.alloc(64))));const next=a.challenge(owner);now+=180001;assert.throws(()=>a.login(next.nonce,signature(next.message)));
 const valid=a.challenge(owner),token=a.login(valid.nonce,signature(valid.message));now+=900001;assert.equal(a.authenticated({headers:{cookie:'mp_session='+token}}),false);
 assert.equal(a.sameOrigin({headers:{origin:'https://evil.invalid','x-requested-with':'meme-desk','content-type':'application/json'}}),false);
});
