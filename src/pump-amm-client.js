import {OnlinePumpAmmSdk} from '@pump-fun/pump-swap-sdk';
const clients=new WeakMap();
// The SDK builds an Anchor Program/IDL graph; reuse one per RPC connection, not per pool read.
export function pumpAmmClient(rpc){let client=clients.get(rpc);if(!client){client=new OnlinePumpAmmSdk(rpc);clients.set(rpc,client);}return client;}
