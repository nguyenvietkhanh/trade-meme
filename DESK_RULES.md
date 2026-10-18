# Six-stage Solana desk v4

Runtime constants: `src/desk-rules.js`. Analyst JSON: `strategy.js` / `decision.js`. Execution is separate and cannot be authorized by text inside market data or an attached prompt.

## Discovery and fast gates

Target price-scan cadence is five seconds, subject to API latency. Sources: GeckoTerminal Solana new-pool listing filtered to PumpSwap, DexScreener PumpSwap/pump/Solana search and recent Solana profiles. Discovery refreshes in the background every 30 seconds after bootstrap. Cached discovery supplies mint identities only; fresh batched token prices and SOL price have four-second deadlines. Never timestamp cached search prices as new observations. A persisted discovery queue remembers up to 600 mints, retaining young pools until the 15-minute minimum and rotating up to 30 revisits per price scan. Qualifying coarse candidates are prioritized before the 60-market limit; tracked holdings remain included. This is best-effort HTTP discovery, **not a complete on-chain migration-event stream** or a guarantee that every queued mint updates every five seconds.

Stage 0: PumpSwap only; age 15 minutes–24 hours; market cap $10k–$5m. Missing cap may use FDV only when the mint ends exactly `pump`, labeled `pump-fdv`. Re-evaluate current gates each five-second scan; no scanner exclusion cooldown. Ignore/remove persisted legacy 30-minute coarse cooldowns. Recognized major-token names/symbols are conservatively excluded from this low-cap universe; observed suspicious mints persist in a blacklist across renames/restarts. This is a name blacklist, not proof of all possible impersonation.

Every 10,000 candidate evaluations, clear recent scanner decisions and reset the displayed cycle's evaluated/rejected counters, then immediately continue. Repeated evaluations of the same mint count separately. Preserve lifetime evaluation count, cycle number, BUY count, positions, confirmed fills, signed pending orders, stop-loss/re-entry limits, account risk, blacklist, verification evidence and signal observations. Never reset the owner ledger to restart discovery. HTTP loops do not overlap; slow APIs can exceed the target five-second cadence. Failed verification requests become retryable after five seconds; successful mutable evidence refreshes after 20 seconds and still expires for BUY at 30 seconds. Diagnostics include fixed provider labels/HTTP statuses, never arbitrary provider URLs or credentials.

Stage 1: **actual quote reserve >=20 SOL**, not total USD liquidity converted into SOL. Total USD liquidity/cap >=3%; >=8 M5 buys, >=15 M5 trades, >=80 H1 trades; H1 change <=150%, M5 change >=-8%. Counts must be consistent across windows; known negative or inconsistent volumes fail. Missing optional volume is unknown. Abnormal average ticket volume and buy/sell >4 reduce points rather than automatically rejecting a token.

Missing DexScreener quote reserve does not prevent scheduling safety verification. BUY still requires either a reported reserve or a fresh, mint/pool-bound actual on-chain WSOL vault reserve >=20 SOL. A known low/invalid Dex reserve remains a veto. Diagnostics preserve all red flags but display the earliest blocking stage, rather than presenting unrequested safety checks as failures on already-excluded pools. Owner execution readiness is private and separate from public scanner activity.

## Mandatory safety

Evidence must bind mint/pool and be <=30 seconds old, never future-dated. Irreversible revoked mint/freeze facts are cached in memory indefinitely; mutable supply and holder data are always re-read. Classic SPL and plain/passive-metadata Token-2022 are supported. Transfer fee, transfer hook, permanent delegate and other unrecognized Token-2022 mint extensions are rejected.

LP burn/lock >=90% from the matched RugCheck pool. Explicit locked/burned percentages are not summed where overlap is unknown; use the greater independently verified percentage. No recognized critical RugCheck risks. Missing report or unclear LP protection blocks entry.

RPC reads a full mint-filtered account distribution, aggregates by token-account owner, excludes verified pool vault/pool-owner and derived bonding-curve owner, and checks the total against fresh on-chain mint supply. The redundant largest-accounts request is removed; the full distribution includes every largest account. Unsupported/index-excluded read RPC errors try the second genesis-verified endpoint. If neither can provide the complete distribution, BUY stays blocked with an explicit holder-RPC reason. Top ten <=35%, largest owner <=8%. A truncated distribution cannot pass. Creator identity is taken from the mint-bound report, not assumed from a pool fee recipient. Known creator >5% rejects; unknown creator limits entry to 0.02 SOL. These checks identify on-chain owners, not hidden beneficial ownership.

Jupiter quote round trip: exactly 0.03 SOL buys quoted tokens, then quote-sell **all quoted output**. Include a 0.00005 SOL network-fee allowance; loss <=6%, impact <=2% each direction, mint/amount/route/context slot must match. This is a quote check, not a claim that a round-trip simulation or trade occurred.

Safety work runs in at most two background jobs, is cached briefly and does not block the fast price/observation loop. Only rough-qualified candidates and tracked holdings receive expensive checks. Provider errors leave facts unknown and block BUY.

## Score and entry

Weights total 100: momentum 25, flow 20, structure 20, depth 15, distribution 10, age 5, website/social 5. Each missing **optional score component** receives exactly half its maximum. Missing mandatory safety never becomes safe because of points.

