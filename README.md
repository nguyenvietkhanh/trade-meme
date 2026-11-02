# Meme Pilot · PAPER WEEK / MEME-SCALP

Selected strategy: **paper-meme-scalp-entry-v1**, virtual SOL only, no AI/wallet/signing.
Initial default50 SOL, existing sessions and losses preserved. Separate PAPER branch:
`codex/paper-week`; no LIVE service or signer has been changed.

Implements the requested staged A→B→C→D→E scalp pipeline and configured exits.
Read [SCALP-SPEC.md](paper-week/SCALP-SPEC.md) for thresholds, missing-provider
contracts, logging, retry semantics and actual limitations. Original request:
[SCALP-REQUEST.txt](paper-week/SCALP-REQUEST.txt).

**PAPER policy update:** no position-count cap (`maxPositions=0`) and no external
rug-source requirement (`rugRequired=false`). Rug status remains unverified;
it is not a safety certification. On-chain program/authority/holder checks and
cash/50% exposure checks remain active. GMGN remains optional and unconfigured.

Windows: Ctrl+C before updates; run the pinned `UPDATE-PAPER-WEEK.ps1`, then
`START-PAPER-WEEK.cmd`. Keep `paper-week.env`, `.paper-week`, Helius/Telegram settings
and the separate Railway PAPER Volume. No session reset is required for an update.

Latest PAPER implementation revision: **`scalp-risk-v3`**. Existing virtual cash,
PnL, trades and stored exits are preserved. Upgrade checkpoints the ledger to
`paper-week-state-before-scalp-risk-v3.json`. No reset is required.

- After2 consecutive closed losses on one mint, block that mint for24h. Partial
  exits use final position PnL, not the last SELL leg. Historical retained closes
  seed the lock on upgrade, and restarting does not clear it. Other mints remain
  eligible. Held/reentry/loss-lock checks run before RPC/quote work.
- SELL errors persist bounded exponential retry per position, including across
  order replacement/restart. HTTP429 or provider backoff pauses quotes until the
  provider retry deadline. BUY waits while SELL recovery is active. A missing
  route on one position yields to other eligible exits. No retry invents a fill.
- Entry minimum-output roundtrip cap is4.5% (was6%). High-friction valid quotes
  get bounded smaller-size attempts with a new reverse proof each time; drift,
  unknown evidence and stale quotes are never accepted by resizing. Normal1.5%
  and emergency3% slippage assumptions are unchanged.
- For NEW positions,3m starts a stall watch below+5%. Exit if price deteriorates
  >=1.5% from that watch after at least60s, or remains below+5% at6m. Fixed−10%,
  TP1+15% sell50%, moved stop+2%, trailing8%, TP2+30%, maxhold10m remain. Existing
  open positions keep their saved exits. No stop guarantees a maximum loss.
- The single daily TXT compacts repeated holder/raw-window evidence and emits
  each fill id once. Numeric decision metrics and counted candidate scans remain;
  complete raw detail stays in local hourly gzip.24MiB cap and explicit omission
  coverage remain. At23:59 Vietnam Telegram receives one consolidated TXT.
- Auto-relax and evaluation minimums count closes from THIS revision; previous
  revision results do not qualify the new rules. This is a new paper experiment,
  not a profitable backtest or authorization to trade real funds.

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
