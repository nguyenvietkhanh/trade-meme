// Tests only: deterministic read-only balances. Any broadcast is an assertion failure.
import './scalp-feed.js';
import {SolanaExecution} from '../../src/solana.js';
import {OwnerAuth} from '../../src/security.js';
SolanaExecution.prototype.network=async()=>{};
SolanaExecution.prototype.balance=async()=>4.25;
SolanaExecution.prototype.send=async()=>{throw Error('HTTP fixture must never broadcast');};
OwnerAuth.prototype.authenticated=req=>req.headers['x-fixture-owner']==='true';

// LIVE rules must never make even a mocked model HTTP request.
const marketFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{if(String(url).includes('api.river.ai')){console.error('FORBIDDEN_MODEL_REQUEST');throw Error('Rules mode must not call a model');}return marketFetch(url,options);};
OwnerAuth.prototype.login=function(nonce,signature){if(nonce!=='fixture-owner-proof'||signature!=='fixture-signature')throw Error('invalid fixture proof');return 'fixture-session';};
