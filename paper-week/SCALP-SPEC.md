# MEME-SCALP ENTRY FILTER v1 — PAPER only

The selected runtime strategy is `paper-meme-scalp-entry-v1`. No AI, wallet,
signer or transaction submission. Existing open positions keep their recorded
exit policy; all new positions use this scalp policy. Existing 50-SOL ledgers,
realized PnL, fees and Telegram settings are preserved, not reset.

Every numeric strategy threshold is in `paper-week/scalp-config.json`.
Override a field using `SCALP_` + its camelCase name converted to upper snake
case, for example `SCALP_A_SWAP_LIQUIDITY_USD=8000`, `SCALP_D_LOSS_MAX=6`.
Alternatively `PAPER_SCALP_CONFIG` points to a private JSON override file.
The checked-in defaults remain safe to replace when updating; keep custom values
in env or the separate override file. No configuration value contains a wallet key.

## Discovery and stage order

Discovery updates every 5s, with bounded independent asynchronous source jobs.
An unavailable source is omitted; it cannot fabricate data or stop the exit loop.
Pump.fun: latest-traded, incomplete tokens, up to 50. Curve reserves are read
in a bounded batch; trade-history reads rotate in a bounded batch. Some raw
candidates have incomplete flow data and will fail A rather than fabricate it.
PumpSwap: profiles up to30 + GMGN official-adapter up to50 + boosts up to20,
deduplicated by mint, selecting the most liquid SOL-quoted PumpSwap pool. Missing
pool is NO_POOL. A rotating cohort admits at most100 candidates per scan.

A is synchronous and cannot call RPC or quotes. Swap defaults: liquidity>=8000,
age>=5m, M5 2–60%, >=12 transactions, >=6 buys, ratio>=1.15, volume5m>=1000,
H1>=−30%. Curve defaults: mcap>=5000, age>=3m, positive observed price changes
M1/M5, ratio>=1.15, >=10 transactions. H4 is logged unverified without a source.

B requires on-chain mint/program/extension/authority checks, complete owner-
aggregated holder distribution excluding pool/curve/configured burn owners,
top10<=30%, dev<=8%, holders>=20 (curve15), and verified non-danger rug evidence.
Safety cache10m per mint, invalidated on pool identity change. Unknown evidence
is B_UNVERIFIED; retry60s. Token-2022 metadata extensions only by default;
transfer-fee/delegate/nontransferable/unknown effects do not receive a safe PASS.

C uses actual reserve reads (including PumpSwap virtual reserves, with correct
mint orientation), not DexScreener prices: exactly3 selected samples, gaps>=5s,
span15–45s, last<=5s, rise1.5–12%, step>=−0.3%, last>=previous, peak pullback<=1%,
and last physical SOL liquidity>=90% of first. Reserve price cache TTL3s.
A bounded sample buffer permits selecting a valid three-sample window while a
quote is in flight; duplicate timestamps do not add observations.

D quotes exact-input BUY, then SELL of the exact minimum token output being
modeled. Impact<=2% each way; min-output roundtrip loss including two assumed
network fees<=6%; quote age<=3s at fill; expected execution-price drift<=2%;
TP1+15% must cover>=2.5x roundtrip loss. No-route quote errors try100%/50%/25%/min.
Successful but poor quotes are D_COST and are never downsized to hide that failure.
429/timeout/provider backoff are D_INFRA: initial attempt + at most3 retries at
1s/2s/4s. They are not quality-bad-token observations and do not consume a BUY signal.

E runs after D. Size=min(fixed paper size,1.5% physical pool SOL reserve), with
V5.4 configured loss-streak/drawdown/day-loss size factors (no timed pause).
It requires cash for principal+two assumed fees+rent, no held mint, unused signal,
30m same-mint cooldown, <=10 positions and <=50% verified current fund exposure.
The signal is consumed and persisted immediately before virtual BUY submission,
even if that submission later fails. The cooldown starts at attempted BUY and
is refreshed at the final SELL. Current insufficient/future-stale equity is not
silently treated as the initial bankroll. No real-money mode is added.

## New-position exits

