# Meme Pilot · PAPER WEEK / Momentum 5m

An isolated **virtual SOL** experiment. No wallet, key, signing, deposits,
withdrawals or LIVE deployment. This branch remains `codex/paper-week`.

## Current strategy: paper-momentum-5m-v2

- Observed **5-minute price change > 0%** on pump.fun before migration or
  PumpSwap after migration. Uses the source's reported change, not an AI score.
- Require three distinct fresh price observations spanning at least 10s, a
  local rise of at least 0.5%, no latest downtick, and at most 1.5% pullback.
- One entry per mint per momentum cycle, persisted across restarts. A closed
  mint must show a fresh non-positive 5m change before a new positive cycle.
- Before BUY, quote the exact simulated minimum token output back to SOL.
  Reject missing reverse routes, >3% impact per leg, or >12% conservative
  minimum-output roundtrip loss including two assumed network fees. These are
  unvalidated research defaults, not thresholds fitted to the losses.
- Exactly **1 virtual SOL** principal per position, plus assumed fees/rent.
- Fixed stop at **−30% of initial entry price** on the remaining quantity.
- Sell **50% at 2x, 20% at 3x, 20% at 5x, final remainder at 10x**.
  Fractions refer to initial token quantity, not the remaining quantity.
- Scan continuously, including overnight and after losses. No cooldown,
  time-of-day filter, 4-position limit, holder/social/dev/curve-range gate.
- Virtual cash is finite. No simultaneous duplicate mint positions and no
  smaller-than-1-SOL fallback when cash is insufficient.
- Missing/negative 5m changes, stale data, unsupported venues or unavailable
  quotes do not invent an entry. Quotes remain read-only and fills delayed ≥2s.
- Seven-day entry window, then continue monitoring remaining positions.
- Telegram summary + training TXT at **23:59 Asia/Ho_Chi_Minh**.

Fresh public observations and RPC reserves are required. This change removes
research blockers; it cannot guarantee a route or a profitable/realistic fill.
A −30% stop is an observed-price trigger, not a guaranteed maximum realized loss.
SDK curve math still requires genuine reserves and will not buy through migration.

## Windows

Run `START-PAPER-WEEK.cmd`. Existing `paper-week.env` supplies Helius/Telegram;
**no new environment variable is required**. Fresh sessions default to 20 virtual
SOL; an existing ledger's balance always takes precedence over initial settings.

Stop with Ctrl+C before updating. `UPDATE-PAPER-WEEK.ps1` downloads the known
runtime files, checks their SHA256 and JavaScript syntax, backs up old code,
and preserves `.paper-week`, `paper-week.env`, balances and Telegram settings.
Do not delete the ledger to update. Legacy positions retain their stored exits.
A pre-v2 ledger checkpoint is saved once as `.paper-week/paper-week-state-before-v2.json`.
Existing losses are never erased or refunded. With less than 1 SOL plus overhead,
no new 1-SOL entry is possible until virtual capital becomes available.
The strategy change is written to training data; new fills carry strategyVersion.

```sh
npm ci --omit=dev --ignore-scripts
npm start
# http://127.0.0.1:3100
npm test
npm run check
node paper-week/analyze.js .paper-week > ket-qua-tuan.txt
```

Detailed setup: [HUONG-DAN-PAPER-WEEK.txt](HUONG-DAN-PAPER-WEEK.txt).
Do not select this branch on the existing LIVE Railway service.

## V2 correctness fixes

PumpSwap V2 marks now include virtual quote reserves on the pool quote side,
matching SDK pricing in both mint orientations. Missing these reserves could
produce false stop triggers. It is not proven that this explains all prior losses.
BUY quote and candidate-price reads run as bounded background jobs; only the
ledger application is serialized. Stops can preempt a pending entry, and late
cancelled quote results cannot create fills. Stop and TP fills log their trigger
price, observation time and decision-to-quote delay.

Cash reconciliation must satisfy initial + realized PnL = cash + remaining
entry cost basis + locked rent. Broken ledgers pause fills for inspection.
Tests verify mechanics and accounting, not profitability. No profitable backtest
or forward result is claimed for V2.
