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

Config: `paper-week/scalp-config.json`; env fields use SCALP_ + UPPER_SNAKE_CASE,
e.g. `SCALP_A_SWAP_LIQUIDITY_USD=8000`. Optional private JSON override path:
`PAPER_SCALP_CONFIG`. Existing entry size is capped by pool liquidity and V5.4
size factors. Exits for new positions:−10%, TP1+15% sell50%, moved stop+2%,
trailing8%, TP2+30%, time stop3m/maxhold10m. Older positions retain stored exits.

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