Stop−10%; +15% sells50% of initial quantity. After confirmed TP1, stop moves to
entry+2% and trailing8% applies. +30% exits all. If return<5% after3m exit;
maxhold10m. Fresh quotes after>=2s; minimum-output simulation with1.5% normal
slippage,10% emergency. Fees .000025SOL/leg and rent .00203928SOL/token are
explicit assumptions. A stop is a trigger, not a guarantee of its realized price.
No MEV, auction/front-running, true on-chain execution or profit is claimed.

## Required providers: current blockers

**GMGN is NOT configured by default.** No undocumented endpoint, scraped route,
paid account or key has been invented. The optional `PAPER_SCALP_GMGN_URL` is an
HTTPS normalized adapter that the operator connects to the official authorized
GMGN API after checking its actual documentation. Its contract is:
`{provider:"gmgn-official-api",officialApiVerified:true,chain:"solana",timeframe:"1h",mints:[...]}`.
`PAPER_SCALP_GMGN_KEY` optionally authenticates to that explicitly configured adapter.
A raw GMGN API response will need a verified API-specific mapping, not a guessed
URL or field parser. With no adapter, profiles/boosts/curve discovery still run.

**Rug evidence is NOT configured by default.** `PAPER_SCALP_RISK_URL` is an HTTPS
RugCheck/equivalent normalized adapter, queried with `?mint=...`, returning:
`{mint,checkedAt,verified:true,danger:false,source:"verifiable public source"}`.
`PAPER_SCALP_RISK_KEY` optionally authenticates to this configured adapter only.
This service must actually verify its upstream result; JSON shape alone is not
proof of provenance. Missing/unverified/old/mismatched evidence never passes B.
On-chain safety is still checked locally; a risk-provider result cannot override
mint authority, freeze authority, program or excluded holder requirements.

Because the operator currently has neither service, **GMGN is skipped and
candidates reaching B stay B_UNVERIFIED; automatic BUY is blocked there**.
This is required by this SPEC, not an unexplained zero-order success claim.
The software is tested with explicit synthetic provider/quote fixtures.

## Durable research and tuning

Every admitted A candidate produces JSONL with timestamp, cycle/signal identity,
sources, reached stage, reason and measured A/B/C fields (missing values=null).
Async quote/portfolio resolutions add linked execution rows containing D/E metrics.
D_INFRA carries `quality_rejection:false`. AI context/output are null because no
model participates. Traded candidates include their entry features and quote.

All these rows are written as concatenated gzip members in hourly
`scalp-YYYY-MM-DD-HH.jsonl.gz` files inside the same `.paper-week` directory.
On Railway that directory is under the separate PAPER Volume. The UI exposes
downloads; standard gzip decompression produces the original JSONL. Batch writes
are fsynced before BUY admission. Quota512MiB, retention9days, with reserved log
space. When full, stop admitting new A/BUY candidates; continue protective exits.
Do not detach/remove the PAPER Volume. Code updates do not erase these files.

For B-and-later candidates and purchased tokens, bounded persistent forward jobs
record +1/+5/+15m returns and observed drawup/drawdown. Jobs are deduplicated by
mint/pool while a15m observation is active. Samples are explicit, not continuous
extrema; missing scheduled prices stay null/unverified. Overflow is reported,
not relabeled as complete coverage. Configurable queue capacity2048.

Hourly console+JSONL reports show funnel stage observations, execution reasons,
and separate infrastructure counts. These are observations/attempts, not unique
wallets or a profitable strategy backtest. Daily23:59 Vietnam Telegram TXT still
contains session configuration, PnL, fills and the compressed dataset file index.
`node paper-week/analyze.js .paper-week` streams compressed logs, deduplicates fill
IDs and keeps strategy versions separate; it does not infer executable skipped PnL.

The SPEC's low-trade relaxation and >=50-trade minimum are both enforced: no
automatic adjustment until >=50 closed trades from THIS strategy. Then evaluate
once per24h; if <5 entries, apply one ordered step: ratio/trades, C rise, liquidity,
top10. Impact, roundtrip cost, authority and program checks are never auto-relaxed.
Do not judge strategy effectiveness before>=300 scalp closed trades. 10–40 daily
signals is a target, not a throughput/profit guarantee, especially with B unconfigured.
