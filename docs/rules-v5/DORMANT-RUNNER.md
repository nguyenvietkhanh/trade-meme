# Dormant breakout và RUNNER

SCALP giữ logic và trạng thái BUY hiện có. SCALP_ENABLED mặc định true, không tự
resume ví đang pause. RUNNER_ENABLED mặc định false; không có code tự bật cờ này.
KILL_SWITCH và pause BUY thủ công áp dụng cả hai; SELL vị thế đã mở vẫn được theo dõi.
Không đổi exitPolicy của SCALP hoặc vị thế cũ khi thêm RUNNER.

## Ghi nhận dormant (không gửi lệnh)

DORMANT_ENABLED mặc định true, độc lập RUNNER. Các điểm volume 5m được giữ tối đa
302 bucket/token, tối đa 64 token (có thể cấu hình tới 128). Nền 6h cần 72 cửa sổ
5m trước cửa sổ hiện tại; nền 24h cần 24 cửa sổ 1h trước cửa sổ hiện tại. Không lấy
volume hiện tại chia 72 để dựng nền. Lúc mới bật có thể cần hơn 6h/24h để có tỷ lệ.
Giá so với high 4h/24h dựa các high quan sát; có coverage, không coi là OHLCV đầy đủ.

Các field được ghi gồm volume nền/tỷ lệ, unique buyers và 3 cửa sổ 1m (khi confirmed
flow đủ coverage), buy/sell, average trade, giá USD/SOL, high, thanh khoản, quote
mint, top10/dev, LP và authority. Dữ liệu safety dùng cache xác minh có sẵn; field
chưa có nguồn xác minh là null. Luồng flow riêng chỉ phục vụ nghiên cứu, không
inject vào context SCALP; đọc nền có giới hạn, ưu tiên thấp hơn SELL. Distinct
buyers không chứng minh 15 người độc lập hoặc ví lần đầu mua trong đời.

Ngưỡng mặc định: volume5m >=8x, >=15 unique buyers, giá5m +15..60%, ratio >=1.3,
liquidity >=15000 USD. DORMANT_* điều chỉnh được. Event và control ngẫu nhiên lấy
trong cùng lần tick/khung giờ; control cần đủ dữ liệu để xác định không breakout.
Không chọn token thiếu baseline làm control giả. Có cooldown event riêng 1h/mint
để không đếm cùng pump mỗi giây; đây không phải cooldown hay nghỉ BUY của bot.

Labels 5/15/30/60 phút: sampled high/low/end, thứ tự barrier quan sát +25/-20,
coverage/gaps. Giá cuối phải là giá thật mới ở horizon (grace 10s); thiếu thì null,
không forward-fill. Không có tick-by-tick đầy đủ thì barrier chỉ là observed,
không tuyên bố backtest chính xác. Thống kê event/control theo thresholdId riêng.

Giữ tối đa 2000 event/control, state công khai tại `<LIVE_ROOT>/dormant-state.json`,
checkpoint bất đồng bộ 60s; research journal bounded ghi event/label. Restart có thể
mất đoạn cuối chưa checkpoint, không ảnh hưởng sổ tài chính. `/api/export` có
`dormant`; `/api/export?format=dormant-csv` xuất event/label với toàn bộ feature JSON
trong cell CSV (cần phiên xác thực chủ). Không gửi khóa hoặc raw signed transaction.

Pair PUMP/quote khác SOL không bị loại khỏi nghiên cứu vì reserve SOL null:
ưu tiên reserve quan sát + tỷ giá quote mới; nếu chỉ có TVL USD thì dùng TVL/2/SOLUSD
làm **ước tính** quote-side SOL, gắn cờ rõ. Không gán con số ước tính đó vào hard
safety/executable reserves. Execution non-SOL chưa xác minh đầy đủ thì vẫn bị chặn.

## RUNNER chỉ bật bằng env sau khi có dữ liệu

```dotenv
RUNNER_ENABLED=false
RUNNER_MIN_OBSERVED_EVENTS=300
RUNNER_ORDER_PCT=0.5
RUNNER_TOTAL_CAP_PCT=8
RUNNER_MAX_POSITIONS=10
RUNNER_MIN_LIQ_USD=15000
RUNNER_STOP_PCT=-50
RUNNER_LIQUIDITY_DROP_PCT=50
RUNNER_MAX_SELL_SLIPPAGE_PCT=4
RUNNER_TRAILING_PCT=35
```

