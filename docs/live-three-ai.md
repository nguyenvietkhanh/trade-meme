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

## Connect and sign — no application password

Production uses `WalletFleet` and `WalletTreasury`. No wallet private key or seed
is imported, and the existing encrypted wallet vault is not loaded or decrypted.
AI controls proposals; custody remains with the connected owner wallet.

1. Keep `MODEL_API_KEY` and `HELIUS_API_KEY` in Railway Variables. Mount persistent
   storage for the real intent/receipt journal. A Railway container without a
   Volume cannot safely retain pending real orders across a restart, so it is
   refused before trading is enabled. This does not require a wallet vault.
2. Click **Kết nối ví** in Phantom/Solflare and sign the owner-authentication
   message. The dashboard connects the authenticated owner session to the AI
   fleet. This message is not a transfer and does not grant spending authority.
3. Each AI independently chooses BUY/SELL/HOLD and its amount. A proposed trade
   becomes an exact unsigned SDK transaction, with reserved funds and slippage
   limits. **Chi tiết ví → Ký lệnh AI** calls the wallet's `signTransaction`.
   The server verifies the owner signature and exact prepared message before
   sending. No automatic `signAndSendTransaction` bypass is used.
4. **Dừng BUY** disables new buys but keeps monitoring positions. **Ngắt kết nối
   giao dịch** cancels unsigned proposals and stops new execution. Already signed
   and submitted transactions may still confirm. Reconnect after a restart;
   no application password is requested.

Each fill and every protective exit requires the owner's actual wallet signature.
If the owner is absent, an automatic stop cannot sell the position; unsigned
quotes expire and the bot must reassess. BUY proposals expire after 30 seconds;
SELL proposals have a 90-second preparation limit and also require a valid
blockhash. Human approval adds unknown latency to the 2-second minimum simulation
pipeline delay. This setup is not unattended trading based on connection alone.

The compatibility URL `/api/paper/pause` and the live `/api/live/pause` both require
owner authentication, same origin and a boolean `paused`. Missing input cannot
implicitly resume. Missing wallet connection is HTTP 409 with an actionable
`LIVE_WALLET_NOT_CONNECTED` code. Rate limiting returns HTTP 429 and `Retry-After`,
rather than an invalid-password HTTP 400. Old password-based live signing routes
are removed (HTTP 410); wallet signing routes remain authenticated.

## Receipts, recovery and accounting

`live/live-ledger.json` is the authoritative treasury journal, separate from
`paper20/`. A reservation and unsigned message are durable before requesting the wallet signature. Signed bytes, signature
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
broadcasts, wrong/failed receipts, rent, external flows, owner authentication, exact-message wallet signatures, cancellation/expiry, password-free Telegram reopening, typed control errors,
CSRF rejection, immutable UI assets and report generation. The SDK simulation
also tests AI amounts above the old 0.6 SOL limit while preserving the reserve.
No mainnet transaction is broadcast by the tests. These are software checks,
not a measured trading edge, a backtest, or evidence of future returns.
