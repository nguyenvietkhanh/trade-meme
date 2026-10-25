> ## Documentation Index
> Fetch the complete documentation index at: https://docs.polymarket.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Polymarket Protocol V2 Contract Migration

> Add Polymarket Protocol V2 position operations to an existing pUSD contract integration.

Add Polymarket Protocol V2 support to an existing pUSD-based binary or neg-risk
contract integration. Keep CTF support for V1 markets and holdings: updating
the integration does not convert existing CTF balances.

## Update Position Operations

V2 positions use a separate ledger. Update balance handling and permissions
before replacing position calls.

**1. Use PositionManager for V2 Positions**

Configure PositionManager and Router using their
[Polygon Contract Addresses](https://docs.polymarket.com/resources/contracts.md).

Use PositionManager for V2 balances and transfers, with `uint256`
position IDs. Retain CTF token IDs for V1 markets.

> [!WARNING]
>
> Protocol mints and unsafe transfers do not invoke ERC-1155 receiver
> callbacks. Account for these balance changes explicitly if the receiving
> contract relies on callbacks.

**2. Approve Router**

Grant these permissions from the account or contract holding the assets.
Existing CTF approvals do not carry over.

| Operation | Approval |
| - | - |
| Split | On pUSD: `approve(ROUTER, amount)` |
| Merge or redeem | On PositionManager: `setApprovalForAll(ROUTER, true)` |

**3. Replace Split, Merge, and Redemption Calls**

Replace legacy calls with these V2 Router ABI signatures:

```text Router ABI theme={null}
function split(bytes31 conditionId, uint256 amount)
function merge(bytes31 conditionId, uint256 amount)
function redeem(bytes31 conditionId, uint256 outcomeIndex, uint256 amount)
```

| Input | V2 value |
| - | - |
| `conditionId` | V2 `bytes31` condition ID. For a padded V2 `bytes32` value, validate its final byte is zero before narrowing. |
| `amount` | Six-decimal base units: `1_000_000` is one pUSD or one share. Merge spends this amount of each outcome. |
| `outcomeIndex` | Redemption uses `0` for YES or `1` for NO, replacing CTF index sets `1` and `2`. Supply an explicit amount. |

Router pulls assets from the caller and returns outputs to that caller in
one transaction. Do not pre-transfer assets to a module in a separate
transaction.

## Update Payout Reads and Indexing

Read redemption proceeds through PositionManager:

```text PositionManager ABI theme={null}
function getPayout(uint256 positionId, uint256 amount) view returns (uint256)
```

The result is the pUSD payout in base units for the specified amount.
Unresolved positions can revert; zero is a valid losing payout.

Index PositionManager transfers and module events:

* Split burns pUSD; merge and redemption mint pUSD.
* Attribute operations using transfer owners and recipients. A module event's
  `initiator` is the immediate caller.
* Avoid counting Router and module events as separate operations.

V2 neg-risk results can be derived without individual `ConditionResolved`
events. Refresh on `RemainingConditionsDerivableAsNo` and
`SyntheticConditionDerivableAsYes`, then read the module's `getResult` or
PositionManager's `getPayout`.

## Update V2 Trading

For BUY orders, approve ExchangeV3 to spend pUSD, including fees. For SELL
orders, approve ExchangeV3 as a PositionManager operator. Sign V2 orders
against ExchangeV3 with EIP-712 domain version `"3"`; see the
[API Migration Guide](https://docs.polymarket.com/migrate/polymarket-v2/api-integrations.md).

## Enable V2 Automatic Redemption

If using AutoRedeemer, submit this approval from the account or contract holding
V2 positions. Use the configured PositionManager contract and AutoRedeemer
address:

```solidity theme={null}
positionManager.setApprovalForAll(AUTO_REDEEMER, true);
```

An authorized operator can redeem each submitted position's full balance,
returning pUSD to the same holder. Account for these changes; approval alone
does not schedule redemption.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.