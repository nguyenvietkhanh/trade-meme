# River model control of ten paper bots

The owner authorized AI BUY/SELL/HOLD decisions for the existing **paper** fleet.
This release does not introduce real-wallet signing or enable live trading.
Existing independent 2-SOL initial books, balances, positions and Telegram/wallet
administration remain. Deploying or adding a model key never resets capital.

## Railway variables

The deployed Docker image already sets the three non-secret defaults below:
`MODEL_BASE_URL`, `MODEL_NAME`, and `MODEL_TRADING_ENABLED=true`. Only add the
secret `MODEL_API_KEY` in Railway Variables. Existing Railway variables override
container defaults if you previously set different values. The API key is never
baked into the image. Without a key, the container waits for model configuration.

```ini
MODEL_BASE_URL=https://api.river.ai/v1
MODEL_NAME=deepseek-ai/DeepSeek-V4.1-Flash
MODEL_API_KEY=<set the real key in Railway Variables only>
MODEL_TRADING_ENABLED=true
MODEL_POLL_MS=30000
```

The key is never sent to the browser or worker environments/arguments. Only the
parent process calls `/chat/completions` with a Bearer header, HTTPS and redirects
disabled. This implements the OpenAI-compatible protocol. River accessibility,
model-name availability, billing and account authorization **cannot be verified
without an actual authorized key and a successful response**. Neither a configured
variable nor an old successful response proves current provider availability.
The UI displays configuration, verification, current errors and per-bot activity.

A nonempty key enables the model automatically unless explicitly disabled.
`MODEL_TRADING_ENABLED=true` with no key waits rather than placing rule BUYs.
After a bot has used model mode, losing its key does not silently return it to
rule trading. Set `MODEL_TRADING_ENABLED=false` explicitly to return to rules;
unfilled model BUY intents are canceled without spending funds. Protective SELLs
and existing holdings continue to be monitored.

## Decision authority and isolation

Each of the ten actual child processes has its own role, wallet, history and
model request. The same stateless provider/model serves ten separate contexts;
shared model weights do not imply statistically independent decisions/returns.
The model may choose the same token in different wallets. There is no trade quota.
No peer balances, peer histories, wallet secrets or Telegram credentials enter a
model request. Untrusted token names, social links and metadata are excluded;
numeric market features, mint/pool identifiers and own history are allowlisted.

In model mode, old strategy scores/lanes prioritize the data shortlist and serve
as research style, **not mandatory rule-based BUY approval**. Missing M1/wallet
features are disclosed as unknown. The model can decide with the observations
available, or HOLD. Each request includes at most 8 candidates by default plus
own holdings; this is not a claim that the model inspected the entire market.
The API cannot invent an unknown mint, change configuration, execute code, access
the filesystem or obtain signing keys.

Structured output is validated twice. BUY chooses a supplied candidate and an
order size within the current own-wallet limit (initially max 0.05 SOL, min
0.0025 SOL), keeping 0.1 SOL reserve + fee overhead. One new holding per bot and
own token cooldown remain. SELL chooses a held mint and percentage, which becomes
exact own-position raw units. Confidence is subjective and uncalibrated.
Freshness, updated wallet/position fingerprint, a 30-second decision lifetime,
4% adverse BUY price/output limit, 2-second paper delay and ≤6% quote round-trip
cost are still enforced. The executor determines fees, rent and fill outputs;
model text cannot manufacture a fill or profit.

New model-entered holdings use AI for discretionary exits. The existing per-bot
stop-loss threshold, emergency-risk exit and maximum holding time remain
protective controls. Previous holdings retain their pinned exit policy, and AI
can still request an earlier SELL. Inference is asynchronous: a slow model does
not block the 1-second price/SELL monitor. Profit targets cannot mask the maximum
holding-time/emergency protection. API errors/malformed outputs become WAIT, with
no silent fallback BUY from the old rules.

## Rate and cost controls

- `MODEL_POLL_MS=30000`: approximately 20 requests/minute for ten eligible bots,
  up to about 28,800 requests/day if continuously active. Actual cost depends on
  provider pricing and token usage; it is not included in simulated trading PnL.
- `MODEL_REQUESTS_PER_MINUTE=30`: global request budget; excess requests wait.
- `MODEL_MAX_CONCURRENCY=10`: independent in-flight calls, one per bot.
- `MODEL_TIMEOUT_MS=15000`: bounded provider call; 429 respects Retry-After;
  401/403 are visible and back off. Changing a key requires a service restart.
- `MODEL_MAX_TOKENS=500`: output cap. A truncated response cannot place a trade.
- `MODEL_MAX_CANDIDATES=8`: bounded context; range 1–12.

Each normalized decision, rejected intent and fill records model name/source.
Per-bot state retains its own last 12 decisions. Daily Telegram at 23:59 Vietnam
continues with engine labels and report JSON includes model status, usage counts,
AI fills and entry/execution engines. Wallet metrics include prior rule history;
filter by `entryDecisionEngine` and activation time before comparing AI performance.
There is no online weight training or demonstrated profitability.

## Validation

```sh
node --test --test-isolation=none --test-concurrency=1 \
  test/paper-model-client.test.js test/paper-model-runtime.test.js \
  test/paper-supervisor.test.js test/paper-runtime-isolation.test.js
npm run check
npm run build
```

Fixtures test 10 concurrent independent prompts, 10 real worker-to-parent model
requests, key redaction, invalid/expired responses, unknown mints/oversized orders,
HTTP429/401, paused BUY with SELL allowed, delayed paper fills, resume behavior,
and protective exits while inference is unresolved. These are integration/unit
fixtures, not a verified River connection, 48-hour paper result or real trading.
