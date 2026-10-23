# Meme Pilot · Paper 20 SOL

Bản hiện tại chạy hoàn toàn bằng **20 SOL mô phỏng**, dùng dữ liệu thị trường
thật. Không ký/gửi giao dịch hoặc chuyển SOL thật. Bản hiện tại ưu tiên gainers 5 phút
để thử giao dịch ngắn, có ghi nhãn so sánh bộ luật gốc; không tự huấn luyện hay
triển khai tham số mới bằng tiền thật.

## Portfolio risk v5 · `paper-5m-risk-v5`

These are **unvalidated research parameters**, not estimates of optimal returns.
The dashboard and discovery shortlist rank observed PumpSwap pools by 5-minute
percent gain descending. Executable entries additionally require recent price
continuation with positive observed buy-count imbalance, and prefer lower
verified round-trip loss before incremental flow and score. This is a rank within the bot's discovery universe,
**not** an integration of DexScreener's entire in-app New Gainers table. The same
DexScreener/GeckoTerminal discovery, RugCheck, Jupiter and configured RPC sources
remain in use; there is no undocumented gainers endpoint or new paid data feed.

| Rule | New paper entries |
|---|---|
| Five-minute gain | +5% to +100% |
| Volume / activity 5m | ≥$500, ≥5 buys, ≥10 trades, buy/sell ratio ≥1.1 |
| Context | H1/H4 are recorded; green H1 and green H4 are not required |
| Score | ≥40; momentum 30, flow 25, acceleration 20, depth 15, cost 10; wash/boost penalties retained |
| Confirmation | Three actual snapshots spanning 10–30s, each 5–15s apart: price rises on each leg and ≤4% overall, nonnegative rolling buy/sell deltas with buys > sells on BOTH legs; intermediate price retention ≥99.5%, liquidity retention ≥90% |
| Security / execution gates | Existing authority, token program/extensions, LP, holders, cap/depth, round-trip ≤6%, impact ≤2%, real quote and capital checks retained |
| Allocation | min(2.5% accounting capital, 0.3% capital / current stop fraction, available cash after 0.1 SOL reserve + 0.005 SOL overhead). No 0.6 SOL cap. |
| Portfolio admission | 1.5% accounting-capital nominal open-risk budget. Fresh exact-amount SELL marks required; current quote losses can increase the charge above nominal stop risk. Missing marks are charged as full principal, never zero. |
| Surveillance capacity | 10s freshness / measured p95 monitor cadence, with one slot reserved where possible. Baseline 2s tick allows 4 holdings; slower reads/dispatch lower this, potentially to zero. Existing holdings are never force-closed solely because capacity decreases. |
| Modeled cost screen | Existing raw round-trip ≤6% AND estimated normal loss including 1.5% modeled execution each way ≤6%. Multiplicative unchanged-route estimate, not an additional executable quote. |
| Reentry | Same mint blocked for 24h after ANY complete close, including profitable exits. |
| Stop | −12% using net executable SELL quote against allocated cost |
| Profit | +15% net sells 50%; +30% net closes remainder (a jump directly to ≥30% closes all) |
| Trailing | 8% below peak net value per token after the first sale actually fills |
| Stall / hold | 3 minutes without an observed net gain ≥5% exits; maximum hold 10 minutes |

Market shortlisting retains the 5m universe; BUY selection uses verified
round-trip cost and continuation instead of maximizing past percent gain.
Held pools remain pinned and included. The verification decision cache is 10s
for paper; reports/facts keep their existing 20s cache. Two verification workers,
SELL-priority quote queue, serialized reads, provider backoff and slippage caps
remain enforced; API outages can delay/miss entries and exits. Paper entry
round-trip probes run only after continuation confirms; holding surveillance
still refreshes safety facts but does not request redundant BUY round trips.
A queued SELL can displace a lower-priority read when the quote queue is full.

Every new position, pending order and archived fill pins its strategy, entry and
exit policy. Restarts preserve capital, quantities, first-profit state and
trailing peak. Unfilled BUY intents from a previous policy are canceled on
upgrade; existing SELL intents and open positions keep their old policy.
A partial day's daily report separates results by strategy. These groups share
virtual capital and are not independent backtests; per-group drawdown remains
unknown. Fee, latency and fill assumptions still apply, and fast exits may lose
to fees or execute well beyond a stop during a price gap. Collect at least 100
closed trades per strategy and use a later time period before judging an edge.


