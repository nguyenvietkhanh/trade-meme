# Lean LIVE runtime

LIVE now defaults to lean mode. No new Railway variable is required. This reduces
optional work; it does not establish that prior crashes were OOM. Existing logs
showed no oom_kill in the sampled interval. Runtime memory/lifecycle diagnostics
remain so future exit causes can be identified.

Disabled by default in LIVE:
- Candidate-observer SQLite worker and its per-second snapshot tasks.
- Dataset worker, even if the older DATASET_ENABLED setting is true.
- Dormant research history, background swap-flow/candle reads and checkpoints.
- Replay/scan/evaluation research archive recording and compression loops.

At startup, lean mode deletes only recognized disposable observation files from
the fixed active/retired data roots: research journal gzip archives, dataset gzip
parts, candidate-observer candidates.sqlite sidecars, and dormant-state.json.
It does not follow symlink directories or remove configurable external paths.
Cleanup errors are counted and logged, not fatal. LEAN CLEANUP reports actual
file and byte counts; no freed-space claim is made before a real deployment run.
This deliberately discards observation history. Standalone Python scanner remains
available for collecting data separately.

Keep the Railway Volume mounted. It holds the durable wallet ledger, position
exit policies, pending signed orders, profit-transfer reconciliation, Telegram
configuration and wallets.txt. Removing it can lose essential recovery state.
Volume storage and process RAM are separate resources.

Trade authorization evidence remains enabled, bounded and fail-closed. Wallet
connection, Helius, risk rules, protective SELL and profit-recipient configuration
are unchanged. Mint safety cache now expires after ten minutes and caps at 512;
token decimals cap at 256; failed research evidence also caps at 128. Evicted safety
facts require fresh verification, never an assumed pass.

RPC responses are streamed with an 8 MiB cap (64 KiB for genesis checks), with
body consumption inside the concurrency lane. Oversized responses are cancelled
and remain errors/unverified; there is no truncated safety result or write retry.

Daily reports reject input above an 8 MiB aggregate budget instead of allocating
unbounded archive contents. Report failure is explicit; financial archives are
preserved, and can be exported/analyzed offline. Financial data is not pruned.

Owner status/health exposes resources.mode=lean and disabled collection statuses.
LIVE_RESEARCH_ENABLED=true explicitly opts back into the former research runtime
and disables lean cleanup. Leave it unset/false to keep this lower-load profile;
old DORMANT_ENABLED or DATASET_ENABLED alone cannot reactivate it.

Verification: npm run build, npm run check, npm test. Regression tests exercise
cleanup boundaries, symlink exclusion, disabled-buffer behavior under 10,000
observations, oversized reports and cache eviction with mocked read-only RPC.
These are local checks, not proof of production memory usage or uptime.
