import {TEN_AGENTS} from './paper-ten-strategies.js';
export const INDEPENDENT_VERSION='paper-isolated-2sol-v1';
export const PAPER_TESTING_MODE=process.env.PAPER_TESTING_MODE!=='false';
export const FILL_MODEL=Object.freeze({initialSol:2,delayMs:2000,feeSol:.000025,rentSol:.00203928,normalHaircutBps:150,emergencyHaircutBps:1000,maxPriceAgeMs:1500});
const lane={
 nova:{peak30MaxDipPct:8},orin:{m5Min:0,m5Max:5,atOrBelowHigh15:true,minM1Pct:2},
 vela:{peak30MaxDipPct:8},kade:{m5Min:1.5,m5Max:5,belowHigh15:true,maxEachM1Pct:2},
 rune:{peak30MinDipPct:8,peak30MaxDipPct:15,includeMaxDip:true,allowSharpRed:true},
 zara:{minAgeMs:180000,maxAgeMs:1800000,minAgeExclusive:false},atlas:{maxLiquidityUsd:null},
 echo:{},nyx:{peak30MaxDipPct:8,allowSharpRed:true},sage:{minAgeMs:7200000,minAgeExclusive:false,h1Positive:true}
};
// Explicit research normalizers, not fitted parameters. Entry/exit gates are unchanged.
const mainSpecs={
 nova:{weights:{momentum:.5,lastBuys:.3,flow:.2},targets:{momentum:20,buyShare:.8,flowMargin:1}},
 orin:{weights:{volume:.5,gain:.3,flow:.2},targets:{volumeMultiple:6,gainPct:4,flowRatio:2}},
 vela:{weights:{volume:.6,breakout:.4},targets:{volumeMultiple:4,breakoutPct:3}},
 kade:{weights:{gain:.5,steady:.3,flow:.2},targets:{meanGainPct:1.5,flowRatio:2}},
 rune:{weights:{rise:.4,higherLow:.3,confirm:.3},targets:{risePct:30,higherLowPct:2,confirmPct:2}},
 zara:{weights:{momentum:.6,flow:.4},targets:{momentum:20,flowRatio:2}},
 atlas:{weights:{depth:.4,momentum:.3,flow:.3},targets:{liquidityUsd:100000,momentum:20,flowRatio:2}},
 echo:{weights:{wallets:.6,concentration:.2,smallBuys:.2},targets:{walletMargin:1.3}},
 nyx:{weights:{recovery:.6,momentum:.2,hour:.2},targets:{momentum:10,hour:20}},
 sage:{weights:{minute:.25,momentum:.25,flow:.5},targets:{minuteGainPct:.8,momentum:10,flowMargin:1.3}}
};
export const BOT_CONFIGS=Object.freeze(TEN_AGENTS.map(a=>Object.freeze({...a,version:INDEPENDENT_VERSION,paperTestingMode:PAPER_TESTING_MODE,
 lane:Object.freeze({minAgeMs:1800000,minAgeExclusive:true,maxAgeMs:null,maxLiquidityUsd:30000,allowSharpRed:false,...lane[a.id]}),
 scoreWeights:Object.freeze({main:60,persistence:25,liquidity:10,holders:5}),
 mainSpec:Object.freeze(mainSpecs[a.id]),
 riskPolicy:Object.freeze({...a.riskPolicy,independentWallet:true,initialSol:2,reserveSol:.1,overheadSol:.005,dailyLossHalt:false,lossStreakHalt:false,drawdownHalt:false}),
 exitPolicy:Object.freeze({...a.exitPolicy,agentPolicyVersion:INDEPENDENT_VERSION})
})));
export function breakEvenScenarios(config,size=.05){
 const h=1-FILL_MODEL.normalHaircutBps/10000,fee=2*FILL_MODEL.feeSol/size;
 const loss=1-(1-config.exitPolicy.stopLossPct/100)*h*h+fee;
 const scenarios=[config.exitPolicy.firstProfitPct,config.exitPolicy.finalProfitPct].map(gain=>{const netWin=(1+gain/100)*h*h-1-fee;return {grossGainPct:gain,netWinPct:netWin*100,netLossPct:loss*100,breakEvenWinRate:netWin>0?loss/(loss+netWin):null};});
 return {orderSol:size,scenarios,warning:scenarios.some(s=>s.breakEvenWinRate===null||s.breakEvenWinRate>.6),assumptions:'Static gross TP/SL scenarios, 1.5% each side and fixed fees; excludes unknown pool fees, gaps and mixed partial/trailing exits. Rent assumed returned.'};
}
// Retired bots remain in the schema so their historical books stay readable.
// Only these three may run or submit new decisions.
export const ACTIVE_BOT_IDS=Object.freeze(['kade']);
export const ACTIVE_BOT_CONFIGS=Object.freeze(ACTIVE_BOT_IDS.map(id=>Object.freeze({...BOT_CONFIGS.find(c=>c.id===id),name:'AI',role:'Autonomous portfolio decisions',rule:'AI tự chọn BUY/SELL/HOLD và phân bổ vốn'})));