The 4% short-window rise ceiling reuses the existing BUY price budget as an
anti-chase research hypothesis; it was not optimized on the 32 uploaded positions.
Rolling count changes are a proxy, not a transaction stream or independent-wallet
count. Window roll-offs make negative deltas unknown and ineligible. False
negatives and lower entry frequency are expected risks. The audit found 32 closed
positions, −2.810357 modeled SOL, and 16 stop exits totaling −2.735459 SOL; those
figures justify execution review but do not establish new profitable thresholds.

Stops are evaluated against fresh SELL quotes at the time the read completes.
A pending BUY cannot suppress held-position monitoring: a triggered exit replaces
it, and missing exit quotes cancel the unfilled entry. Scalp SOL exits can trigger
and fill without a fresh DexScreener price or SOL/USD quote. Missing USD values
remain null; no current USD price is fabricated from entry prices. Each BUY and all of its partial/final SELL fills share a stable `positionId` for audit/training. Each position can queue its own SELL. A delayed/retrying SELL does not prevent checking other holdings or filling another ready SELL; at most one exit per mint is queued. Actual fills and quote reads remain serialized within provider limits. Accounting capital is used for the allocation target, while equity/PnL stay unknown when quotes are stale. V5 defers additional BUYs until held-position exit quotes are fresh. Multiple positions and provider outages can still delay exits; no hard stop execution guarantee is claimed.

The original 12% stop, +15%/+30% profit exits, 8% trailing, 3-minute stall,
10-minute hold remain. Position sizing is now the requested 2.5% allocation. The emergency 10% haircut stress
assumption remains explicit; lowering it to improve reported PnL is not part of
this revision. Ledger exports now retain quote/trigger timestamps, quantities,
slippage tolerance, assumed and effective haircuts, holding time, the policy's
actual initial risk, and entry continuation/cost features alongside each fill.

`previousPaper` labels now apply v3 gates to shared observed data without additional
provider calls. They are conditional on the evidence collected by v4, not a
separately funded v3 strategy. Historical v4 expectancy/PF/drawdown cannot be
replayed from the uploaded shortened ledger. Collect ≥100 closed v4 positions,
retain missing observations, compare later time periods and calibrate the fill
model before any promotion to real funds. Production remains paper-only. The historical v4 research and the operational v5 policy are detailed below.

## Solana portfolio admission v5

This revision learns separation of responsibilities and deterministic risk math
from the shared example. It does not use EVM RPC, Uniswap, owner(), WETH thresholds,
15-minute scans, manual made-up PnL or signing agents. PumpSwap/Solana program,
authority, vault, holder, LP and exact-size Jupiter safety checks remain in place.
The v4 three-observation persistence and cost filters, SL/TP, 2.5% allocation,
fee/rent assumptions and 4%/3%/10% slippage caps remain.

At 20 SOL, the allocation target is 0.5 SOL. A 12% nominal stop makes the per-trade
nominal risk 0.06 SOL (0.3% of capital), not 2.5%. The open nominal-risk budget is
1.5% of accounting capital = five such risk units; this is a conservative research
policy derived from existing allocation/stop and the five theoretical 2s quote
slots within 10s, not a fitted optimum. Operational admission is more restrictive:
one slot is held back where possible. Retired daily/streak/drawdown halts stay off.

For every holding, admission charges max(remaining principal × its pinned stop,
current quoted loss). Allocated modeled BUY fees are removed from remaining
principal when known; old holdings without fee evidence are charged conservatively.
A missing, future, stale or wrong-quantity quote charges the entire remaining
principal and defers new entries. Already-triggered stops defer new entries too.
A pending BUY reserves its risk; its own post-delay recheck excludes that same
reservation. Capital and admission are checked again after the fill quote returns.
This cannot guarantee loss limits during gaps, rug events or failed SELL routes.

The monitor records recent quote latency, actual spacing between monitor attempts
and failures. Capacity uses the worse of the 2s base tick, p95 dispatch spacing,
and p95 read latency over a five-minute window. It is an estimate, not an execution
SLA or an independent provider quota. A successful exit read recovers the provider
health gate. Final closure clears the monitor timestamp so idle hours cannot be
mistaken for a slow active quote loop. Existing quantities, pinned exits, pending
SELLs and PnL are preserved across an upgrade; no liquidation occurs to meet a cap.

