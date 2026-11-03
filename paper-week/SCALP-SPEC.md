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
top10<=30%, dev<=8%, holders>=20 (curve15). External rug evidence is no longer
required by the PAPER defaults (`rugRequired=false`); it remains unverified.
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
network fees<=4.5%; quote age<=3s at fill; expected execution-price drift<=2%;
TP1+15% must cover>=2.5x roundtrip loss. No-route quote errors try100%/50%/25%/min.
High-friction valid quotes can try the next smaller configured size, with a new
reverse proof and paced retry. Final failure is D_COST; drift or unverified proof
never receives a size-based bypass. D_RESIZE_PENDING is not a quality PASS.
429/timeout/provider backoff are D_INFRA: initial attempt + at most3 retries at
1s/2s/4s. They are not quality-bad-token observations and do not consume a BUY signal.

E is rechecked after D. Held/reentry/per-mint loss and exit-priority guards also
run after A, before expensive evidence/quotes. Size=min(fixed paper size,1.5% physical pool SOL reserve), with
V5.4 configured loss-streak/drawdown/day-loss size factors (no timed pause).
It requires cash for principal+two assumed fees+rent, no held mint, unused signal,
30m same-mint cooldown and <=50% verified current fund exposure. No position-count
cap by default (`maxPositions=0`); available cash and exposure still limit entries.
The signal is consumed and persisted immediately before virtual BUY submission,
even if that submission later fails. The cooldown starts at attempted BUY and
is refreshed at the final SELL. Current insufficient/future-stale equity is not
silently treated as the initial bankroll. No real-money mode is added.

## New-position exits

Stop−10%; +15% sells50% of initial quantity. After confirmed TP1, stop moves to
entry+2% and trailing8% applies. +30% exits all. Below+5% at3m starts a stall watch. Exit on >=1.5% deterioration from its
initial price after60s, or below+5% at6m;
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
proof of provenance. When `rugRequired=true`, missing/unverified/old/mismatched
rug evidence blocks B. When false, no external rug request is made and rug
coverage is false with null result; on-chain verification still runs.
On-chain safety is still checked locally; a risk-provider result cannot override
mint authority, freeze authority, program or excluded holder requirements.

Operator update: **GMGN is skipped; missing external rug evidence no longer
blocks PAPER BUY**. Other missing on-chain evidence still yields B_UNVERIFIED.
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
automatic adjustment until >=50 closed trades from THIS implementation revision. Then evaluate
once per24h; if <5 entries, apply one ordered step: ratio/trades, C rise, liquidity,
top10. Impact, roundtrip cost, authority and program checks are never auto-relaxed.
Do not judge strategy effectiveness before>=300 closed trades from the current revision. 10–40 daily
signals is a target, not a throughput/profit guarantee, especially with B unconfigured.

## BUY-relative return reference (buy-fill-v1 patch)

Every position locks its own immutable `entryAnchor` at the confirmed virtual
BUY fill: principal SOL / modeled tokens received. It is not a discovery price,
scanner price, historical high, market5m return, or average recalculated after TP.
Network fees and refundable rent are booked separately from this price anchor.

All stops, TP percentages, x multiples and post-TP moved stops use that anchor.
New positions initialize their peak at the BUY entry; cached marks observed before
BUY cannot trigger exits, portfolio marks or displayed position returns. Partial
SELL and restarts preserve the anchor; a later BUY has a new position identity
and a separate entry. Existing saved BUY entries are preserved, not re-priced.
Historical exits/PnL are not retroactively changed by this patch.

UI shows entry SOL/token and price return since this position BUY. The API field
`entryReferenceVersion` is `buy-fill-v1`. A price multiple is not net realized PnL;
fees, partial exits and executable sell quotes still determine realized results.
This does not change scalp TP1+15%, TP2+30% to momentum2x/3x. It also does not
invent rug evidence. Missing on-chain evidence still blocks entries.

