# Biến môi trường hiện tại V5.4 revision 2

Railway → trade-meme → Variables. Các env đã đặt ghi đè mặc định mới.
Giữ nguyên signer và Volume. PCT là phần trăm; ASSUMED_WORST_LOSS là tỷ lệ.
RUNNER_STOP_PCT nhận -50 hoặc 50 (magnitude), không nhận 0.

| Biến | Mặc định | Khoảng |
|---|---:|---:|
| `TP1_PCT` | `25` | 1 .. 1000 |
| `TP1_SELL_FRACTION` | `.5` | .01 .. .99 |
| `TP2_MULTIPLE` | `2` | 1.01 .. 100 |
| `POST_TP1_STOP_PCT` | `4` | 0 .. 100 |
| `TRAILING_STOP_PCT` | `15` | .1 .. 99 |
| `EXPOSURE_WARN_PCT` | `60` | 1 .. 100 |
| `QUOTE_LOCK_TTL_MS` | `120000` | 30000 .. 300000 |
| `QUICK_FIXED_COST_ESTIMATE_SOL` | `.0021` | .00001 .. .1 |
| `QUICK_MAX_PER_HOUR` | `6` | 1 .. 60 |
| `QUICK_SIZE_MULTIPLIER` | `.2` | .01 .. 1 |
| `QUICK_MAX_FIXED_COST_PCT` | `4` | .1 .. 4 |
| `ENTRY_SCORE_QUICK` | `3` | 0 .. 10 |
| `QUICK_BUY_SELL_RATIO` | `1` | 0 .. 100 |
| `QUICK_MIN_BUYS` | `3` | 1 .. 10000 |
| `QUICK_MIN_TRADES` | `5` | 3 .. 10000 |
| `QUICK_MIN_VOLUME_SOL` | `.2` | .01 .. 10000 |
| `QUICK_MIN_CHANGE_PCT` | `-5` | -5 .. 100 |
| `QUICK_MAX_CHANGE_PCT` | `100` | 0 .. 1000 |
| `PROBE_SIZE_MULTIPLIER` | `.4` | .01 .. 1 |
| `PRE_FILTER_MIN_TRADES` | `3` | 3 .. 100 |
| `LOSS_STREAK_SOFT` | `3` | 1 .. 100 |
| `LOSS_STREAK_PROBE` | `5` | 1 .. 100 |
| `LOSS_STREAK_FACTOR` | `.5` | .01 .. 1 |
| `LOSS_STREAK_PROBE_FACTOR` | `.25` | .01 .. 1 |
| `DRAWDOWN_SOFT_PCT` | `10` | 1 .. 100 |
| `DRAWDOWN_PROBE_PCT` | `15` | 1 .. 100 |
| `DAILY_LOSS_FACTOR` | `.5` | .01 .. 1 |
| `DRAWDOWN_FACTOR` | `.5` | .01 .. 1 |
| `ENTRY_SCORE_STANDARD` | `6` | 0 .. 10 |
| `ENTRY_SCORE_PROBE` | `4` | 0 .. 10 |
| `RISK_PER_TRADE_PCT` | `2.5` | .01 .. 10 |
| `ASSUMED_WORST_LOSS` | `.5` | .1 .. 1 |
| `POOL_IMPACT_CAP_PCT` | `1.5` | .01 .. 2 |
| `MAX_ORDER_PCT_OF_WALLET` | `10` | .01 .. 10 |
| `TOTAL_EXPOSURE_CAP_PCT` | `50` | .1 .. 100 |
| `DAILY_LOSS_SOFT_PCT` | `5` | .1 .. 100 |
| `BREAKEVEN_AFTER_PCT` | `50` | 0 .. 1000 |
| `QUOTE_CACHE_TTL_MS` | `1000` | 0 .. 5000 |
| `QUOTE_MAX_AGE_MS` | `5000` | 100 .. 5000 |
| `QUOTE_MAX_ATTEMPTS` | `3` | 1 .. 3 |
| `QUOTE_MAX_CONCURRENT` | `1` | 1 .. 4 |
| `QUOTE_BACKOFF_MS` | `250` | 0 .. 5000 |
| `HOLDER_CACHE_TTL_MS` | `60000` | 1000 .. 600000 |
| `HOLDER_MAX_CONCURRENT` | `1` | 1 .. 3 |
| `HOLDER_START_INTERVAL_MS` | `10000` | 0 .. 60000 |
| `RULES_POLL_MS` | `5000` | 1000 .. 60000 |
| `RULES_MAX_CANDIDATES` | `12` | 1 .. 60 |
| `MIN_POOL_RESERVE_SOL` | `5` | 5 .. 100000 |
| `MIN_HOLDER_COUNT` | `20` | 20 .. 100000 |
| `MAX_TOP10_PCT` | `25` | 1 .. 25 |
| `MAX_DEV_PCT` | `5` | 0 .. 5 |
| `MAX_ROUNDTRIP_LOSS_PCT` | `6` | .1 .. 6 |
| `MAX_PRICE_IMPACT_PCT` | `2` | .01 .. 2 |
| `EXECUTION_BUFFER_SOL` | `.005` | .005 .. .1 |
| `MIN_ORDER_SOL` | `.0025` | .0025 .. 1 |
| `MAX_POSITIONS` | `env.MAX_OPEN_POSITIONS??10` | 1 .. 10 |
| `STANDARD_BUY_SELL_RATIO` | `1.1` | 1 .. 100 |
| `STANDARD_MIN_BUYS` | `5` | 1 .. 10000 |
| `STANDARD_MIN_TRADES` | `8` | 3 .. 10000 |
| `STANDARD_MIN_VOLUME_SOL` | `.5` | .01 .. 10000 |
| `STANDARD_MIN_CHANGE_PCT` | `0` | -2 .. 100 |
| `MAX_ENTRY_CHANGE_PCT` | `100` | 0 .. 1000 |
| `PROBE_BUY_SELL_RATIO` | `1` | 0 .. 100 |
| `PROBE_MIN_BUYS` | `3` | 1 .. 10000 |
| `PROBE_MIN_TRADES` | `5` | 3 .. 10000 |
| `PROBE_MIN_VOLUME_SOL` | `.3` | .01 .. 10000 |
| `PROBE_MIN_CHANGE_PCT` | `-2` | -2 .. 100 |
| `WASH_BUY_SELL_RATIO` | `10` | 2 .. 1000 |
| `WASH_MAX_AVG_TRADE_SOL` | `.005` | .000001 .. 10 |
| `RUNNER_STOP_PCT` | `-50` | -99 .. 99 |
| `RUNNER_MIN_OBSERVED_EVENTS` | `300` | 200 .. 100000 |
| `RUNNER_ORDER_PCT` | `.5` | .01 .. 10 |
| `RUNNER_TOTAL_CAP_PCT` | `8` | .1 .. 100 |
| `RUNNER_MAX_POSITIONS` | `10` | 1 .. 20 |
| `RUNNER_MIN_LIQ_USD` | `15000` | 1000 .. 1e9 |
| `RUNNER_LIQUIDITY_DROP_PCT` | `50` | 1 .. 99 |
| `RUNNER_MAX_SELL_SLIPPAGE_PCT` | `4` | .1 .. 4 |
| `RUNNER_TRAILING_PCT` | `35` | 1 .. 80 |
| `DORMANT_VOLUME_MULTIPLE` | `8` | 1 .. 1000 |
| `DORMANT_MIN_UNIQUE_BUYERS` | `15` | 1 .. 10000 |
| `DORMANT_MIN_CHANGE_PCT` | `15` | 0 .. 1000 |
| `DORMANT_MAX_CHANGE_PCT` | `60` | 0 .. 1000 |
| `DORMANT_MIN_BUY_SELL_RATIO` | `1.3` | 0 .. 100 |
| `DORMANT_MIN_LIQ_USD` | `15000` | 1 .. 1e9 |
| `DORMANT_MAX_TOKENS` | `64` | 1 .. 128 |
| `DORMANT_MAX_EVENTS` | `2000` | 300 .. 5000 |
| `DORMANT_CONTROL_INTERVAL_MS` | `300000` | 60000 .. HOUR |
| `DORMANT_EVENT_COOLDOWN_MS` | `HOUR` | FIVE .. 24*HOUR |
| `DORMANT_MAX_PRICE_AGE_MS` | `5000` | 1000 .. 10000 |

Boolean: SCALP_ENABLED=true (giữ trạng thái pause của ví), RUNNER_ENABLED=false, DORMANT_ENABLED=true, QUICK_ENABLED=false, KILL_SWITCH=false, PAPER_MODE=false.

REMAINDER_EXIT_MODE=trailing_or_tp2; lựa chọn trailing / tp2 / trailing_or_tp2.
MAX_POSITIONS ưu tiên alias MAX_OPEN_POSITIONS cũ. RPC_MAX_CONCURRENT=4 (2..8), QUOTE_MAX_CONCURRENT=1.

Nguồn tùy chọn: SOLANA_RPC_URL, SOLANA_RPC_FALLBACK_URLS, SOLANA_WS_URL, HELIUS_API_KEY, JUPITER_API_KEY. Không điền khóa trong git/chat. MIGRATION_SOURCE_ENABLED=true, PUBLIC_TRENDING_ENABLED=true; thiếu cấu hình hoặc nguồn lỗi thì unavailable.

Xem [revision 2](UPDATE-V54-R2.md), [dormant/RUNNER và giới hạn](DORMANT-RUNNER.md).
