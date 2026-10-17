import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {DEFAULT_OWNER} from '../src/security.js';
import {connectedWalletAddress} from '../src/wallet-provider.js';

test('Phantom connection result provides a validated address',()=>{
 assert.equal(connectedWalletAddress({}, {publicKey:new PublicKey(DEFAULT_OWNER)}),DEFAULT_OWNER);
});
test('Solflare void and boolean connect results use the provider publicKey',()=>{
 for(const result of [undefined,null,true,false])assert.equal(connectedWalletAddress({publicKey:new PublicKey(DEFAULT_OWNER)},result),DEFAULT_OWNER);
});
test('string keys and public keys from another wallet library are supported',()=>{
 for(const publicKey of [DEFAULT_OWNER,{toBase58:()=>DEFAULT_OWNER},{toString:()=>DEFAULT_OWNER}])assert.equal(connectedWalletAddress({publicKey}),DEFAULT_OWNER);
});
test('missing or malformed wallet keys produce an actionable error, never an undefined toString crash',()=>{
 for(const publicKey of [undefined,null,{},'invalid-key',{toString:()=>undefined},{toBase58:()=>{throw Error('locked');}}])assert.throws(()=>connectedWalletAddress({publicKey}),/Mở khóa ví rồi kết nối lại/);
});
