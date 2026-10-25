# Isolated paper fleet v1

This release implements the approved phase-1 plan. Ten deterministic rule engines
run in separate Node child processes. They are not LLM agents or trained models.
Independent wallets do not prove independent returns or positive expectancy.

## Capital and migration

- `DATA_DIR/paper20/state/<bot>.json`: own checked state, pending intent, raw
  position quantities, cooldowns, deterministic PRNG/IDs, metrics and outbox.
- Each bot initially receives 2 SOL. Size is the existing 2.5% accounting formula
  applied to its own book, initially 0.05 SOL; reserve 0.1 + overhead 0.005 per bot.
- One new position per bot. No cross-bot allocation, global wallet mutex, token
  claims, `chosen`, or `agentCursor` in the active fleet path. Existing legacy
  positions retain pinned exits and are managed separately by their owner bot.
- `migration-intent.json` and `ledger-before-isolation.json` retain the migration
  source. Cash, remaining costs, rent and cumulative attributed PnL must reconcile.
  Existing losses are not reset. Partial migrations finish before any worker runs.
- If history is incomplete, a wallet would be negative, an open position has no
  owner, or checksums fail, BUY/worker startup is blocked with `migrationError`.
  The old ledger is preserved. Do not delete state files to bypass this condition.
- After the first manifest exists, missing/corrupt bot state never reissues funds.
  Stop the service and restore a known consistent backup; do not combine ledger
  files from different sessions. To roll back code, restore the matching complete
  pre-migration data backup as a separate paper session; old code cannot read the
  new independently evolving wallets.

## Strategy and data

Base signal/exit thresholds remain pinned to `TEN_AGENTS` from `33fa99d`.
Additional lanes live in `paper-bot-config.js`; scoring is main signal 60,
two-observation persistence 25, liquidity/observed-holder quality 15. Unknown
holders receive no fabricated holder-quality points. Quote cost is a separate
≤6% gate. Score percentiles appear after 200 evaluations, including repeats.

Universe refresh targets 5s; near-qualified watchlist and open pool reserves
target 1s, subject to provider budgets. M1 closed bars and confirmed wallet events
come from actual providers; they are never synthesized from screener counts.
Feature acquisition bootstraps all strategies before applying the 70% watchlist
threshold. A missing provider field remains WAIT. Source observation time is
retained; fetching/forwarding a cached value does not make it new market data.

Each bot uses its existing 3–10s cadence with persisted PRNG phase/jitter ±10%.
Loops await work and never overlap themselves. Shared providers can still affect
all bots' data freshness; deterministic independence is tested against identical
replay inputs, not claimed for arbitrary live API scheduling outcomes.

Exact-size/direction/freshness quote requests coalesce. Existing Jupiter pacing,
backoff and SELL priority remain. On quote failure, only verified supported SPL
PumpSwap pools with current reserves and official SDK fee metadata can use the
read-only AMM model. Token-2022 transfers are not assumed free. No reserves/fee
metadata means WAIT. Model fills are identified separately from Jupiter quotes.
Read-only capabilities cannot request swap bytes, sign or broadcast.

## Execution and risk

Fills require a fresh exact-size quote/model observation after the 2s delay.
Haircut 1.5% each side / emergency 10%; network allowance 0.000025 SOL each side;
rent 0.00203928 per simulated holding is returned only on full close. Rent is
refundable capital, not a recurring PnL fee. Own-wallet serialization and durable
intent/fill IDs prevent a restart from repeating a fill.

Exits use fresh position prices and pinned policies. A stop threshold never clamps
a later fill: gap losses can exceed SL. Log trigger and actual execution prices,
haircuts, delay, source and gapLoss. Unknown prices do not become zero losses.

Daily/streak/drawdown BUY halts remain disabled under the approved current risk
configuration. `PAPER_TESTING_MODE=true` is the default paper flag. Risk locks are
not silently re-enabled by deployment. Cooldown remains own-token 30 minutes.
Configuration reports show static after-cost TP/SL break-even scenarios; they do
not estimate the actual win probability of partial/trailing/gap strategies.

## Persistence and supervision

Wallet changes and decisions are written atomically (tmp/fsync/rename). Durable
outbox JSONL files live under `decisions/`, `fills/`, `errors/`, grouped by UTC
date and bot. A crash during append may replay an event; readers dedupe by ID.
Heartbeat-only changes are checkpointed periodically, wallet mutations immediately.
Coordinator state in `fleet.json` contains reporting/control, not trading balances.

The coordinator starts workers only after HTTP binds successfully. Missing
heartbeat >60s kills/restarts only that worker with backoff. Restart reads the
existing state, including open positions. Child environments contain no API keys,
Telegram token or signing keys. Railway `ALWAYS` restart supervises the parent.
SIGTERM drains worker writes. A Railway Volume is required for persistence across
container replacement; restart policy does not replace a Volume.

## Reporting and validation

Telegram wallet authentication/settings remain available. At 23:59 Vietnam, an
idempotent outbox queues per-bot PnL/win rate/expectancy/gapLoss/drawdown/uptime and
restarts, plus JSON with 45 pairwise Jaccards, entry offsets and hourly PnL
correlations. Undefined/sample-poor metrics remain null. Model/quote fills and
actual Jupiter HTTP429 counts are separated. Lifetime drawdown scope is labeled.

Commands:

```sh
npm ci
npm run check
npm run build
npm test
npm run test:offline     # explicitly excludes six localhost HTTP test files
npm run test:isolation
node scripts/paper-replay.js frames.jsonl > replay.json
node scripts/paper-replay.js frames.jsonl --reverse > replay-reverse.json
node scripts/paper-replay.js frames.jsonl --disable=nova > replay-without-nova.json
node scripts/paper-soak-report.js daily-report.json
```

Replay frames contain immutable `snapshot` and optional exact-request
`executions` results keyed `bot:mint:side:amount`; `replayAt` overrides the test
clock. Missing execution history causes an explicit error, never a fabricated
fill. Compare canonical decision bytes for the unaffected bots, excluding
wall-clock heartbeat/transport metadata.

The tests cover changing bot order/balance, disabled/failed bot, concurrent same
token BUYs, 429 fallback, actual 10-process watchdog/restart, migration corruption,
post-delay gap losses and report deduplication. SDK fixtures validate pool fees,
raw amounts and a 90% reserve shock. These are functional simulations, not a
historical profitability backtest. The 48h paper soak and ≥100 closes/bot require
real elapsed time; Jaccard ≤0.25 and HTTP429 <1% are measured targets, not promises
or trade-allocation gates. Do not interpret an empty report as passing acceptance.