Displayed multiples use four decimals without rounding up into a TP threshold:
1.995x is shown as1.9950x, not2.00x. Price-return percentages are truncated toward
zero to avoid suggesting a threshold crossing that has not actually occurred.

## Operator log fix: scalp-sampling-v2

The observed pending-BUY freshness race is fixed by sampling raw reserves every
2.5s (up to24 stored samples). C still selects three observations with >=5s gaps,
15–45s span and a <=5s last sample. A pending intent waits for a fresh reserve
read instead of cancelling at5.04s; it still expires at the configured order
timeout. Expired quotes are re-requested with bounded infrastructure backoff;
no stale observation or quote may create a BUY. Market/authority/holder checks
still apply. E position cap stays disabled and external rug remains optional.

When a PumpSwap pool lacks a usable coinCreator, read the mint-derived bonding
curve PDA with official pump program ownership/decoding checks. Only a verified
on-curve creator can reach holder checks; absent or wrong-owner accounts remain
DEV_IDENTITY_UNVERIFIED. Profile/website creator strings are never substituted.

Normal min-output quote slippage stays150bps. Emergency modeled min-output
slippage is300bps instead of1000bps. This remains a conservative modeling input,
not measured execution slippage; stop triggers do not guarantee a fixed maximum
loss in a gap or unavailable route. Existing ledger results are not rewritten.

A single TXT download covers the active reporting period. At23:59Vietnam one
TXT is queued with summary, original training records and streamed scalp audit.
Candidate observations are grouped by mint/pool/reason/5min: count, first/last
timestamps, first/last signal and latest metrics. Executions, fills and forward
observations stay separate. Internal hourly gzip logs remain for detailed replay;
missing retained logs and size-limit omissions must not be treated as zero events.
EXPORT COVERAGE states audit counts, reasons, explicit omissions and read errors.
Exports cap24MiB; candidates reserve2MiB for execution rows, no unbounded inflation.
The patch is not a profitability backtest; two observed closed positions do not
justify fitting new thresholds. Entry/exit thresholds otherwise remain unchanged.

## Risk revision: scalp-risk-v3

Per-mint loss limit2 uses CLOSED position PnL. A profitable total position is not
classified as a loss because its final partial SELL leg is negative.2 consecutive
losses lock only that mint for24h from the second close. Positive closes reset
the streak; partial closes do not. Retained closes seed locks on upgrade; the
persisted registry is bounded and unknown mints fail closed if it is full.
Available cash, exposure50%, token-program/authority/holders and quote freshness
checks remain. No position-count cap or mandatory external rug source is added.

SELL retry state lives on the position, not only the short-lived order. Non-rate
failures start at2s; rate-limit failures start at5s, doubling to60s, respecting a
longer provider retry deadline up to its600s ceiling. The PAPER adapter carries
its upstream retryAt into this scheduler.429/backoff cools all quote requests;
BUY is blocked during pending SELL recovery. Research forward reads yield to
SELL pressure. Other eligible exits may proceed when one route is unavailable.
Unverified quotes cause paced retry and never modify cash or positions.

New entries cap roundtrip minimum-output loss4.5%. A 1SOL maximum order may be
reduced through configured fractions100/50/25/min; each amount requires fresh
forward/reverse proof. Normal and emergency slippage assumptions are unchanged.
This tighter cap is experimental; it may reduce entries and is not proof of edge.

New entries store the confirmed stall policy: below+5% after3m starts watching,
not an immediate SELL. A >=1.5% fall from the watch price after60s, or continued
below+5% at6m, triggers the full time exit. Fixed stop/TP/trailing/maxhold still
apply first as coded. Old open positions retain the previous saved policy.

Upgrade preserves ledger/session and creates a checkpoint. algorithmRevision
is stored on positions/fills; old closes do not count toward v3 auto-relax or
its evaluation minimum. No historical PnL is rewritten or cash reset.