When admission is blocked, new candidate on-chain/quote probes are deferred while
held-position safety checks, exit monitoring and passive market labels continue.
The already-pending BUY may refresh its own proof if its admission still passes.
The UI distinguishes token eligibility from portfolio rejection, exposes the risk
budget/capacity and deferral code, and keeps the one-viewport layout. Daily report
JSON and new fills retain the policy and admission snapshot. Simultaneous −50% and
−90% shocks to held principal are disclosed separately, before fees/impact; these
are arithmetic scenarios, not full stress-path backtests.

No v5 market performance is available. The old 50-position ledger still describes
v3 and cannot validate these admission thresholds. Collect ≥100 closed v5 positions
and examine a later period before any claim of improved expectancy or drawdown.

## Evidence for v4 (uploaded 23 October 2026)

The uploaded v3 ledger contains 50 closed positions, 9 wins / 41 losses,
−2.657734015 SOL and profit factor 0.1514. All chronological 30/10/10 splits
lose money. Reconstructed concurrency is ONE, matching all daily maxima: the
40-position surveillance bottleneck is not established as a cause of this sample.
Eight observed reentries within 24h all lost (−0.827173143 SOL); this is a subset,
not saved-PnL backtesting. The 24h policy restores the intended same-token pause.
No claim that a larger score or hotter 5m gain fixes the loss is supported.

SELL quote-to-fill output differences total 1.226169726 SOL at the quantities
actually sold. Arithmetic at those same quantities and quote outputs is still
−1.431564289 SOL. These figures separate model assumptions from market exposure;
they do not reverse BUY haircuts or simulate alternative execution paths. The
normal 1.5% and emergency 10% haircuts, fees and 2s modeled delay remain unchanged.

Entry persistence over two consecutive legs is an UNVALIDATED hypothesis, not a
threshold selected by fitting these 50 trades. It reuses the 5–15s observation gap,
4% anti-chase and 90% liquidity retention; no new feed or wallet-count inference.
It may miss short runners and reduce the number of entries. Full-model cost
screening can reject routes even though raw quotes pass. Its multiplication is an
estimate at unchanged route/price; AMM amount nonlinearity is a limitation.

A 500ms timer settles only already-triggered, due SELL orders through the same
serialized desk and provider queue. It does not shorten the 2s paper delay,
add BUY probes, increase periodic holding surveillance, or bypass rate limits.
Network/lock delays can still postpone execution. Provider cooldown/queue wait
codes are now distinct from actual HTTP 429 observations; historical counters
are kept as recorded. Daily reports add quote/model decomposition.

Existing cash, trades, open-position exit policies, allocation and outboxes are
preserved when their files survive. Old unfilled BUYs are canceled; known closed
receipts seed the new 24h reentry policy. No historical v4 PnL backtest is possible
without the third entry-time observation and full quote paths. Collect at least
100 closed v4 positions and assess later periods; no automatic promotion to live.

## Multi-position allocation and execution limitations

With 20 SOL the target order is 0.5 SOL. Open positions retain their cost basis in
the allocation reference, so successive BUYs do not geometrically shrink orders
as a percentage of leftover cash. Realized losses reduce future orders; unrealized
gains do not enlarge them. This reference is **not market equity** and can overstate
available portfolio value when holdings lose value. Fees and locked rent are
accounted for separately and the last order is clipped to protect cash reserves.
Minimum order is 0.0025 SOL: two modeled network fees at this size already consume
2%, leaving the existing 6% quote-cost budget within the 8% total entry-cost cap.
Current quote/impact/capital gates still decide whether any token can enter.

At unchanged starting capital, cash alone could fund 39 full 0.5 SOL orders and one clipped order. V5 does not admit that many: portfolio risk and observed SELL-surveillance capacity also apply. Normal entries retain the v4 persistence/cost rules with the v5 portfolio gate;
no unsafe tokens or fake fills are added to increase sample count.

Fresh market prices and LP/dev alerts prioritize exact SELL quote checks, with an
oldest-check turn after 30s to reduce starvation. The 30s is a scheduling priority,
**not a guaranteed maximum delay**. Quotes have the same rate limit and concurrency
as before: 40 held tokens cannot all receive 10s quote freshness under a roughly
one-request-per-1.1s provider budget. Monitoring status exposes unquoted/stale
holdings, oldest available quote age, and all queued exits. Pending exits persist
and retain their per-position policies across restart if storage survives.