Cần >=300 event quan sát của threshold hiện tại (minimum env cho phép 200), một
breakout mới <=60s và kiểm tra an toàn độc lập trước quote và trước ký. Top10 <=25%,
dev <=5%, holder/reserve/program/authority đúng, không có dev sell/bundle đã thấy,
LP khóa/đốt phải được chứng minh. Adapter on-chain hiện chứng minh LP **đã đốt hết**
khi supply LP mint bằng 0; khóa LP trong dịch vụ khác chưa có decoder xác minh sẽ
để unknown và **chặn RUNNER**, không giả định đã khóa. Cấu hình true không bảo đảm
có lệnh. Các test dùng fixture không phải 300 event production.

Size =0.5% cash khả dụng x hệ số riêng; <=1% reserve SOL pool; group exposure <=8%
equity cơ sở, <=10 position. Không ép nâng lên MIN_ORDER_SOL nếu vượt ngân sách.
Chi phí cố định qua simulation + network chiều ra ước tính <=4%; rent tính bảo thủ.
Ví nhỏ thường không đủ min/chi phí, sẽ không mua. Shared-wallet gas và cash lock
vẫn chặn tiêu trùng; không có ví ảo hay cùng một SOL chi hai nhóm.

SCALP exposure chỉ đếm SCALP, RUNNER chỉ đếm RUNNER; giá trị/cost chuyển vào RUNNER
và PnL RUNNER được trung hòa trong equity phục vụ phanh SCALP. Cash để đặt lệnh vẫn
là cash thật còn trong ví nên không thể bỏ qua vốn RUNNER đang sử dụng. PnL/loss
streak SCALP không đếm fill RUNNER. RUNNER net realized+marked loss >40% tổng vốn
đã cấp thì size RUNNER x0.5, không pause theo giờ, không kích hoạt phanh SCALP.

RUNNER không có time exit 90m. Stop -50%, liquidity giảm >50% so với entry thì lệnh
thoát bảo vệ. Tranches 50/25/15% **raw quantity ban đầu** ở 2x/5x/10x; 10% còn lại
trail 35% từ peak sau khi ba tranche đã được bán xác nhận. Mỗi lần chỉ gửi phần độ
sâu hiện tại cho phép (CPMM bound dùng nửa budget slippage, quote cap không quá 4%).
Phần chưa bán vẫn còn; receipt mới tăng tranche sold. Thiếu depth thì log và giữ
pending nhu cầu thoát, không đánh dấu đã bán hoặc tự bỏ slippage cap. Điều này cũng
có nghĩa pool cạn có thể không thoát được; stop không bảo đảm giá khớp.

SELL rechecks pool depth và quote trước ký; unsigned SELL được ưu tiên trước BUY
chờ. Không ngắt broadcast đang chạy, không tự phát lại giao dịch đã ký. Tắt
RUNNER_ENABLED sau khi có position chỉ tắt entries; exits vẫn hoạt động.

`RUNNER SELL_PLAN`, `RUNNER FILL`, state/export `runner`, trade `group` và
`runnerDetails` ghi detection/entry/peak, time-to-2/5/10x, raw tranches, real
slippage, fees, cash PnL. Hit rate trên position đóng; partial SELL không làm tăng
số win. Marked/realized drawdown được ghi riêng, chỉ qua các giá quan sát hợp lệ.

## OOM và rate-limit trong log thực

Đoạn log user 29/10/2026 10:13:45–10:16:33 VN có 17 dòng quote: 1 impact >2%,
15 rate_limited, 1 quote pass; không phải funnel đủ 1h và không chứng minh có fill.
Có V8 OOM ~467 MiB heap, sau đó khởi động lại. Không có heap snapshot nên chưa
khẳng định một nguyên nhân duy nhất.

Bản sửa: provider backoff dừng ladder theo nguồn thay vì thử tiếp mọi size;
shared GET consume body một lần có giới hạn 8MiB, không tạo unread Response.clone
tee; SDK/Anchor dùng một client/RPC; IPC snapshot/book/state giữ latest với
backpressure, không coalesce financial requests/replies. `RUNTIME MEMORY` mỗi 60s
để đối chiếu sau rollout. Không tăng heap để che lỗi. Test stress giới hạn heap
192MiB đạt không thay thế kiểm chứng Railway RAM thực.