TXT emits one copy of each fill id across training/audit. Repeated execution
holder lists and raw sample windows are replaced by their numeric summaries;
raw detail remains in retained gzip. EXPORT COVERAGE adds duplicate suppression,
unique fill ids and omissions by type. Size caps still apply; this cannot recover
observations already omitted from an older uploaded TXT without its raw logs.

## V4 step 1: telemetry
Unique A/B/C/D and BUY mint sets persist separately from the ledger, by reporting
day and hourly interval. Repeated scans never inflate unique counts. If the
bounded registry overflows, exact=false is explicit. M5 low/high/missing have
separate codes. C stale/span includes sample timestamps, sample age and measured
refresh call latency. All new orders, positions and fills retain entryTier; old
records are legacy rather than retrospectively guessed.

## V4 step 2: quote infrastructure
PAPER uses an env-configured JUPITER_API_KEY on the quote-only API host; keyless
requests use the existing public quote route. The bounded shared queue admits
waiting D before C before A, protective SELL first among D. Active I/O is not
preempted. Sampling/held marks are C; safety/discovery/forward research are A.
There are at most4 active work units; queued reads are separately bounded.
Provider and engine delays use1/2/4/8s with jitter in[80%,120%], honoring longer
Retry-After deadlines. C freshness8s/span max75s do not relabel old prices fresh.
No swap/transaction endpoint or signer is added.

## V4 step 3: avoid repeated source work
NO_POOL is a bounded90s negative cache for PumpSwap lookups only. The first
failure is observable once; it cannot suppress a valid unmigrated curve route.
Loss-locked mints are removed before swap and curve discovery/RPC work. Existing
held positions remain observable for protective exits. A loss streak at/above
limit with a missing/invalid deadline is repaired immediately (including18);
a genuinely expired lock releases and resets its streak once.

## V4 step 4: supplied tier table
scalp-tiers.json contains the operator's strict/relaxed/probe table. Selection
runs A/B/C in that order and fixes the first passing tier on the order, position
and every fill. Size factors1/.5/.25 multiply the existing soft-risk factor
before the physical pool cap. maxOpenPositions is the total open-position gate
when entering that tier (strict0 unlimited, relaxed10, probe8).
Probe may admit UNKNOWN on-chain evidence only with an explicit unverified tag;
known token/authority/rug failures and known values beyond its limits still fail.
The supplied hardBlocks terminate fallback. Protected H1/step/drawdown thresholds
cannot change in the tier JSON. No tier may override D or any exit parameter.
At<100 entries in the rolling24h window, autoRelax enables the configured fallback
tiers; at/above the target only strict is admitted. This is a target, not an order
quota or profit guarantee. Fixed approved profiles do not require historical
closes to be tuned, and the old automatic mutation of global thresholds is removed.
PAPER_SCALP_TIERS_CONFIG may point to a private replacement table with the same
validated schema. Legacy positions keep saved exits and the legacy tier label.

## V4 step 5: 23:59 report
Daily tier rollups are saved atomically with the ledger trade/daily totals, so
500-trade cache limits or observer-log truncation cannot change the totals.
They count BUY entries and full closed positions; partial SELL legs never add a
win. Expectancy is full closed-position PnL after modeled fees divided by closed
positions. Fees are not subtracted twice. Normalized mean return is also shown
because tier sizes differ. Realized PnL by booking day is distinct from full
position PnL for positions closed that day, possibly spanning midnight.

Two stop metrics are explicit: minimum-output modeled exit unit price below the
active stop (including the moved post-TP stop), and full-position loss beyond the
original stop percentage of principal. Neither is measured real execution slip.
Pre-tracking aggregates stay separate; no tier is assigned retrospectively.

Funnel A→B→C→D→BUY uses intersections of unique mint sets within the same tracked
report period. Conversion cannot exceed100%; next-stage-only mints are counted
separately. Tracking start and coverageComplete flag expose mid-day deployments.
The report and current download include both machine-readable fields and a TXT
table. Schedule, one-document delivery and receipt idempotency are unchanged.