BUY then SELL within one Solana transaction can be atomic for an immediate
round trip, but cannot wait for future appreciation. It does not eliminate route
fees, impact or slippage. This strategy uses separate entry/exit intents with
fresh post-delay quotes, original minimum-output limits and unchanged stress
haircuts. A gap outside the limit refuses the fill rather than inventing a
favorable execution. No swap/bundle/private-key capability was added.

Daily 23:00 Vietnam Telegram reports retain all fills and now include allocation
policy, per-trade capital/size, position IDs, exit backlog and quote-coverage information. Daily counters include missing equity samples; observed drawdown can miss losses during valuation gaps.
Mechanical multi-position/crash/429 tests do not establish profitability; future
paper results must validate expectancy and drawdown before any real-money change.

## Chạy

```sh
npm ci --ignore-scripts
npm run build
npm test
npm start
```

Node.js ≥24. Quét PumpSwap mỗi 5 giây. Có thể dùng `HELIUS_API_KEY` phía server
như trước; không cần private key để chạy paper. Dashboard xác thực ví chủ bằng
ký thông điệp chỉ khi điều khiển hoặc cấu hình/xuất báo cáo. Đặt Telegram và
Volume như mô tả dưới để lưu và gửi báo cáo sau restart.

Tài liệu mainnet cũ được lưu ở [docs/mainnet-archive.md](docs/mainnet-archive.md)
để tra cứu; đó không phải hướng dẫn cho chế độ production hiện tại.

### Production paper mode (20 SOL)

The production entry points (`npm start`, Docker, Railway) now always run the
paper-only server. `PAPER_WORKSPACE`, signer settings and existing real ledgers
cannot enable real trades. `/api/direct/*`, `/api/signer/*`, `/api/live/*` return
410. The former server is retained as `src/mainnet-server.js` for regression tests;
it is not a production route or mode switch. Existing real positions are **not
sold or managed** by paper mode; inspect any remaining real holdings separately.

The new ledger is `<DATA_DIR>/paper20/ledger.json`, with a durable backup and
separate immutable fill archives. Initial capital is 20 virtual SOL **once**;
restart never reissues capital. PumpSwap discovery, 5s scans, safety gates, 2.5% accounting-capital sizing,
0.1 SOL reserve remain unchanged. New paper entries and exits use the versioned
5-minute scalp policy below; open positions keep their original exit policy. Daily loss, loss-streak pause and drawdown enforcement stay off,
as previously configured; drawdown is still measured. No curve or GMGN source
is enabled by this change. Previously paused RugCheck diagnostics remain separate.

Paper fills require a fresh real Jupiter quote after a modeled 2s delay, within
the original intent's slippage limit, with at most 3 attempts; new BUY intents expire after 10s and SELL intents after
30s. New-strategy executable quotes and round-trip evidence must be ≤10s old.
The conservative model discounts the new quote's expected output by 1.5%
(normally) or 10% (emergency), bounded below by the fresh quote's minimum and
the original intent's limit (4% BUY / 3% regular SELL / 10% emergency). A fresh
expected output already outside the original limit cannot fill. Modeled network/priority cost is 0.000025 SOL per
filled side; refundable ATA rent is 0.00203928 SOL. These are **assumptions**,
not observed fees or real receipts. Trigger quotes also deduct the modeled SELL
fee. With stale valuation quotes equity becomes unknown and BUY waits. A failed
quote cannot create a fill, including emergency exits. This read-only paper
adapter has no local transaction-building fallback: route outages, latency,
inclusion, MEV, Token-2022 account rent and Jito costs can differ from live.
It is a diagnostic experiment, not a validated backtest or automatic training.
No new parameters are promoted to live from paper results.

Daily reports at **23:00 Asia/Ho_Chi_Minh** contain all winning and losing fills,
entry features, modeled quote slippage/delay/costs, gate counts, provider errors,
exit PnL, expectancy, profit factor and drawdown where fresh equity is available.
They include full compressed scan journals as JSON/base64 gzip chunks (concatenate
by file and byte offset, verify SHA-256, gunzip, filter timestamps to the report
interval). Reports cover `[23:00 previous day,23:00 current day)`, mark the first
partial day and catch up missed days after restart. Fewer than 100 closed trades
is explicitly insufficient for optimization conclusions. Files and Telegram's
outbox persist independently; delivery may duplicate after an ambiguous network
failure because Telegram has no client idempotency key.

