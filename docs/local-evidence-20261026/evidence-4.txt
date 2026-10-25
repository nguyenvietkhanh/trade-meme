> ## Documentation Index
> Fetch the complete documentation index at: https://docs.polymarket.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Polymarket Protocol V2 API Migration

> Add Polymarket Protocol V2 trading to an existing direct API integration while retaining CTF market support.

Add V2 trading to an API integration already using pUSD and the
CTFExchangeV2 order format. Keep your CTF trading path and CLOB authentication.

## Migrate Trading

**1. Select the Trading ID**

Given a Gamma market, use its `version` to choose the desired outcome's
trading ID. For example, retrieve a market with:

```bash Fetch a Market theme={null}
curl "https://gamma-api.polymarket.com/markets/<MARKET_ID>"
```

Choose the ID field by `version`, even when both fields are present:

| `version` | Outcome IDs | Response Format |
| - | - | - |
| `"v2"` | `positionIds` | Array of decimal strings |
| `"v1"` | `clobTokenIds` | JSON-encoded array of decimal strings |

Decode `outcomes` from JSON text. Select the ID at the intended outcome's
index, decoding `clobTokenIds` first for V1.

Reject missing or unsupported versions, unmatched outcomes, and missing
or non-decimal IDs. Keep the selected ID as a decimal string, referred to
as `<ASSET_ID>` below.

**2. Approve V2 Trading**

V2 orders settle through ExchangeV3. Use the Polygon addresses for
ExchangeV3, pUSD, and PositionManager from [Contract Addresses](https://docs.polymarket.com/resources/contracts.md).
Grant these approvals from the maker (the EOA or smart wallet holding the
funds) and wait for confirmation:

| Action | Approval |
| - | - |
| BUY | On pUSD: `approve(EXCHANGE_V3, amount)`. Cover collateral spend, including fees. |
| SELL | On PositionManager: `setApprovalForAll(EXCHANGE_V3, true)`. |

Existing CTF permissions do not grant these approvals.

**3. Refresh Balances and Allowances**

After confirmation, refresh the CLOB cache with your existing CLOB L2
authentication and the maker's signature type:

```bash V2 Position theme={null}
curl -G "https://clob.polymarket.com/balance-allowance/update" \
  -H "POLY_ADDRESS: <SIGNER_ADDRESS>" \
  -H "POLY_SIGNATURE: <CLOB_L2_SIGNATURE>" \
  -H "POLY_TIMESTAMP: <CLOB_REQUEST_TIMESTAMP>" \
  -H "POLY_API_KEY: <CLOB_API_KEY>" \
  -H "POLY_PASSPHRASE: <CLOB_API_PASSPHRASE>" \
  --data-urlencode "asset_type=CONDITIONAL-V2" \
  --data-urlencode "token_id=<ASSET_ID>" \
  --data-urlencode "signature_type=<SIGNATURE_TYPE>"
```

```bash pUSD theme={null}
curl -G "https://clob.polymarket.com/balance-allowance/update" \
  -H "POLY_ADDRESS: <SIGNER_ADDRESS>" \
  -H "POLY_SIGNATURE: <CLOB_L2_SIGNATURE>" \
  -H "POLY_TIMESTAMP: <CLOB_REQUEST_TIMESTAMP>" \
  -H "POLY_API_KEY: <CLOB_API_KEY>" \
  -H "POLY_PASSPHRASE: <CLOB_API_PASSPHRASE>" \
  --data-urlencode "asset_type=COLLATERAL" \
  --data-urlencode "signature_type=<SIGNATURE_TYPE>"
```

Read `/balance-allowance` with the same parameters and a fresh L2 signature
for that path. Check its `allowances` entry for ExchangeV3.
`CONDITIONAL-V2` selects V2 positions; `COLLATERAL` selects pUSD.
Keep `CONDITIONAL` for CTF positions.

**4. Sign and Submit the V2 Order**

Replace the order's EIP-712 domain with this Polygon configuration:

```json V2 Order Domain theme={null}
{
  "name": "Polymarket CTF Exchange",
  "version": "3",
  "chainId": 137,
  "verifyingContract": "0xe3333700cA9d93003F00f0F71f8515005F6c00Aa"
}
```

Keep the CTFExchangeV2 signed order structure, set `order.tokenId` to the
V2 position ID, and re-sign. Submit through your existing order flow.
CTF orders retain their exchange and domain version `"2"`.

## Verify the Migration

Verify BUY and SELL fills and balances on both a V2 market and a CTF market.

## Track Resolution Through Gamma

If you monitor resolution through Gamma, read the V2 market response:

```json V2 Market Resolution theme={null}
{
  "version": "v2",
  "resolutionStatus": "resolved"
}
```

For V2, `resolutionStatus` is `inactive`, `active`, or `resolved`.
For V1, keep using `umaResolutionStatus`.

## Check Identifiers and Subscriptions

Fetch the order book using the asset ID selected earlier:

```bash Fetch the Order Book theme={null}
curl "https://clob.polymarket.com/book?token_id=<ASSET_ID>"
```

Use the same asset ID for prices, orders, and market subscriptions
(`assets_ids`). User-stream `markets` and market-wide cancellation use the
market's condition ID.

## Update Custom Fill Calculations

If you calculate fills yourself, use integer base units and the maker's signed
amounts for each maker fill:

```text Counter-Asset Amount theme={null}
counterAmount = floor(makerAssetFill × takerAmount / makerAmount)
```

`makerAssetFill` is collateral for a BUY and shares for a SELL. ExchangeV3
reduces a BUY's remaining collateral budget by the amount actually spent.
CLOB GTC/GTD BUY targets are shares; FOK/FAK BUY targets are collateral.

Reconcile fills and fees separately: BUY fees add to collateral spend;
SELL fees are deducted from proceeds.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.