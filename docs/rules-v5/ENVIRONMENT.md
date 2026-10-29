# Biến môi trường Rules V5.4

Đặt trong Railway → service trade-meme → Variables. Bỏ trống dùng mặc định.
Các biến hậu tố PCT là phần trăm; ASSUMED_WORST_LOSS là tỷ lệ (0.5 = 50%).
Giá trị sai khoảng sẽ dừng khởi tạo với INVALID_RULES_CONFIG.

| Biến | Mặc định | Khoảng cho phép |
|---|---:|---:|
| `PROBE_SIZE_MULTIPLIER` | `1/3` | .01 .. 1 |
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
| `RISK_PER_TRADE_PCT` | `1.5` | .01 .. 10 |
| `ASSUMED_WORST_LOSS` | `.5` | .1 .. 1 |
| `POOL_IMPACT_CAP_PCT` | `1.5` | .01 .. 2 |
| `MAX_ORDER_PCT_OF_WALLET` | `10` | .01 .. 10 |
| `TOTAL_EXPOSURE_CAP_PCT` | `30` | .1 .. 100 |
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
| `MAX_OPEN_POSITIONS` | `5` | 1 .. 5 |
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

`KILL_SWITCH=false`: bật true chặn BUY thủ công, SELL bảo vệ vẫn chạy.
`PAPER_MODE=false`: mặc định LIVE theo cấu hình triển khai; true chạy paper,
không quản lý vị thế LIVE. Không bật paper để thử khi cần bot tiếp tục bảo vệ vị thế thật.
`TRADING_MODE=paper` cũ vẫn được tôn trọng nếu được đặt rõ ràng.

`SOLANA_RPC_URL` tùy chọn HTTPS RPC riêng; `SOLANA_RPC_FALLBACK_URLS` danh sách HTTPS
ngăn bởi dấu phẩy. `HELIUS_API_KEY` hiện có vẫn dùng được. `JUPITER_API_KEY` tùy chọn,
chỉ gửi x-api-key đến host Jupiter chính thức. Không đưa key vào log hoặc git.

`RULES_EVIDENCE_URL` là adapter nghiên cứu ngoài tùy chọn (HTTPS, công khai mint/pool),
không phải dịch vụ dựng sẵn. Giữ nguyên LIVE_ROOT và signer đã cấu hình.
Các tham số mới đều có mặc định nên không bắt buộc thêm biến để rollout.
