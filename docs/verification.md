# Evidence and open gates

Research date: 2026-10-26 (Vietnam).

- https://pypi.org/project/py-clob-client-v2/1.2.1/
- https://github.com/Polymarket/py-clob-client-v2
- https://raw.githubusercontent.com/Polymarket/py-clob-client-v2/main/py_clob_client_v2/client.py
- https://raw.githubusercontent.com/Polymarket/py-clob-client-v2/main/py_clob_client_v2/fees.py
- PyPI wheel SHA256: `9dc00b444632cdb9aeae1c80490a3df0ff50dd5694a015480396cc4f77e7c6ae`.
  Wheel fee source was checked against this digest, and unit tests compare the
  local Decimal formula with its public helper at multiple prices/exponents.
- SDK defaults missing `fd` to zero. Scanner deliberately requires explicit r/e.
- SDK docs say `nr` may be omitted when false; raw CLOB metadata follows that;
  Gamma still requires explicit negRisk=false. Token mapping remains strict.
- `get_order_book(token_id)` and raw `/clob-markets/{condition_id}` are verified
  in official SDK source, but actual production response shape remains unverified.
- Official docs requests to `/llms.txt` and `/trading/overview` failed proxy
  CONNECT 403. The v2-migration page was not read. No production contract address,
  wrap method, approval spender, fee rounding rule or WS subscription is asserted.
- Public live Gamma/CLOB validation blocked by the same current restricted policy.
- Dependency installation and offline tests do not establish venue compatibility,
  production fee correctness, tradability or profitability.

Before claiming stage 1 production verification: publish network settings, fetch
and record official v2-migration/API/fees/WS docs, verify collateral/fee units,
collect sanitized public Gamma and book/fee response fixtures, validate parsing,
measure book timestamps/skew and connect WS using its documented snapshot protocol.
This gate cannot be overridden with DRY_RUN=false or a private key.
