// Shared policy for scanning, risk, exits and the auditor. No prompt can override these at runtime.
// coarseCooldownMs is retained for post-close/exhausted-order risk limits only, never scanner gates.
export const TRADE_RULES = Object.freeze({initialSol:1.19,reserveSol:0.05,orderSol:0.2,smallOrderSol:0.2,coarseCooldownMs:1800000,maxPositions:null,stopLossPct:20,takeProfitTriggerPct:80,takeProfitRecoveryPct:40,runnerMultiple:2,takeProfitSellFraction:.78,maxHoldMs:21600000,reentryMs:86400000,maxRetries:3,networkFailureLimit:3,maxPriorityAndTipSol:.002,runnerTrailingPct:30,timeStopMs:2700000,timeStopGainPct:20,lossStreakLimit:null,lossPauseMs:0,runnerSellFraction:0.5,dustUsd:0.25,minRunnerFraction:0.000001,maxDrawdownPct:15,maxDailyLossSol:null,slippageBps:150,buySlippageCapBps:400,sellSlippageCapBps:300,emergencySlippageCapBps:1000,maxRoundTripCostPct:6,minLiquiditySol:20,feeSol:0.0001,minLiquidityUsd:0,minVolume24hUsd:0,minMarketCapUsd:3000,maxMarketCapUsd:5000000,maxPriceAgeMs:30000});
export const ENTRY_EXCLUDED_MINTS=Object.freeze(['6JVe4NQPab3NkKxE6vaKcEiJVsz8hpSZYvdHh54hpump']);
export const TREND_RULES=Object.freeze({h4MaxAgeMs:60000,h4RejectMemoryMs:14400000,minHistoryMs:900000,minRedDropPct:20,minPumpPct:50,minPeakRetreatPct:35,minUpperWickFraction:.55,maxCloseLocation:.35});
export const STRATEGY_VERSION='solana-six-stage-desk-v4';
export const SCREENER_RULES=Object.freeze({minMomentumPct:1,maxMomentumPct:12,minBuys:10,minBuySellRatio:1.3,minVolume5mUsd:1000,minAcceleration:1.2,maxHourGainPct:150,minSixHourChangePct:-30,maxDayGainPct:500,minScore:60});
export const AUDIT_RULES=Object.freeze({minClosedTrades:40,minWinRate:.33,minExpectancyR:.4,maxDrawdownPct:TRADE_RULES.maxDrawdownPct,stalePositionMs:72*3600000});
export const PROFIT_RECIPIENT='5uYdJyFmZkvZT5S3A7iq1kLx2aLwcMgVXMfxjdGf5qVZ';
export const PROFIT_RULES=Object.freeze({minTransferLamports:1000000,feeBufferLamports:10000,maxTransferLamports:300000000,reserveLamports:50000000});

// null means capital-limited entry: reserve, fees and account risk still apply.
export function positionLimitReached(count,settings=TRADE_RULES){return Number.isSafeInteger(settings.maxPositions)&&settings.maxPositions>0&&count>=settings.maxPositions;}

// Compare whole lamports so an exactly funded order never loses a lamport to float rounding.
export function canFundBuy(balanceSol,orderSol,reserveSol,overheadSol=.005){
 if(![balanceSol,orderSol,reserveSol,overheadSol].every(n=>Number.isFinite(n)&&n>=0))return false;
 const available=Math.floor(balanceSol*1e9+1e-6),required=[orderSol,reserveSol,overheadSol].reduce((sum,n)=>sum+Math.round(n*1e9),0);
 return Number.isSafeInteger(available)&&Number.isSafeInteger(required)&&available>=required;
}

export const BUY_LAMPORTS=String(Math.round(TRADE_RULES.orderSol*1e9));
// Old signed orders and historical purchases must still reconcile after a size change.
export const HISTORICAL_BUY_LAMPORTS=Object.freeze(['20000000','30000000',BUY_LAMPORTS]);

export function executionSlippageBps(side,reason=''){return side==='BUY'?TRADE_RULES.buySlippageCapBps:/^(stop-loss|emergency-|runner-trailing|drawdown-close)/.test(reason)?TRADE_RULES.emergencySlippageCapBps:TRADE_RULES.sellSlippageCapBps;}

export function validatePriorityBudget(priorityLamports,tipLamports=0){
 if(!Number.isSafeInteger(priorityLamports)||!Number.isSafeInteger(tipLamports)||priorityLamports<0||tipLamports<0||priorityLamports+tipLamports>TRADE_RULES.maxPriorityAndTipSol*1e9)throw Error('Priority fee + Jito tip vượt 0,002 SOL mỗi chiều.');
}

// Retired policy: remove only the old daily-loss latch, preserving every other stop.
export function clearLegacyDailyHalt(state){
 state.dailyLossBlocked=false;
 if(state.haltKind==='daily'){state.halted=null;state.haltKind=null;delete state.entryStatus;}
}

// Loss streaks remain accounting data; their old account-wide timer no longer blocks BUY.
export function clearLegacyLossPause(state){
 state.lossPauseUntil=0;
 if(state.entryStatus?.phase==='loss-pause')delete state.entryStatus;
}
