# Balance and signer recovery

Code inspection found that the normal pulse returned on signer reconnect errors
and read balances only after reconciliation/inventory/profit processing. A failure
in those steps could starve balance updates. The dashboard also hid the wallet
balance after ten seconds. This is not evidence of an on-chain transfer.

A separate low-priority five-second read-only balance loop now runs without a
signer. Requests coalesce and skip when a recent read exists. The last observed
balance and UTC timestamp persist across restarts, are explicitly stale on restore,
and are displayed with their freshness status. Stale balance never provides
available capital. A failing RPC read does not replace the last observation with
zero. Existing ledger, current risk policy and profit recipient remain unchanged.

A reconnect failure no longer locks a previously enabled valid signer merely
because reconciliation/RPC failed. BUY is stopped on connection failure; automatic
reconnect still retries, respects a saved BUY pause, and explicit disconnect still
revokes signing. A signer that was not enabled before failure is not enabled by
this change. Missing, invalid or wrong-owner keys remain errors. No secret value
is returned to UI or logs.

RPC blocking reconnect with a configured key is classified as RPC_UNAVAILABLE,
not an independent signer failure. Missing/invalid signer configuration remains
SIGNER_UNAVAILABLE with its fixed diagnostic code. Configured keys receive a
60-second restart grace while the authorized reconnect completes.

Health alerts are incident based, persisted in the financial state for restart
deduplication. A continuous failure sends once until observed recovery; a later
incident sends again. Queued duplicates are marked superseded and queued resolved
incidents are marked resolved, preserving the notification audit and all trade
notifications. No raw provider error or credential is included.

Tests use generated throwaway keys and mocked read-only RPC, covering missing
signer, RPC outage/recovery, stale balance restore, explicit disconnect, and
persistent alert deduplication. They do not establish production signer settings
or deployment activation. Check Railway Active commit and fixed signer error code
if a real configuration failure remains; never share the secret itself.
