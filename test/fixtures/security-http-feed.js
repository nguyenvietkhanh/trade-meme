// Local regression server only: real OwnerAuth signatures/sessions, no signer or broadcast.
import './scalp-feed.js';
import {SolanaExecution} from '../../src/solana.js';
import {OwnerAuth} from '../../src/security.js';
import {AutomaticFleet} from '../../src/automatic-fleet.js';
SolanaExecution.prototype.network=async()=>{};
SolanaExecution.prototype.balance=async()=>4.25;
SolanaExecution.prototype.send=async()=>{throw Error('SECURITY_TEST_BROADCAST_FORBIDDEN');};
const challenge=OwnerAuth.prototype.challenge,authenticated=OwnerAuth.prototype.authenticated,disconnect=AutomaticFleet.prototype.disconnectWallet;
OwnerAuth.prototype.challenge=function(address){this.owner=process.env.SECURITY_TEST_OWNER;return challenge.call(this,address);};
OwnerAuth.prototype.authenticated=function(req){this.sessions.set('expired-fixture',Date.now()-1);return authenticated.call(this,req);};
AutomaticFleet.prototype.disconnectWallet=async function(){console.info('LOCAL_SECURITY_DISCONNECT');return disconnect.call(this);};
