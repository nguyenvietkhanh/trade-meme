// Shared policy for scanning, risk, exits and the auditor. No prompt can override these at runtime.
// coarseCooldownMs is retained for post-close/exhausted-order risk limits only, never scanner gates.
export const TRADE_RULES = Object.freeze({initialSol:0.3,reserveSol:0.05,orderSol:0.03,smallOrderSol:.02,coarseCooldownMs:1800000,maxPositions:2,stopLossPct:20,takeProfitTriggerPct:80,takeProfitRecoveryPct:40,runnerMultiple:2,takeProfitSellFraction:.78,maxHoldMs:21600000,reentryMs:86400000,maxRetries:3,networkFailureLimit:3,maxPriorityAndTipSol:.002,runnerTrailingPct:30,timeStopMs:2700000,timeStopGainPct:20,lossStreakLimit:3,lossPauseMs:7200000,runnerSellFraction:0.5,dustUsd:0.25,minRunnerFraction:0.000001,maxDrawdownPct:15,maxDailyLossSol:0.03,slippageBps:150,buySlippageCapBps:400,sellSlippageCapBps:300,emergencySlippageCapBps:1000,maxRoundTripCostPct:6,minLiquiditySol:20,feeSol:0.0001,minLiquidityUsd:0,minVolume24hUsd:0,minPairAgeMs:900000,maxPairAgeMs:86400000,minMarketCapUsd:10000,maxMarketCapUsd:5000000,maxPriceAgeMs:30000});
export const STRATEGY_VERSION='solana-six-stage-desk-v4';
export const SCREENER_RULES=Object.freeze({minMomentumPct:1,maxMomentumPct:12,minBuys:10,minBuySellRatio:1.3,minVolume5mUsd:1000,minAcceleration:1.2,maxHourGainPct:150,minSixHourChangePct:-30,maxDayGainPct:500,minScore:60});
export const AUDIT_RULES=Object.freeze({minClosedTrades:40,minWinRate:.33,minExpectancyR:.4,maxDrawdownPct:TRADE_RULES.maxDrawdownPct,stalePositionMs:72*3600000});
export const PROFIT_RECIPIENT='5uYdJyFmZkvZT5S3A7iq1kLx2aLwcMgVXMfxjdGf5qVZ';
export const PROFIT_RULES=Object.freeze({minTransferLamports:1000000,feeBufferLamports:10000,maxTransferLamports:300000000,reserveLamports:50000000});

export function executionSlippageBps(side,reason=''){return side==='BUY'?TRADE_RULES.buySlippageCapBps:/^(stop-loss|emergency-|runner-trailing|drawdown-close)/.test(reason)?TRADE_RULES.emergencySlippageCapBps:TRADE_RULES.sellSlippageCapBps;}

export function validatePriorityBudget(priorityLamports,tipLamports=0){
 if(!Number.isSafeInteger(priorityLamports)||!Number.isSafeInteger(tipLamports)||priorityLamports<0||tipLamports<0||priorityLamports+tipLamports>TRADE_RULES.maxPriorityAndTipSol*1e9)throw Error('Priority fee + Jito tip vượt 0,002 SOL mỗi chiều.');
}