Momentum rewards >=1.5x M5 volume acceleration versus the previous H1 five-minute average and mildly positive M5 price. Flow prefers M5 buy/sell 1.15–2.5. Structure uses actual completed contiguous 1-minute OHLCV, rising local pivot lows, 10–30% pullback from the 30-minute high and a green completed candle. Candle requests are bound to the pool's base mint; insufficient/mismatched bars remain unknown. Prefer age 30 minutes–6 hours. Website/social is optional; paid boosts deduct five points.

Two observations separated by 10–15 seconds must retain price/liquidity, and intervening dumping observations reset confirmation. Minimum score 60; scores 60–74 use 0.02 SOL, >=75 use 0.03 SOL, with unknown creator always capped at 0.02. At most two positions, no mixing preexisting wallet assets. Keep >=0.05 SOL native after estimated order overhead; a wallet below reserve cannot BUY. Budget remains <=0.3 SOL.

Immediately before entry the bot obtains a fresh Jupiter quote for the **actual tier amount**. The locally built PumpSwap transaction must meet that output reference within the 4% ceiling, as well as its own stricter normal slippage. It does not fetch/sign a Jupiter swap transaction and uses no Jupiter API key. Facts/market age are rechecked before signing. Native outflow, received token quantity, actual paid fees and returned rent are accounted from confirmed receipts; price-per-token uses nominal swap input and confirmed output, not refunded rent as token performance.

## Exits and account protection

Net-SOL stop -20% uses a fresh full-position Jupiter sell quote minus fees. If Jupiter is unavailable, a simulated PumpSwap sell quote can protect existing positions; its source is labeled. A quote is an estimate, **not an actual fill**. No-route results trigger emergency exit attempts; a network outage is not relabeled as a honeypot. Slippage or lack of liquidity can prevent a stop from filling at the threshold.

At +80% sell a fixed 78%, approximately 140% recovery at exactly that trigger. Moonbag halves at entry-price powers 2x/4x/8x/... . A gap executes one observed half-sale and advances to the next unpassed power, without fabricated historical fills. Peak trailing is 30%, tightening to 25% after reaching 4x entry, 20% after reaching 8x. Initial time-stop: 45 minutes without ever observing +20%. Sell all at six hours. Exit on M5 volume <30% of entry volume while price <entry. Emergency: liquidity falls >40% from observed post-entry peak, verified LP withdrawal, large-holder dump, or sell quote failure.

A confirmed stop-loss locks that mint for 24 hours. Normal closes rest 30 minutes. Partial sells do not count as separate losing positions. Three closed positions with total realized P/L after costs <0 pause BUY for two hours.

Daily equity loss >=0.03 SOL blocks BUY until 00:00 UTC, exits continue. Drawdown >=15% initiates sequential liquidation of all app positions, then stops for manual review/re-enable. Never mark positions closed until confirmed. If a sell cannot execute within the retry budget, the position remains reported open and needs owner action. Restart pauses/locks; explicitly enabling an interrupted liquidation only resumes exits, not BUY. Review cannot clear drawdown with positions/pending remaining, cannot erase daily limits, and never automatically starts signing.

BUY data >30 seconds old or repeated API/RPC failures blocks new entries. SELL uses fresh on-chain preparation and tracked pool/raw quantities even if discovery is stale/offline; full RPC outage still makes execution impossible. BUY-only pause is separate from full pause/kill-and-lock. A pause during reads or preparation must prevent a new BUY signature. Already signed/uncertain transactions are still reconciled.

## Execution, retries and rent

Slippage caps: buy 4%, ordinary sell 3%, emergency/stop/drawdown/trailing 10%; ordinary pool execution remains stricter at 1.5%. Round-trip overhead >8% must never enter; the latest quote/SDK rule is **stricter at 6%**. Priority fee + Jito tip <=0.002 SOL per side. Current builder uses 0.000015 SOL priority and zero Jito tip, with a stricter 0.000025 SOL total network fee guard. This is not a Jito bundle integration.

At most three application retries after the initial attempt, tracked durably per side/mint/amount. No fresh attempt while a signed outcome is unknown; confirmed failed/expired attempts must reconcile first. RPC send retries are disabled so another layer cannot multiply attempts. Exhausted orders are skipped, not silently re-signed; explicit manual enable can reset attempts. Signed bytes/signature are fsynced **before broadcast**.

A full sale may atomically close its now-empty app-position token ATA back to the same owner. A partial sale or an account with extra tokens/another close authority is not closed. Simulation permits only that explicitly authorized input-account closure. Refunds count only when the native receipt is confirmed. Unrelated empty wallet accounts are not swept.

Sole owner remains `7JePGU7MFtRo9z5jMh2486UniD4EB4PpRd8tv2Jhqpsy`. The unlocked encrypted-vault signer controls the whole wallet; software limits are not an on-chain spending delegation. Profit recipient remains fixed `5uYdJyFmZkvZT5S3A7iq1kLx2aLwcMgVXMfxjdGf5qVZ`, confirmed realized/recovered profit only, protecting principal/reserve and transfer fees. One replica, preserve journals and signed pending entries.

## Verification limits and UI

Tests use generated fixture keys, mocked RPC/quotes and real SDK instruction decoding, not user funds. Direct Jupiter requests returned HTTP 403 from this cloud even after an escalated retry. Successful live API/RPC access, complete discovery, real fills, profitability and Railway deployment status are not established by passing fixtures. Provider failures keep mandatory gates closed. No key/seed/password belongs in chat, logs, Git or browser storage.

The spider UI crawls to the real active token/position/control and stays there until new activity. It handles confirmed fills, pending reconciliation and generic controls separately, does not fabricate fills, respects viewport/reduced-motion, and never calls trading APIs.
