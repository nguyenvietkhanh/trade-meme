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

## Start and stop

1. Keep `MODEL_API_KEY` and the existing `HELIUS_API_KEY` in Railway Variables.
   Model defaults remain `https://api.river.ai/v1` and
   `deepseek-ai/DeepSeek-V4.1-Flash`.
2. Mount persistent storage containing the existing encrypted owner vault
   (`<dataDir>/owner-signer.json`). On Railway, storage lives under
   `<RAILWAY_VOLUME_MOUNT_PATH>/meme-pilot`. An empty newly mounted Volume
   does not recover a vault lost with a previous container. Back up/copy the
   existing encrypted storage before moving it. No new private-key import
   endpoint is added by this release.
3. Connect the owner wallet on the dashboard and sign the authentication
   message. Open **Chi tiết ví**, then unlock the existing vault with its
   password. That enables autonomous real SOL orders for all three AIs.
   Do not put the password, private key or seed phrase in chat.
4. **Dừng BUY** disables new entries; existing positions can still be sold.
   **Khóa két** disables further signatures; previously submitted transactions
   may still confirm. Every process restart starts locked and requires unlock.

Live unlocking is refused on ephemeral Railway storage. Unlock also requires
configured model credentials and a successful mainnet balance reconciliation.
An unresolved legacy real order blocks unlocking until it is reconciled.
Wallet connection alone does not unlock the signer. Unlocking does not imply
any successful trade or profitable strategy.

## Receipts, recovery and accounting

`live/live-ledger.json` is the authoritative treasury journal, separate from
`paper20/`. A reservation is durable before signing. Signed bytes, signature
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

The existing Telegram configuration remains under `paper20/`; no new bot token
or chat ID is required. Summary and JSON attachment at **23:59 Asia/Ho_Chi_Minh**
contain three bot rows, actual network fees, on-chain fills and capital flows.
The deployment does not fabricate a test message or claim a Telegram delivery.

Mock tests cover independent child contexts, dynamic capital, concurrent
reservations, same-mint lot ownership, unknown submission/restart, no duplicate
broadcasts, wrong/failed receipts, rent, external flows, owner authentication,
CSRF rejection, immutable UI assets and report generation. The SDK simulation
also tests AI amounts above the old 0.6 SOL limit while preserving the reserve.
No mainnet transaction is broadcast by the tests. These are software checks,
not a measured trading edge, a backtest, or evidence of future returns.
