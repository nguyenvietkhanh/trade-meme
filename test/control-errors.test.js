import test from 'node:test';
import assert from 'node:assert/strict';
import {controlError,pausedValue} from '../src/control-errors.js';
import {OwnerAuth} from '../src/security.js';
test('missing or non-boolean paused can never implicitly resume trading',()=>{for(const input of [{},null,{paused:'false'},{paused:0},{paused:1}])assert.throws(()=>pausedValue(input),{code:'INVALID_PAUSE_REQUEST'});assert.equal(pausedValue({paused:false}),false);assert.equal(pausedValue({paused:true}),true);});
test('known control failures are actionable; arbitrary exception details are never returned',()=>{const r=controlError({code:'LIVE_WALLET_NOT_CONNECTED'});assert.equal(r.status,409);assert.equal(r.body.nextAction,'connect-wallet');assert.match(r.body.error,/Không cần mật khẩu/);assert.ok(!JSON.stringify(controlError(Error('secret-token-and-password'))).includes('secret-token-and-password'));});
test('rate limit has a real 429 code with remaining wait time, not invalid password 400',()=>{let now=10000;const auth=new OwnerAuth({clock:()=>now});for(let i=0;i<10;i++)auth.limit('owner');let e;try{auth.limit('owner');}catch(error){e=error;}const r=controlError(e);assert.equal(r.status,429);assert.equal(r.body.retryAfterSeconds,60);now+=60000;assert.doesNotThrow(()=>auth.limit('owner'));});
