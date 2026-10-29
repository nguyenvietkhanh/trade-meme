# V5.4 revision 2

## Cấu hình và kích hoạt

Giữ nguyên Volume/LIVE_ROOT/signer, không xóa ledger. BUY 24/24, kill switch thủ công,
không tự pause vì chuỗi thua. Những env đặt trên Railway ghi đè mặc định mới:

```dotenv
MAX_POSITIONS=10
RISK_PER_TRADE_PCT=2.5
ASSUMED_WORST_LOSS=0.5
PROBE_SIZE_MULTIPLIER=0.4
TOTAL_EXPOSURE_CAP_PCT=50
MAX_ORDER_PCT_OF_WALLET=10
EXPOSURE_WARN_PCT=60
TP1_PCT=25
TP1_SELL_FRACTION=0.5
POST_TP1_STOP_PCT=4
TRAILING_STOP_PCT=15
TP2_MULTIPLE=2
REMAINDER_EXIT_MODE=trailing_or_tp2
RPC_MAX_CONCURRENT=4
QUOTE_MAX_CONCURRENT=1
QUOTE_LOCK_TTL_MS=120000
KILL_SWITCH=false
```

MAX_POSITIONS ưu tiên hơn alias MAX_OPEN_POSITIONS cũ. STANDARD mục tiêu 5% SOL khả
 dụng tại thời điểm giữ vốn, PROBE 40% STANDARD; các trần pool, fee buffer, gas và
exposure vẫn có hiệu lực. Bật 10 vị thế không bảo đảm đủ điều kiện mở cả 10.
Muốn mục tiêu 10% khả dụng đặt RISK_PER_TRADE_PCT=5, ASSUMED_WORST_LOSS=0.5;
muốn cho phép tổng exposure vượt 50% phải đặt TOTAL_EXPOSURE_CAP_PCT tương ứng
(tối đa 100). Không có cửa chặn mới tại 60%; có log EXPOSURE_WARNING khi xác minh
được exposure/equity thực >60%. Vốn khả dụng thay đổi theo mỗi lệnh, không cấp 10
lần cùng một số dư ban đầu. Hệ số co = max(0.25,min(các hệ số,1)), không nhân dồn.

Giữ vốn trong bộ nhớ trước await quote, tính cả buffer/slot/exposure và mint trùng.
Giữ tới khi treasury nhận order bền vững hoặc bị loại/hết hạn. Restart làm mất hold
chưa ký; nó không phát lệnh, pending đã ký vẫn được đối soát từ ledger. Treasury đọc
lại tiền/exposure trước ký. BUY đang chờ chuẩn bị đứng sau SELL bảo vệ; I/O đang
chạy không bị ngắt. RPC dành một lane cho exit/receipt; quote một job cùng lúc.
Không retry broadcast hay giao dịch đã ký trong các queue mới.

## TP1 và thống kê

Vị thế mở mới lưu exitPolicy `rules-v5.4-tp1`: bán phần TP1 ở +25%, sau receipt
xác nhận mới đặt stop giá vào +4%. Phần còn lại trailing hoặc TP2. Modes:
`trailing`, `tp2`, `trailing_or_tp2` (cái nào chạm trước). Stop không bảo đảm giá
khớp hay PnL +4%. Vị thế cũ giữ nguyên exitPolicy; không áp TP1 vào lệnh đã ký cũ.

RULES FILL log tier, positionId, giờ UTC, network fee, actual-vs-quote slippage,
PnL cash khi đóng. Slippage đã nằm trong kết quả khớp, không trừ lần hai. Cash PnL
= tổng debit/credit thực của vị thế, gồm network fee và tiền thuê ATA; rent còn
khóa được báo riêng. Legacy thiếu cashflow/quote thì null, không tự suy đoán.
`rules.performance` trong state/export nhóm theo bậc/giờ; win rate tính vị thế
đóng, TP1/stop rate chỉ trên vị thế đóng có policy TP1. API/model cost không có
chứng từ on-chain không cộng giả vào PnL. Kho dữ liệu chỉ bao phủ fills đang giữ.

## Phễu giờ và baseline

