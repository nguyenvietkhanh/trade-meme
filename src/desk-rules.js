// Shared policy for scanning, risk, exits and the auditor. No prompt can override these at runtime.
export const TRADE_RULES = Object.freeze({initialSol:0.3,reserveSol:0.05,orderSol:0.03,maxPositions:2,stopLossPct:20,takeProfitTriggerPct:80,takeProfitRecoveryPct:40,runnerMultiple:2,runnerTrailingPct:30,timeStopMs:2700000,timeStopGainPct:20,lossStreakLimit:3,lossPauseMs:7200000,runnerSellFraction:0.5,dustUsd:0.25,minRunnerFraction:0.000001,maxDrawdownPct:15,maxDailyLossSol:0.03,slippageBps:150,buySlippageCapBps:400,sellSlippageCapBps:300,emergencySlippageCapBps:1000,maxRoundTripCostPct:8,minLiquiditySol:20,feeSol:0.0001,minLiquidityUsd:0,minVolume24hUsd:0,minPairAgeMs:900000,maxPairAgeMs:86400000,minMarketCapUsd:10000,maxMarketCapUsd:5000000,maxPriceAgeMs:90000});
export const STRATEGY_VERSION='solana-verified-momentum-v3';
export const SCREENER_RULES=Object.freeze({minMomentumPct:1,maxMomentumPct:12,minBuys:10,minBuySellRatio:1.3,minVolume5mUsd:1000,minAcceleration:1.2,maxHourGainPct:150,minSixHourChangePct:-30,maxDayGainPct:500,minScore:70});
export const AUDIT_RULES=Object.freeze({minClosedTrades:40,minWinRate:.33,minExpectancyR:.4,maxDrawdownPct:TRADE_RULES.maxDrawdownPct,stalePositionMs:72*3600000});
export const PROFIT_RECIPIENT='5uYdJyFmZkvZT5S3A7iq1kLx2aLwcMgVXMfxjdGf5qVZ';
export const PROFIT_RULES=Object.freeze({minTransferLamports:1000000,feeBufferLamports:10000,maxTransferLamports:300000000,reserveLamports:50000000});

export function executionSlippageBps(side,reason=''){return side==='BUY'?TRADE_RULES.buySlippageCapBps:/^(stop-loss|emergency-|runner-trailing)/.test(reason)?TRADE_RULES.emergencySlippageCapBps:TRADE_RULES.sellSlippageCapBps;}
