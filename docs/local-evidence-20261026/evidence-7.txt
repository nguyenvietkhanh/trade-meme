> ## Documentation Index
> Fetch the complete documentation index at: https://docs.polymarket.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Polymarket Protocol V2 SDK Migration

> Add Polymarket Protocol V2 markets to an existing pUSD trading integration using the Polymarket SDKs.

Update your integration to trade on Polymarket Protocol V2 markets while
keeping support for existing CTF markets.

Before you start:

* If you use a standalone CLOB SDK, complete the
  [unified SDK migration](https://docs.polymarket.com/migrate/clob-sdk-to-unified-sdk.md) first to update client setup.
* If upgrading from before 0.10.0 and using portfolio or history reads, also apply
  the [Data API v2 migration](https://docs.polymarket.com/migrate/data-api-v1-to-v2.md#sdk-migration-to-data-api-v2).

**1. Upgrade the SDK**

**TypeScript**

Upgrade `@polymarket/client` to the latest release (0.12.0 or later) using your preferred
package manager.

```bash npm theme={null}
npm install @polymarket/client@latest
```

```bash bun theme={null}
bun add @polymarket/client@latest
```

```bash pnpm theme={null}
pnpm add @polymarket/client@latest
```

```bash yarn theme={null}
yarn add @polymarket/client@latest
```

**Python**

Upgrade `polymarket-client` to the latest release (0.12.0 or later) using your preferred
package manager. Requires Python 3.11 or later.

```bash uv theme={null}
uv add --upgrade-package polymarket-client "polymarket-client>=0.12.0"
```

```bash pip theme={null}
python -m pip install --upgrade "polymarket-client>=0.12.0"
```

```bash poetry theme={null}
poetry add polymarket-client@latest
```

**2. Ensure Trading Approvals**

**TypeScript**

Keep calling `setupTradingApprovals()` on your `SecureClient`. It also
approves the contracts required for Polymarket Protocol V2.
Gasless wallets need a configured
[Relayer or Builder API key](https://docs.polymarket.com/trading/wallets-auth.md#set-up-trading-approvals).

```ts theme={null}
await client.setupTradingApprovals();
```

**Python**

Keep calling `setup_trading_approvals()` on your `AsyncSecureClient`.
It also approves the contracts required for Polymarket Protocol V2.
Gasless wallets need a configured
[Relayer or Builder API key](https://docs.polymarket.com/trading/wallets-auth.md#set-up-trading-approvals).

```python theme={null}
await client.setup_trading_approvals()
```

**3. Select the Trading ID**

**TypeScript**

Given a `market`, for example returned by `fetchMarket()`, check its
`version`: use the desired outcome's `positionId` for V2 or `tokenId`
for V1. This example selects YES:

```ts theme={null}
const outcome = market.outcomes.yes;
const assetId =
  market.version === ProtocolVersion.V2 ? outcome.positionId : outcome.tokenId;
```

**Python**

Given a `market`, for example returned by `get_market()`, check its
`version`: use the desired outcome's `position_id` for V2 or `token_id`
for V1. This example selects YES:

```python theme={null}
outcome = market.outcomes.yes
asset_id = outcome.position_id if market.version == ProtocolVersion.V2 else outcome.token_id
```

**4. Trade as Usual**

**TypeScript**

Use the selected `assetId`:

```ts theme={null}
import { OrderSide } from "@polymarket/client";

const response = await client.placeLimitOrder({
  assetId,
  side: OrderSide.BUY,
  price: "0.50",
  size: "10",
});
```

Use the selected ID for order books, prices, and market subscriptions too.

**Python**

Use the selected `asset_id`:

```python theme={null}
response = await client.place_limit_order(
    asset_id=asset_id,
    side="BUY",
    price="0.50",
    size="10",
)
```

Use the selected ID for order books, prices, and market subscriptions too.

## Verify the Migration

Verify BUY and SELL fills and balances on both a V2 market and a CTF market.

## Read Balances and Allowances

**TypeScript**

Read balances and allowances using the asset ID selected earlier:

```ts theme={null}
import { AssetType, ProtocolVersion } from "@polymarket/client";

const { balance, allowances } = await client.fetchBalanceAllowance({
  assetId,
  assetType: market.version === ProtocolVersion.V2
    ? AssetType.CONDITIONAL_V2
    : AssetType.CONDITIONAL,
});

console.log(balance, allowances);
```

Balances and allowances are returned in base units. Allowances are keyed
by spender address. To refresh before reading, use `updateBalanceAllowance`
with the same parameters.

**Python**

Read balances and allowances using the asset ID selected earlier:

```python theme={null}
from polymarket import ProtocolVersion

result = await client.get_balance_allowance(
    asset_id=asset_id,
    asset_type=(
        "CONDITIONAL-V2"
        if market.version == ProtocolVersion.V2
        else "CONDITIONAL"
    ),
)

print(result.balance, result.allowances)
```

Balances and allowances are returned in base units. Allowances are keyed
by spender address.

## Update Resolution Reads

If your integration tracks V2 market resolution:

**TypeScript**

Call `fetchResolutions` for the selected market:

```ts theme={null}
if (!market.conditionId) throw new Error("Missing condition ID");

const resolutions = await client.fetchResolutions({
  conditionIds: [market.conditionId],
});
```

Use payouts only from a row whose `status` is `"resolved"`.

**Python**

Call `get_resolutions` for the selected market:

```python theme={null}
if not market.condition_id:
    raise ValueError("Missing condition ID")

resolutions = await client.get_resolutions(condition_ids=[market.condition_id])
```

Use payouts only from a row whose `status` is `"resolved"`.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.