# Meme Pilot · PAPER WEEK / MEME-SCALP

Selected strategy: **paper-meme-scalp-entry-v1**, virtual SOL only, no AI/wallet/signing.
Initial default50 SOL, existing sessions and losses preserved. Separate PAPER branch:
`codex/paper-week`; no LIVE service or signer has been changed.

Implements the requested staged A→B→C→D→E scalp pipeline and configured exits.
Read [SCALP-SPEC.md](paper-week/SCALP-SPEC.md) for thresholds, missing-provider
contracts, logging, retry semantics and actual limitations. Original request:
[SCALP-REQUEST.txt](paper-week/SCALP-REQUEST.txt).

Latest implementation: **`scalp-risk-v4`**, simulationOnly=true. Update preserves
virtual cash, realized PnL, existing positions/exits, Helius and Telegram settings.
The checkpoint is `paper-week-state-before-scalp-risk-v4.json`.

1. Exact tracked unique-mint A/B/C/D/BUY sets persist by report day/hour, separate
   from scan counters. M5 low/high/missing reasons are separate. C stale/span has
   sample timestamps and measured read latency. Orders/positions/fills carry
   entryTier; old records are labelled legacy, never guessed into a new tier.
2. Optional JUPITER_API_KEY in private `paper-week.env` enables keyed quote API.
   No key is printed/committed. Bounded queue priority D>C>A (protective SELL first
   among D),4 active work units,1/2/4/8s backoff with±20% jitter and longer upstream
   Retry-After honored. C last age8s/span max75s. No transaction endpoint exists.
3. PumpSwap NO_POOL is negatively cached90s without suppressing valid curve
   candidates. Loss-locked mints leave discovery; held positions stay observable
   for exits. Invalid/missing loss-lock deadlines at/above the limit are repaired.
4. scalp-tiers.json is the supplied strict/relaxed/probe table. First A/B/C pass
   fixes the entry tier; sizeFactor1/.5/.25 multiplies soft-risk sizing. Strict and
   relaxed require local safety verification. Probe explicitly permits unknown
   evidence but rejects known-bad facts. This is not a safety certification.
   Stage D/exits and H1 dump/C step/C drawdown guards stay shared/protected.
   maxOpenPositions is the total-position entry gate for that tier:0/10/8.
   autoRelax enables configured fallbacks below100 entries in rolling24h; at the
   target only strict is admitted. It does not mutate the supplied thresholds or
   force trades. The target is not a promised number of orders.
5. One23:59 Vietnam Telegram TXT includes tier BUY/closed/win-rate/expectancy
   after fees, normalized returns and modeled exits below active stop. Partial
   exits are not extra wins. Funnel conversion uses unique mint intersections,
   not scan counts; tracking start/partial coverage and pre-v4 totals are explicit.

Fixed exits remain−10%, TP1+15% sell50%, moved stop+2%, trailing8%, TP2+30%,
3m stall watch/confirmed deterioration or6m stall exit, maxhold10m. Old open
positions keep stored exits. Roundtrip minimum-output cap4.5%, normal1.5% and
emergency3% slippage assumptions remain shared across tiers. Stops do not
promise an exit price. Results are descriptive PAPER observations, not live PnL.

Windows: Ctrl+C, download the pinned updater, run it, then START-PAPER-WEEK.cmd.
Keep `.paper-week` and private config/env files. No session reset is needed.
Optional private tier table: PAPER_SCALP_TIERS_CONFIG. GMGN remains optional.

Config: `paper-week/scalp-config.json`; env fields use SCALP_ + UPPER_SNAKE_CASE,
e.g. `SCALP_A_SWAP_LIQUIDITY_USD=8000`. Optional private JSON override path:
`PAPER_SCALP_CONFIG`. Existing entry size is capped by pool liquidity and V5.4
size factors. Exits for new positions:−10%, TP1+15% sell50%, moved stop+2%,
trailing8%, TP2+30%, stall watch3m, confirmed deterioration or6m stall exit/maxhold10m. Older positions retain stored exits.

```sh
npm ci --omit=dev --ignore-scripts
npm start
# http://127.0.0.1:3100
npm test
npm run check
node paper-week/analyze.js .paper-week > ket-qua-tuan.txt
```

Every admitted candidate is saved in compressed hourly JSONL on the PAPER data
directory/Volume. Hourly funnel, +1/+5/+15m sampled outcomes and23:59 Vietnam
Telegram TXT are distinct from on-chain execution. Missing data stay unverified.

To deliberately start a new50-SOL experiment: stop PAPER, archive `.paper-week`
under a new name, set `$env:PAPER_WEEK_INITIAL_SOL='50'` and run the CMD. Old
positions/reports stay in the archive and are not monitored by the new session.
