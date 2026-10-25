# Native Solana Perps transition — not live derivatives execution

The user changed the target from Solflare's Chrome extension to native Solana
perpetuals. The selected integration direction is **Drift directly**, using its
official SDK and the existing Solana owner signer/RPC. Ranger remains an option,
but its official examples require a separate API key and its route-by-route
protection semantics are not yet verified. Mobula positions are read-only.

Official sources read during this work:

- [Drift SDK](https://github.com/drift-labs/protocol-v2/tree/master/sdk)
- [Ranger SDK examples](https://github.com/ranger-finance/sor-ts-demo)
- [Solflare SDK](https://github.com/solflare-wallet/solflare-sdk)

No assumption is made that a Solana message signature grants a different venue's
trading permission. The Solflare extension route is retained only as historical
context in [the earlier migration note](solflare-perps-migration.md).

## Implemented independently of network verification

Docker selects `TRADING_PRODUCT=solana-perps`. New meme BUY intents and unsigned
buy authorization are blocked in the parent. Resume cannot silently return to
meme trading. Legacy positions, signed receipts, manual-wallet reconciliation,
authorized SELL/HOLD and AI-selected stops are preserved; no forced liquidation,
collateral bridge or new derivatives order is generated.

The UI and API explicitly show that Perps execution is not enabled. Existing SOL
balances and spot PnL are labeled as the legacy book, not USDC margin or Perps PnL.

`perps-intents.js` defines the new AI decision contract: LONG/SHORT/HOLD/CLOSE,
AI-selected margin and leverage, risk acceptance and mandatory SL. Account and
market metadata must be verified/fresh; venue leverage limits cannot be inferred
from a screenshot. Quote validation binds side/size/leverage, checks protection
before liquidation and preserves 0.05 SOL gas. Validated intents/quotes never
claim fills or authorize signing by themselves. This contract is not yet wired
to a live venue adapter.

## Remaining verification before live orders

The isolated SDK inspection targets `@drift-labs/sdk` version 2.163.0-beta.13 from
the npm registry. The isolated install failed with ENOSPC (development filesystem full); only
newly generated npm cache was cleared to restore working space. It is not
installed or validated as the production executor. Official
source includes instruction builders, native SOL collateral wrapping and
reduce-only trigger orders; current mainnet accounts, precision, subscriptions,
account authority, margin limits and atomic entry/SL behavior still require
verification against the actual selected account and deployed protocol.

The development network currently blocks the necessary venue/RPC destinations.
A draft preserves prior domains and adds api.mainnet-beta.solana.com,
docs.drift.trade, data.api.drift.trade, dlob.drift.trade and
velocity-exchange.github.io. Review/Save and Publish apply it. Existing River,
Helius and owner key variables are not moved into prompts or requested in chat.

After access is available: connect read-only first, map SOL/BTC/ETH instruments
and collateral, obtain real oracle/candle/funding/account data, build exact-size
orders plus exchange-resident reduce-only SL, simulate, persist signatures before
broadcast, reconcile partial fills and cancels, and verify actual Telegram fills.
Do not use a model-generated transaction or the SDK's automatic send helper to
bypass the durable journal. No leverage order is currently being represented as
successfully placed.

## Review of the supplied LightGBM/CCXT script

The upload fetches Binance USD-M BTC/USDT hourly OHLCV, not Solana venue data or an
execution account. Its feature/triple-barrier organization is useful research,
but the implementation is not a production trading algorithm:

1. ATR is used for labels but the backtest does not execute the corresponding
   TP/SL; the `atr`/`entry` parameters are unused there.
2. Label-end indexes refer to original rows while training/test indexes refer to
   the feature table after warm-up rows were removed. Purging therefore uses
   inconsistent coordinates (typically extra exclusion), invalidating the claimed
   exact boundary semantics.
3. Tail labels with less than the full future horizon are kept; unresolved and
   both-barrier-hit cases are mixed into FLAT. Those cases need explicit handling.
4. Return accrual is performed before decisions using that bar's prediction;
   entry/exit timing is inconsistent. Define next-open execution and costs first.
5. Fixed fees/slippage omit venue funding/borrowing, margin, liquidation, order
   precision, partial fills and the difference between mark/oracle/execution.
6. 0.55 is an uncalibrated threshold; the code does not establish a profitable
   live edge. Walk-forward models are not automatically an online trained AI.

No uploaded script was executed against a funded account. Leverage and real
trading readiness cannot be inferred from its printed Sharpe or return.
