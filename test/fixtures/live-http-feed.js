// Tests only: deterministic read-only balances. Any broadcast is an assertion failure.
import './scalp-feed.js';
import {SolanaExecution} from '../../src/solana.js';
import {OwnerAuth} from '../../src/security.js';
SolanaExecution.prototype.network=async()=>{};
SolanaExecution.prototype.balance=async()=>4.25;
SolanaExecution.prototype.send=async()=>{throw Error('HTTP fixture must never broadcast');};
OwnerAuth.prototype.authenticated=req=>req.headers['x-fixture-owner']==='true';

import {PaperModelClient} from '../../src/paper-model-client.js';
PaperModelClient.prototype.decide=async function(id,context){return {decision:{action:'HOLD',mint:null,order_sol:null,sell_percent:null,confidence:.5,reason:'fixture HOLD'},expiresAt:Date.now()+30000};};
