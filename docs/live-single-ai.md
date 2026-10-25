# Autonomous live AI

This version runs one AI inference worker. `kade` is its internal compatibility
ID; the trading UI calls it AI. NYX/SAGE no longer start. Existing holdings are
assigned to AI after any pending historical signature settles; lot IDs, raw units
and cost basis do not change. Historical fills keep their original attribution.

Radar retains up to 100 discovered PumpSwap tokens independent of the AI entry
shortlist and displays up to 25 gainers. It does not disappear when no BUY is
approved. There is no minimum or maximum market-cap threshold. Positive M5
candidates are prioritized by gain, then volume; AI decides whether the momentum
and risk justify entry. Market cap/FDV remain observations, not approval gates.
The parent supplies immutable on-chain mint facts through one batched read,
caches valid irreversible facts and labels unavailable/rejected facts explicitly.
Holder concentration, LP lock and RugCheck are unknown unless actually supplied;
no third-party safety certificate is inferred.
Each BUY requires a structured AI risk acceptance with reason, risks and unknowns,
as well as its AI-selected SL. The acceptance and the parent-supplied evidence
are saved with the order/fill; BUY Telegram messages show SL, risk reason and
unknowns. This is risk judgment, not a safety guarantee.
Up to 60 fresh candidates
are supplied by default (`MODEL_MAX_CANDIDATES`); missing M1/flow fields remain null
and do not invoke legacy BUY gates. The model is the sole entry/discretionary
exit decision maker. Token program checks, quotes and transaction simulation
remain execution constraints. No API key or signer secret is sent to inference.

## Capital and stops

- Native SOL is read from the wallet before order execution. Deposits need no
  allocation setting. One buy may use at most 90% of that observed balance.
- The stricter spendable limit subtracts 0.05 SOL gas, a 0.005 SOL execution/rent
  buffer, in-flight reservations and earned profit reserved for transfer.
- BUY requires an AI-selected `stop_loss_pct`, `0 < value < 100`. The choice is
  recorded with the signed order and confirmed holding. HOLD with a held mint
  and `stop_loss_pct` updates that stop through the parent ledger, without a swap.
- Fresh spot observations trigger a full exit at the chosen loss percentage of
  remaining cost basis. Monitoring does not wait for inference or old strategy
  SL/TP/time rules. The order still needs a valid quote, simulation, network and
  liquidity: an SL is a trigger, not a guaranteed maximum realized loss.

## Profit withdrawal

The fixed recipient is `5uYdJyFmZkvZT5S3A7iq1kLx2aLwcMgVXMfxjdGf5qVZ`.
The first load records the existing cumulative realized-PnL baseline; historical
profits are not paid retroactively. New realized net PnL is reduced by intervening
losses, already-paid principal and transfer fees. Appreciation of open positions,
rent refunds and deposits do not create profit entitlement. A 0.00001 SOL fee
buffer is retained; smaller residual amounts accumulate.

Transfers are a separate native-SOL transaction after confirmed receipts. The
parent validates the single system-transfer instruction and exact recipient,
signs, and saves its bytes/signature before broadcasting. An uncertain RPC result
remains pending. It is reconciled by signature after restart; no new payout is
created until confirmed, failed with a known fee, or expired with no receipt.
Profit transfers cannot reduce the gas/execution buffers. Total wallet PnL adds
back withdrawn profits, so a withdrawal is not shown as a trading loss or deposit.

## Notifications and operation

Confirmed BUY/SELL receipts enqueue Telegram messages in the financial ledger's
same durable update. Profit transfers also enqueue confirmations. Live delivery
retries without a six-attempt cutoff and only marks `sent` after Telegram returns
`message_id`; a network timeout can still cause a duplicate Telegram message.
Financial execution is not retried because notification delivery failed.

## Manual wallet actions

The parent reconciles tracked SPL/Token-2022 quantities against complete confirmed
RPC snapshots (at or after the last receipt slot) every five seconds. Failed RPC
responses never imply a zero balance. In-flight app orders and profit transfers
settle before external reconciliation. Unsubmitted SELL intents are cleared when
the holding disappears or their quantity exceeds the current holding. Signed
intents keep their original reconciliation path and are never simply discarded.

For a single unambiguous manual PumpSwap sale with the owner's signature, exact
token outflow to the swap accounts and native SOL proceeds, the receipt updates
quantity, basis, actual PnL and notifications once, marked `external-wallet`.
This also handles partial sales while preserving the AI-selected stop.

If a transfer/burn/complex route or missing transaction evidence cannot establish
sale proceeds, two consistent confirmed snapshots update inventory at remaining
basis instead. An `EXTERNAL` audit event and Telegram notice explicitly state
that PnL is unknown. No zero-price sale, win/loss or profit payout is invented.
The total-wallet PnL stays unknown when such unresolved events exist, and records
remain on disk for later analysis. AI can continue managing other positions.

The live destination is `1766285817` exactly, with no invented `-100` prefix.
Reuse the token from `TELEGRAM_BOT_TOKEN`, the encrypted Volume config or the
legacy signer-encrypted config. If none can be opened, the UI explicitly reports
that the bot token must be configured; a chat ID does not authorize Telegram.
The existing authenticated configuration/test controls remain available.
The 23:59 Asia/Ho_Chi_Minh report remains enabled.

There is one main connection/resume button. Connection authenticates the owner,
checks the AI API and enables the existing automatic signer. Afterwards the main
button reads “Tiếp tục BUY”. No individual transaction signature or app password
is required. Once authorized, execution continues without an open browser;
durable connection authorization restores it after restart. Disconnect clears
that authorization. A BUY pause is retained across restart, while SELL monitoring
continues when signing is enabled.

AI inference defaults to every 5 seconds (`MODEL_POLL_MS`), with no timed daily
halt, loss-streak halt or profit cooldown. Provider rate limits, pending signatures
and credit/API errors are observable waits, not a rules fallback. Existing signed
orders continue reconciliation during API failures.

## Validation

Use `npm run check`, `npm run build`, `npm run test:offline`, and the live/paper
HTTP tests. Focused tests in `single-ai.test.js` and `automatic-profit.test.js`
cover AI-only stops, multiple positions, capital limits, durable alerts,
portfolio takeover, fixed recipient, gas protection and ambiguous-send recovery.
Tests use generated fixture keys and mocked RPC/Telegram; they spend no real SOL
and do not prove production API/Telegram delivery or a profitable model.
