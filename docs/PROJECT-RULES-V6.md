# Deterministic project rules V6

The production rules profile now uses deterministic checks, with no model call.
Wallet authentication, owner signing and the existing Helius RPC configuration
remain in place. The separate Python scanner does not access the trading account
and is not automatically started in the Railway Node service.

## Entry and exit policy

New entries require top10 excluding pool/curve <22%, dev <4%, no observed dev
sale in the first 15 minutes, at most three distinct creation-block buyers with
verified SOL amounts, curve progress 15–75%, and no top10 match in wallets.txt.
Reject socials when age <72 hours AND followers <200. Missing required evidence
produces WATCH, not an assumed pass. Existing minimum holder/depth and quote safety
checks still apply.

Account risk is capped at 1.5% using full principal loss plus a 0.0025 SOL fee
allowance, rather than assuming a stop guarantees loss. Maximum four positions
includes existing RUNNER positions and pending BUY orders. Old small-account 20%
minimum, QUICK entry and new RUNNER entry are disabled under this profile. On a
small account orders can be below the old size; below the executable minimum the
bot skips. Actual fees are rechecked before signing.

BUY is blocked from 01:00 to 08:00 Asia/Ho_Chi_Minh. Two consecutive closed net
losses trigger 60 minutes from the latest loss; reevaluation does not extend it.
PROJECT_TIME_ZONE optionally overrides the timezone. Protective SELL continues.
New positions have fixed −30% stop and sell 40% at 2×, without trailing,
break-even or time exit. Existing positions retain their saved exit policy.
Stops and quote limits do not guarantee executable exits or maximum realized loss.

Future profit transfers use 9QixUMsk9gxCAHLoWuR1F6vcrSeXifWiTDs4wd8JDp7P.
Previously signed pending transfers retain their original recipient and are only
reconciled; they are not recreated or rebroadcast by this migration.

## Required evidence and configuration

No new paid API or API key is installed. Existing RPC/signer variables remain.
Configure wallets.txt through the authenticated owner UI. The default location is
in the application's persistent live directory; WALLETS_FILE may override it and
must have basename wallets.txt. One public address per line, optional comments.
An intentionally empty list requires explicit # allow-empty (or the UI checkbox).
An absent list is unverified, not an empty blacklist.

Social account age/followers cannot be verified from holder RPC. Full creator
history is also unavailable from bounded mint history. Without additional verified
evidence the strict rules can leave candidates at WATCH and prevent new BUY.
Default RPC research reads at most 64 mint signatures and eight transactions,
serially on the research lane. Incomplete coverage remains unverified.

Optional PROJECT_RESEARCH_URL is an owner-configured HTTPS evidence endpoint.
It receives mint and pool query parameters and returns JSON with:

```json
{
  "mint": "requested mint",
  "pool": "requested pool",
  "checkedAt": 1793280000000,
  "coverage": {"devFirst15m": true, "creationBlock": true},
  "devSoldFirst15m": false,
  "creationBlockBuyers": [{"wallet": "public address", "sol": 0.1}],
  "socials": {"verified": true, "ageHours": 80, "followers": 250, "source": "verified source"},
  "devHistory": null
}
```

Identity must match, checkedAt is UTC epoch milliseconds within 60 seconds,
coverage must be explicit, and missing data must remain null/unverified. Responses
are bounded and requests time out. This service is a trust boundary, not independent
proof of its claims. The standalone scanner uses its derived bonding curve as pool.
No service is configured automatically.

## Verification and limits

Run npm run build, npm run check, npm test, and npm run test:scanner.
Tests cover policy boundaries, social AND condition, cooldown, old/new exit
separation, final signing guards, profit-recipient migration and scanner filters.
Fixtures are test data, not observed performance or evidence of successful trades.

See tools/pumpfun-scanner/README.md for polling, retention and offline reports.
Backtests use recorded outcomes only; narrative/source checks do not invent web
research or AI conclusions. Scanner CSV retention does not delete the financial
ledger. Deployment activation and real provider coverage need separate live checks.
