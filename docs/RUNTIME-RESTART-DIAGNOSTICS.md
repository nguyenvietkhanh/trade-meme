# Restart diagnostics

The supplied 2026-10-29 logs contain 13 funnel reports and 11 distinct
`sessionStartedAt` values between 11:24 and 11:59 UTC. This demonstrates
repeated initialization, not its cause. The user reports Railway CRASHED.
The supplied files do not include the process exit code, terminating signal,
fatal exception or a Railway termination reason. OOM cannot be ruled out
between samples or in an earlier container.

This patch corrects Docker's fixed-port health probe to honor `PORT` and gives
it a four-second request timeout. Railway's separately configured health path
remains `/api/health`. The Docker defect is not proven to explain Railway exits.

Before application initialization, `src/server.js` installs a diagnostic monitor.
It emits `RUNTIME LIFECYCLE` records for boot, fatal exceptions, shutdown requests
and exit. It does not catch/suppress fatal exceptions, install signal handlers,
automatically retry orders or change trading policy.

The same records are appended to `runtime-lifecycle.jsonl` in the storage root:
`$RAILWAY_VOLUME_MOUNT_PATH/meme-pilot`, otherwise `$DATA_DIR`, otherwise `.data`.
Rotation retains two files, each at most 128 KiB under this single-server writer.
There are no new variables or dependencies. Write failures fall back to console
without stopping the application. Keys, environment dumps, wallet addresses,
error messages and raw stacks/transactions are not added to these records.

At startup `previous` identifies the last lifecycle event in the retained file.
An earlier boot without an exit means no exit was recorded; it is not proof of
SIGKILL or OOM. SIGKILL/native abort can bypass JavaScript handlers. Node's native
fatal-error output and Railway exit/signal/termination details are still needed
to establish those causes. Forced shutdown, storage failures and missing log
delivery can also leave incomplete evidence.

`fatal` records retain error name/code, origin and source file line locations.
`shutdown_requested` distinguishes an observed SIGTERM/SIGINT from an unexpected
exit. Deployment/build IDs help separate deployments. Cgroup counters and process
memory are sampled at lifecycle events. No continuously running loop is added.

Financial ledger, positions, signer, risk limits, equity freshness checks,
Token-2022 acceptance policy and profit recipient are unchanged. A restart still
requires the existing reconciliation and admission checks; this patch does not
prove a reported crash has been eliminated.
