# Meme Pilot · Paper 20 SOL

Bản hiện tại chạy hoàn toàn bằng **20 SOL mô phỏng**, dùng dữ liệu thị trường
thật. Không ký/gửi giao dịch hoặc chuyển SOL thật. Bộ lọc vào lệnh paper được nới
để thu thập dữ liệu, có ghi nhãn so sánh bộ luật gốc; không tự huấn luyện hay
triển khai tham số mới bằng tiền thật.

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
restart never reissues capital. PumpSwap discovery, 5s scans, safety gates, capped/adaptive 0.6 SOL sizing,
0.1 SOL reserve and exits reuse the current rules. Entry selection uses the
separately versioned paper exploration policy described below. Daily loss, loss-streak pause and drawdown enforcement stay off,
as previously configured; drawdown is still measured. No curve or GMGN source
is enabled by this change. Previously paused RugCheck diagnostics remain separate.

Paper fills require a fresh real Jupiter quote after a modeled 2s delay, within
the original intent's slippage limit, with at most 3 attempts and 30s expiry.
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


Paper exploration policy (`paper-exploration-v1`, requested for broader research):

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