`RULES FUNNEL` in khi khởi động và mỗi 5 phút: currentHour và lastCompletedHour
UTC, discovery_seen (quan sát feed), seen (ứng viên đưa vào rules), pre_filter,
safety, signalByTier, quote, sent và topSkips. Sent là lần đã vào đường broadcast,
không đồng nghĩa fill xác nhận. Một token có thể lặp nhiều vòng; uniqueDiscovered
là thống kê session có giới hạn. Dữ liệu lịch sử thiếu không điền 0 giả. Không có
bằng chứng uptime liên tục thì continuousHourVerified=false.

Xuất sổ trên dashboard hoặc `/api/export` (cần xác thực chủ); đọc `hourlyFunnel`.
Có thể chạy `node scripts/report-hourly-funnel.js <export.json>` để chỉ in báo cáo
phễu. Không gửi .env/khóa. Môi trường phát triển chưa có log/Volume Railway nên
chưa thể đưa số liệu một giờ LIVE hiện tại. Những mẫu ledger V5.2 cũ chỉ dùng test.
Các ngưỡng mới trong revision này là yêu cầu cấu hình trực tiếp sau đó của chủ,
không phải ngưỡng được suy ra là tối ưu từ dữ liệu một giờ.

## Nguồn ứng viên và cảnh báo

DexScreener token-boosts/top/v1: <=1 lần/phút, tối đa 30 mint; boosts có thể mua,
không có nghĩa token chất lượng. Các nguồn profile/new pools hiện có vẫn chạy.
Chỉ thêm ID vào DiscoveryQueue; lấy giá, hard filters và quote như mọi token khác.

Migration: SOLANA_WS_URL phải là wss://, RPC hỗ trợ logsSubscribe; thêm SOLANA_RPC_URL
HTTPS riêng hoặc HELIUS_API_KEY cho getParsedTransaction confirmed. Không hardcode key.
MIGRATION_SOURCE_ENABLED=false tắt riêng; PUBLIC_TRENDING_ENABLED=false tắt trending.
Listener dùng program/discriminator/account schema từ @pump-fun/pump-sdk đã khóa
version. Chỉ nhận migrate/migrateV2 giao dịch thành công; tối đa 32 receipt chờ,
1 receipt/3s, backoff 30s khi lỗi. Không dựng pool/price từ tên sự kiện. Không
có key/source lỗi: unavailable; subscription chưa nhận sự kiện: subscribed_unconfirmed.
Đây là live stream, không tuyên bố backfill hoặc phủ hết migration trong downtime.

Telegram dùng outbox hiện có khi RPC/signer lỗi hoặc monitor/worker heartbeat quá
60s trong lúc có vị thế; mã cố định, dedupe 5 phút. Nếu server chết hẳn hoặc Telegram
cũng lỗi thì cảnh báo trong process không thể gửi; cần monitoring ngoài nếu muốn
phát hiện trường hợp đó.

## QUÉT NHẸ

QUICK_ENABLED mặc định false, giữ tắt để chờ baseline theo yêu cầu trước. Có thể bật
riêng sau khi đọc báo cáo. QUICK: điểm >=3, ratio >=1, BUY >=3/trade >=5, volume >=.2,
5m -5..100%; QUICK_SIZE_MULTIPLIER=.2; sàn MIN_ORDER_SOL chỉ khi không vượt giới hạn
vốn, pool và exposure. QUICK_MAX_PER_HOUR=6 là số lần cấp đường gửi BUY theo giờ UTC,
bao gồm trường hợp gửi không biết kết quả; persist trên ledger, không đặt lại khi
restart. Không retry để vượt quota. Chi phí cố định ước tính bảo thủ trước quote
QUICK_FIXED_COST_ESTIMATE_SOL=.0021; trước ký kiểm tra debit simulation ngoài notional
cộng network fee dự kiến chiều ra <= QUICK_MAX_FIXED_COST_PCT=4. Bao gồm rent để
không lờ chi phí cố định ở ví nhỏ. Phí tương lai có thể đổi, không bảo đảm tuyệt đối
4% thực tế. QUICK vẫn chịu toàn bộ chặn cứng, không lấy funding clusters unknown
làm chứng nhận an toàn.
