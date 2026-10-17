# Verified momentum v3

Runtime constants: `src/desk-rules.js`. Decision functions: `src/strategy.js`, `src/decision.js`. Execution is separate: a JSON decision never directly signs or broadcasts. User-supplied reference prompts are strategy requirements, not runtime instructions to bypass policy.

## Mandatory entry checks

Only PumpSwap classic SPL/WSOL spot. Fresh positive price and SOL/USD; market cap (not FDV) $10k–$5m; pool age 15 minutes–24 hours inclusive. Liquidity >=20 SOL and >=5% cap. Consistent nonnegative interval volumes and integer transaction counts, positive H1 volume, >=100 H1 trades and >=10 M5 buys. Volume per trade >25% of pool liquidity with fewer than 20 M5 trades is rejected as suspicious. No duplicate mint or mixing existing wallet holdings.

Evidence must bind to the same mint and pool, be no older than 90 seconds and never future-dated. Mint and freeze revoked; LP >=90% secured; actual sell simulation for a 0.03 SOL-sized position succeeds, tax <=5%, impact <=3%; owner-aggregated top ten excluding pool <=30%; creator <=5%. Bundle/sniper analysis completed and concentration <=10%. Complete M5 buyer window with unique buyers >=25% of all M5 buy + sell transactions, no detected wash trading. Checked warnings with no critical alerts; known full round-trip cost <=8%. A roughly 1:1 aggregate alone is insufficient evidence of wash trading.

A missing value is unknown, never zero/false/safe. An empty risk list or perfect provider score cannot substitute for holder analysis or sell simulation.

## Score and additional confirmation

Weights reconcile the two reference prompts using the first scheme: momentum 30, holders 25, depth 20, real buying 15, no chasing 10. Paid boosts subtract 5 points. Buy only if all mandatory gates pass and score >=70.

Momentum requires actual candle higher lows, M5 +1–12%, volume acceleration >=1.2 against the preceding eleven five-minute equivalents in H1, positive H1 <=150%. Verified holder count must increase over a separate 30 second–15 minute observation. M5 buy/sell >=1.3 and <=8, H1 >1 and <=8. M15 gain 0–100%. A profile/social link is not a safety requirement or a score bonus. Existing two-scan confirmation 30 seconds–3 minutes remains required. DexScreener snapshots must not be relabeled as OHLC candles.

## Capital and exits

Budget <=0.3 SOL, entry 0.03 SOL, max 2 open positions, native reserve >=0.05 SOL. Restored legacy journals may contain up to five existing positions so they can still be managed, but no additional entry is allowed at >=2.

Net estimated stop -20% exits all; +80% recovers 140% of original USD cost net of estimated exit friction. This is about 77.78% at exactly +80%, adjusted to actual net quote rather than a fixed percentage. Moonbag halves on each actual doubling; trailing stop 30% below its highest observed price after recovery; dust closes. Initial position time stop at 45 minutes if observed gain has never reached +20%. Emergency exit if observed pool liquidity falls >40% from its post-entry high, or verified LP withdrawal, large-holder dump, or explicit failed sell simulation. Unknown simulation is not relabeled as honeypot. Execution can still fail in a drained/frozen market; no guaranteed exit price.

Daily equity loss >=0.03 SOL blocks new BUY until 00:00 UTC, preserving exits. Drawdown >=15% stops all automatic orders; pending signatures still reconcile. Sole owner can review the drawdown on fresh complete position prices and reset the peak; this does not clear daily loss or restart signing. Three closed losing positions pause BUY for two hours; partial sells do not count as individual losses. Losing streak uses aggregate realized position P/L.

Slippage ceilings buy 4%, normal sell 3%, stop/emergency/trailing sell 10%. Normal execution retains the stricter 1.5% setting; emergency uses 10% and allows up to 10% of reserves, regular reserve fraction remains <=2%. Before buy, SDK reverse quote includes a conservative 0.00005 SOL fee allowance and must recover >=92% of input. Actual network fee and simulation checks remain mandatory. Fixed recipient profit distribution, signed write-ahead journal, unknown-outcome reconciliation and sole-owner authentication remain in force.

## Data coverage and current limitation

DexScreener adapter reads available M5/H1/H6 trade counts and volumes, cap source and paid boost flag. RugCheck integration queries only the fixed report endpoint, checks mint/pool binding, uses explicit authority fields, matched-pool LP percentage and recognized critical warnings. Requests are bounded to six candidates/held pools, two concurrently, with two-second timeouts and 30-second cache. An outage never substitutes safety facts or blocks feed marks for all positions.

**The integrated sources do not yet supply the entire required evidence set.** In particular, owner-aggregated/excluded holder distribution, creator exposure, bundle completeness, unique buyer history, candle higher lows and pre-entry sell simulation are not fabricated from RugCheck report summaries or price samples. `VerificationFeed` intentionally leaves those fields unknown. With the current partial provider, a token cannot pass BUY. This is an explicit fail-closed implementation of the requested rules, not proof that the full live scanner is operational. Completing live coverage requires a validated on-chain/indexer and transaction-simulation data adapter; adding an API key by itself does not establish these facts. No Helius or Jupiter key/API integration has been reintroduced.

`analyzeDecision` emits `{action,token,sell_percent,score,reasons,red_flags}` for BUY/SKIP and position SELL/HOLD; at most three short reasons, all red flags. It never mutates the supplied position or executes. Account limits are enforced again in the owner ledger/execution path. The audit module continues reporting measured results, not invented backtests.

## Decorative UI

`public/spider.js` listens to confirmed trade and UI activity events only. The spider crawls to the actual active token card, position or decision region and remains at that destination until new activity. It uses transform animations, bounded queues, trade priority, viewport/scroll constraints, visibility cancellation and reduced-motion support. There is no web overlay or automatic return loop. Clicking controls means “processing action”, not “trade filled”. No wallet/trading API is called by the animation.