Telegram credentials can come from server-side `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_CHAT_ID`, or be encrypted via the owner-authenticated dashboard.
To reuse existing encrypted Telegram settings, authenticate with the owner
wallet (message signature only), enter the existing vault password and choose
**Dùng Telegram cũ**. This reads credentials and immediately locks/discards the
old key without creating an OwnerAgent or enabling trading. Paper notifications
then use their own encrypted settings. Configure `PAPER_REPORT_PASSPHRASE` on
Railway for unattended notification unlock after restart; otherwise unlock paper
Telegram again on the dashboard. Never put these secrets in Git or chat.

**Railway storage:** attach a Volume (e.g. `/data`, Railway supplies
`RAILWAY_VOLUME_MOUNT_PATH`) before relying on overnight research. Without a
Volume the container filesystem is ephemeral and a redeploy can lose paper
ledgers, journals, report archives and notification settings. The UI explicitly
shows ephemeral storage; a backup in the same container does not solve this.


Previous exploration policy (`paper-exploration-v1`, historical comparison; new entries use the scalp policy above):

| Entry gate | Baseline | Paper experiment |
|---|---|---|
| Score | ≥60 | ≥40 |
| Buys / total tx 5m | ≥8 / ≥15 | ≥3 / ≥8 |
| Total tx 1h | ≥80 | ≥20 |
| M5 and H1 positive | Required | Direction recorded as features; may be negative |
| Dump/chase | M5 ≥−8%, H1 ≤150% | M5 ≥−20%, H1 ≤300% |
| H4 dump pattern | Exclude | Record as a label; permit research sample |
| Confirmation | Positive observations 10–15s apart | Two distinct fresh snapshots ≥5s apart |
| Market cap, real depth, RugCheck, authorities, holders, quotes | Mandatory | Unchanged |

Each entry records original baseline eligibility, exact relaxed flags, policy
version and observed entry features. Safety/quote evidence is never synthesized.
The verification pipeline accepts an injected analyst only in the paper server;
the default analyst and archived live server retain the baseline rules. Concurrency
limits and provider backoff remain enforced despite the larger candidate set.

Passive research also labels already-fetched PumpSwap snapshots after 1, 5, 15
and 30 minutes, including rejected candidates. It makes **no additional API/RPC
requests**. Missing future observations (outside a 15s horizon window) stay
unknown, not zero returns. Spot returns are explicitly **not executable PnL**;
full scan data, rejected flags and outcome gaps accompany the daily archive.
Coverage is limited to tokens the discovery feed continues observing, so study
survivorship/missingness before drawing conclusions. Cohort PnL in the report is
not an independently funded baseline backtest. More samples may include more
losses; no automatic parameter training or promotion to real funds is enabled.

The paper dashboard highlights the panel and mint currently being scanned,
verified, quoted or processed, replacing the spider decoration. Quote reads,
pending simulated orders and newly observed fills have distinct labels. The
read-only `/api/activity` endpoint exposes transient activity without requesting
market/RPC data; the browser polls it once per second while visible. Reduced
motion uses a static outline. This UI does not change entry or exit rules.
Diagnostics show leading current blockers, source counts, last evaluation time
and execution prerequisites such as exact-size quotes and pool participation.
The accumulated evaluation counter includes repeated observations, not unique
tokens. Historical baseline rules that the paper policy removed are labeled
separately from the current reason for rejection.

Paper confirmation retains observed snapshots within the existing 5–15s window
so sub-5s scan completion jitter does not continually discard its anchor. It
requires changed content, a newer source timestamp and price/liquidity retention
through intermediate observations; repeated source timestamps and old anchors
remain invalid. Completed background verification is read by each 2s execution
tick and the dashboard without waiting for another discovery scan. These cache
reads neither call providers nor refresh price/proof timestamps. All existing
safety, quote-expiry, cost, sizing and pool-participation gates still apply.
Verification errors distinguish on-chain policy failures from round-trip quote
failures using fixed diagnostic labels; unknown raw errors/URLs stay private.

Paper fills request a quote whose observation starts after the simulated delay;
an earlier cached or in-flight quote cannot stand in for this observation. The
cache still coalesces requests that satisfy that timestamp. Intention expiry is
checked again after quote/RPC reads so a delayed response cannot create a late
fill. Pending status shows elapsed seconds, retry count and a fixed failure code;
recent execution failures are visible alongside the scan decisions. The 2s delay,
three-attempt limit and existing slippage/expiry limits are unchanged.
