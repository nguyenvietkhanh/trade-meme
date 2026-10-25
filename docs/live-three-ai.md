# KADE / NYX / SAGE — real SOL, shared wallet

Only `ACTIVE_BOT_IDS = ['kade', 'nyx', 'sage']` are launched. The seven retired
configurations remain readable for historical paper exports; no retired worker
can submit a live intent. Market data and provider rate limits remain shared.
Each active child process has its own model context, history, intents and lots.
There is no guarantee that different AIs will choose different tokens or trade
at all: HOLD is an explicit decision.

Production Docker sets `TRADING_MODE=live`. A local run without that setting
remains paper. An explicit Railway variable can override the Docker default.
In live mode, model decisions are required: no silent rule BUY fallback. The
configured River endpoint/model still require a valid `MODEL_API_KEY`; provider
availability and the exact model name must be verified by the first real API
response, not by the presence of a key alone.

## What AI controls

AI chooses BUY/SELL/HOLD, the candidate token, exact SOL amount for a BUY and
percentage of its own lot to SELL. KADE's research hint is M1 scalping, NYX's
is recovery, SAGE's is selectivity; old scoring gates are not BUY approvals.
One open position per bot remains the current operational limit. Model inputs
contain no signing keys, API keys, arbitrary tools or other bots' histories.

There is no virtual 20 SOL, allocated 2 SOL per bot, 2.5% sizing, or 0.6 SOL
fixed limit in live execution. The treasury reads the current mainnet wallet
balance and reserves pending orders centrally. It retains 0.1 SOL gas plus
0.005 SOL overhead and pending-order buffers. The model sees the latest
spendable balance; concurrent decisions may be rejected if funds changed.

Quote freshness, exact-size roundtrip cost ≤6%, impact ≤2%, normal buy/sell
slippage caps 4%/3%, emergency cap 10%, supported mint/extensions, official SDK
pool identity, simulated owner debits, and the existing stop/maximum holding
protections still apply. A stop does not guarantee its trigger price. Daily,
streak and drawdown BUY halts remain disabled as previously requested.

## Connect once, then autonomous execution

Production uses `AutomaticFleet`, `AutomaticTreasury` and a parent-only
`AutomaticSigner`. AI decisions are executed by this authorized server signer;
no per-order browser signature or app password is required. Historical
`WalletFleet` code is retained for regression tests, but its signing-request
endpoints are not enabled by the production server.

1. Keep `MODEL_API_KEY` and `HELIUS_API_KEY` in Railway Variables. Add
   **`LIVE_SIGNER_SECRET_KEY`** as a secret Variable for the configured owner
   wallet. Use a Base58 private key or a JSON array of 64 bytes, not a seed
   phrase. A wrong-wallet key is refused. Never send this key in chat, put it
   in model context, or commit it to the repository. This key grants the server
   transaction-signing authority; API keys for Helius/River do not replace it.
2. Keep the live journal on a Railway Volume. Owner authentication is a signed
   message, not a transfer or a way to extract a wallet private key. Immediately
   after authentication, a real chat-completions request checks the configured
   AI model. It contains no wallet balance, candidate token or signing secret;
   the only valid result is HOLD. No fabricated fill or trade is recorded.
3. Once the API check succeeds and signer/RPC/storage are ready, the three bots
   choose, sign and send orders without human order approval. The signer stays
   in the parent process. Workers receive only their own book and market data;
   neither the signing secret nor model API key is inherited in worker env.
4. **Dừng BUY** prevents new buys and keeps automatic SELL monitoring. **Ngắt kết
   nối giao dịch** disables signing and new execution; already submitted
   transactions can still confirm. Closing the browser does not stop an active
   server fleet. A process restart requires owner authentication again.

`/api/live/connect` reuses an in-flight or recent successful verification, so
login and connection do not duplicate the check. A new authenticated login
explicitly checks again. Backoff, timeout, request budget, response validation
and key redaction are shared with normal inference. `MODEL_HTTP_401`, 403, 404,
402, 429, network failures and invalid outputs remain explicit errors.
Authentication itself succeeds independently of provider readiness; a failed
API check cannot be misreported as a wallet password failure.

