// Tests only: deterministic read-only balances. Any broadcast is an assertion failure.
import './scalp-feed.js';
import {SolanaExecution} from '../../src/solana.js';
import {OwnerAuth} from '../../src/security.js';
SolanaExecution.prototype.network=async()=>{};
SolanaExecution.prototype.balance=async()=>4.25;
SolanaExecution.prototype.send=async()=>{throw Error('HTTP fixture must never broadcast');};
OwnerAuth.prototype.authenticated=req=>req.headers['x-fixture-owner']==='true';

// Exercise the actual model HTTP parser with a deterministic local response.
const marketFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>String(url).includes('api.river.ai')?new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'HOLD',mint:null,order_sol:null,sell_percent:null,confidence:0,reason:'API_OK'})}}]}),{status:200}):marketFetch(url,options);
OwnerAuth.prototype.login=function(nonce,signature){if(nonce!=='fixture-owner-proof'||signature!=='fixture-signature')throw Error('invalid fixture proof');return 'fixture-session';};
