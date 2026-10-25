import {paperOrderSol} from './paper-sizing.js';
export function decisionOrderSol(state,now=Date.now()){
 if(state.mode!=='live')return paperOrderSol(state);
 if(!Number.isFinite(state.liveBookAt)||now<state.liveBookAt||now-state.liveBookAt>5000||!Number.isFinite(state.liveSpendableSol)||state.liveSpendableSol<.0025)return 0;
 return Math.floor(state.liveSpendableSol*1e9)/1e9;
}