The compatibility `/api/paper/pause` and live `/api/live/pause` require owner
authentication, same origin and a boolean `paused`. Missing input cannot resume.
Rate limiting returns HTTP 429 with `Retry-After`. Missing or invalid server
signing credentials have their own status and messages, independently from AI
API verification. Browser wallet-order/sign/submit routes return HTTP 410.

## Receipts, recovery and accounting

`live/live-ledger.json` is the authoritative treasury journal, separate from
`paper20/`. A reservation is durable before the parent signs the SDK swap. Signed bytes, signature
and block expiry are durable before broadcast. A timeout keeps the same intent
and signature for reconciliation; it never creates a replacement trade.
On restart the parent restores pending orders and children cannot submit a
second intent over an unresolved one. Only confirmed receipts change lots/PnL.
The public dashboard never exposes signed transaction bytes or vault data.

Amounts sold are exact raw units from the submitting bot's lot. Shared token
accounts close only when all wallet units are sold and the app knows their
rent. Cost basis uses integer lamport allocation. Actual network fees and
actual rent changes come from receipts; paper haircuts and fictional fees do
not enter live fills. Failed transactions record their actual network fee.
Deposits/withdrawals become capital flows, not trading profit; balance
reconciliation waits for pending transactions before classifying a flow.

Open-position equity uses a fresh spot estimate and is not an executable exit
quote; it is null while receipts/balances/prices are unresolved. Per-bot
portfolio drawdown is null because the wallet is shared and has no fixed
per-bot capital denominator. Aggregate PnL excludes external capital flows.

## Telegram and verification

Telegram configuration remains under `paper20/`. Environment token/Chat ID credentials are reused. Dashboard configuration needs only Bot token + Chat ID, protected by owner message authentication; no password is requested. New configuration is encrypted with a separate server-managed random storage key and reopens on restart. Old password-encrypted credentials are preserved, but require the old configured server unlock secret to migrate automatically, or re-entry of token/Chat ID; no decryption is fabricated. Summary and JSON attachment at **23:59 Asia/Ho_Chi_Minh**
contain three bot rows, actual network fees, on-chain fills and capital flows.
The deployment does not fabricate a test message or claim a Telegram delivery.

Mock tests cover independent child contexts, dynamic capital, concurrent
reservations, same-mint lot ownership, unknown submission/restart, no duplicate
broadcasts, wrong/failed receipts, rent, external flows, owner authentication, parent-only signing, automatic broadcast/idempotency, API verification without any market data, wrong-owner key rejection, password-free Telegram reopening, typed control errors,
CSRF rejection, immutable UI assets and report generation. The SDK simulation
also tests AI amounts above the old 0.6 SOL limit while preserving the reserve.
No mainnet transaction is broadcast by the tests. These are software checks,
not a measured trading edge, a backtest, or evidence of future returns.

## Runtime variable diagnostics

Adding a Variable in Railway and the running container receiving it are distinct
steps: use Apply changes / Deploy to create a deployment with the updated values.
The signer checks the runtime environment again when connection/start is retried
after a missing/invalid startup value. It does not fetch Railway settings, expose
the secret, or replace an enabled signer underneath open orders.

`/api/health` includes `buildRevision` and safe signer metadata:
`runtimeVariablePresent`, `lastLoadHadValue`, `checkedAt`, `configured`, `format`,
and `error`. Missing-key connection responses include this same metadata. No key
value, prefix, seed, signature, or environment dump is included.

The parser accepts quoted/whitespace-normalized Base58, JSON keypair exports,
Base64 and hex. Every decoded key must derive the exact configured owner. A public
SOL address is diagnosed as `LIVE_SIGNER_PUBLIC_ADDRESS`, not treated as a private
key. A wrong-wallet private key remains rejected. Raw 32-byte private signing
seeds are supported by owner derivation; mnemonic seed phrases are not.
