# Read-only pump.fun scanner

Independent Python process. It never imports the trading bot, connects an account,
uses an account secret, constructs a transaction, or provides execution functions.
Only `solders.pubkey.Pubkey` is used for public PDA/address arithmetic. Telegram
messages are alerts, not orders. No model or paid provider is added.

```powershell
cd tools/pumpfun-scanner
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
# Copy env.example to scanner.env; fill existing Helius key locally.
# Copy wallets.example.txt to wallets.txt and configure the address list.
python scanner.py --env scanner.env --wallets wallets.txt --once
python scanner.py --env scanner.env --wallets wallets.txt
```

Keep `scanner.env` private. It accepts only the five variables shown in the example;
OS variables override file values. Do not point it at a trading-account file.
Helius/RPC and Telegram settings are independent of the application runtime; the
scanner is not started automatically in the Railway Node container.

The public pump.fun list is polled every ten seconds (after backoff when unavailable).
Every valid mint in the received feed gets a CSV observation, including deferred
items. This is not a claim to observe every launch on Solana. One background worker
performs at most two new token evaluations per poll by default, one RPC request per
second, queue limit 64, cache limit 4096. Configure `--max-per-cycle 1..5`. HTTP 429
pauses reads; no quote API is used. Request URLs/errors with credentials are not printed.

Confirmed RPC checks cover mint/curve ownership, public PDA, supply and full
owner-aggregated holder balances excluding the curve. The curve parser checks
known account discriminators and SOL quote layout. New/unsupported layouts remain
unverified. Social age/followers and full early trade history are not derivable from
holder RPC. Without a configured evidence service those checks stay UNVERIFIED and
there are no passing alerts. No guessed social metadata is used.

`PROJECT_RESEARCH_URL`, if configured by the owner, must be HTTPS and supply the
same mint/pool, a millisecond `checkedAt` within 60 seconds, explicit `coverage` and
verified data. See `docs/PROJECT-RULES-V6.md` in the repository for the contract.
An owner-configured service is a trust boundary; the scanner does not independently
certify a service's claim of complete coverage.

Filters: top10 **<22%**, dev **<4%**, no dev sale in first 15 minutes, at most three
distinct creation-block buyers with SOL sizes and complete coverage, curve 15–75%,
no top10 address in wallets.txt, and reject socials only when age <72 hours AND
followers <200. Missing coverage yields WATCH, never SETUP VALID. These token
filters do not approve account risk or authorize trading. The live application's
schedule/risk/cooldown are enforced separately.

Daily `tokens-YYYY-MM-DD-NNNN.csv` files go in `scanner-data` or `--output`.
Files rotate around 4 MiB; total retention defaults to 32 MiB / 3 days. Change with
`--max-mib` and `--days`. Cleanup touches only that directory's scanner CSV files,
not any ledger. Storage failure drops observer records with a warning. Pending
worker tasks are not durable; the feed can be reread after restart and existing
CSV remains. Hourly UTC counters distinguish actual failures and missing evidence.

The bounded creator history is restored from retained CSV, counts observed mints
per creator, and flags repeat creators. It is not an exhaustive creator index.
Graduation requires observed confirmed curve completion. `died_within_1h` means an
observed spot decline >=90% from the first observed price within the reported first
hour; it is not proof a token is permanently dead or that an exit was executable.
Missing follow-up observations remain unknown, not deaths. Retention reduces history.

## Offline replay and reports

```powershell
python scanner.py --backtest scanner-data --analysis-output replay.json
python scanner.py --trades trades.csv --analysis-output weekly.json
python scanner.py --report autopsy --input token.json
python scanner.py --report borderline --input token.json
python scanner.py --report dev-trace --input token.json
python scanner.py --report curve --input token.json
python scanner.py --report zone --input token.json
python scanner.py --report fake-check --input token.json
python scanner.py --report narrative --input token.json
python scanner.py --report exit --input position.json
python scanner.py --report tilt --input journal.json
python scanner.py --report rule-audit --input journal.json
```

Replay uses the first passing alert's curve zone and only recorded, verified
outcomes. It does not create hypothetical fills or PnL. Missing labels are printed
as unverified. Weekly CSV expects one final row per position (`position_id`,
`closed=true`, `net_pnl_sol` after all costs, `risk_sol`, and optional `hour`,
`curve_zone`, `narrative_age`, `mood`, `broken_rules`). Partial rows do not inflate
win rate. Unknown R/mood/outcomes remain null/unverified. Analysis is written as
JSON while the raw scanner CSV is ready for external analysis. With insufficient
counterfactual data no rule addition/removal or market-versus-trader attribution
is invented. Supplied evidence reports do not pretend to have browsed Solscan,
understood a narrative with AI, or verified official endorsements.
