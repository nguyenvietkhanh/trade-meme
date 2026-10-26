> Scanner error diagnostics: API ERROR lines/CSV now include safe error code,
> stage (gamma/metadata/YES book/NO book) and attempts. Temporary Chrome connection
> failures get bounded GET-only retries; 403/challenges do not. Three consecutive
> market API failures still stop. Data skips break that consecutive-failure count.
> Launcher no longer labels every scanner failure CHROME_START_FAILED.

> Cập nhật log: mỗi vòng in RESULTS/BLOCKS (NO_EDGE, SKIP_DATA và lý do riêng).
> Discovery tiếp tục từ raw offset đã đọc thay vì luôn bắt đầu ở 50 market đầu;
> offset vẫn best effort khi Gamma thay đổi thứ tự. Mẫu public bị chặn lưu ở
> `data/skip_samples/`, tối đa 100 mẫu duy nhất trong mỗi phiên. Ngưỡng phí và
> book-age/skew không nới lỏng. estimates=0 không được hiểu là mọi market đã tính edge.

> Cách chạy mới cho Windows: xem [BROWSER.md](BROWSER.md), bấm `start_browser.bat`.
> Dùng Chrome cài sẵn để đọc market/book; vẫn chỉ đọc, không giữ khóa hoặc gửi lệnh.
> Chưa xác nhận kết nối trên máy người dùng; không tự vượt CAPTCHA/HTTP 403.

> Cập nhật transport: Windows mặc định dùng curl.exe --ipv4 để đọc public APIs,
> theo lệnh người dùng đã kiểm tra thành công. Backend này chỉ GET, không nhận khóa,
> không nhận auth headers và không dùng cho giao dịch thật. SSL verification bật;
> không theo redirect; không thay proxy/network policy. SDK public books cùng backend.
> IPv4 Python fallback giờ cũng buộc socket.AF_INET, thay vì chỉ bind địa chỉ nguồn.
> Chạy `verify.bat --api-only --backend curl` để kiểm tra trên máy của bạn.

> Sửa kết nối IPv4: curl -4 đã thành công trên máy người dùng. Scanner và verifier
> giờ dùng HTTPS bind IPv4, giữ nguyên hostname/SNI, kiểm chứng TLS và proxy hệ thống.
> Không tắt IPv6 Windows. FORCE_IPV4=true mặc định; đặt false dùng transport hệ thống.
> Bản kiểm tra mới đọc thêm order book hai chân khi Gamma trả market hợp lệ.
> Chưa xác nhận Python kết nối thành công trên máy người dùng sau thay đổi này.

> Cập nhật 26/10/2026: đã đọc tài liệu migration từ báo cáo local; sửa chọn ID theo
> `version` (v2 dùng positionIds, v1 dùng clobTokenIds). Gamma/CLOB local vẫn lỗi.
> Để chẩn đoán nhanh chạy `verify.bat --api-only` (Windows) hoặc
> `python3 local_verify.py --api-only`; báo cáo mới phân loại DNS/TLS/timeout/HTTP.
> Không tắt TLS hoặc dùng proxy/VPN để vượt hạn chế truy cập.

# Polymarket arbitrage — giai đoạn 1, chỉ đọc

Python 3.11+. Dự án độc lập với bot Solana cũ; không sửa hoặc deploy service cũ.
**Không có giao dịch thật, ký lệnh, approve, wrap, merge hoặc paper fill.**
`DRY_RUN=true` là mặc định; `DRY_RUN=false` bị từ chối ngay. Không cung cấp private key.

## Trạng thái xác minh (26/10/2026)

- Host cố định `https://clob.polymarket.com`, chain 137. Danh sách lấy từ
  `https://gamma-api.polymarket.com/markets`. Runtime chỉ truy cập hai host này.
- Đã kiểm tra package **chính thức** `py-clob-client-v2==1.2.1` trên PyPI và đọc
  mã phí trong wheel. Không dùng package legacy `py-clob-client`.
- PyPI hiện đánh dấu package V2 deprecated, đề nghị SDK hợp nhất. Vẫn giữ package
  bạn yêu cầu; cần đánh giá lại trước bất kỳ bước live nào, không tự đổi SDK.
- Đã đọc snapshot tài liệu API/contract/SDK migration và fees do người dùng lấy
  từ máy local (HTTP 200 trong báo cáo). Gamma/CLOB ở local vẫn lỗi URLError;
  môi trường phát triển vẫn bị proxy 403. Chưa có live book/market fixture.
- **Mọi kết quả hiện là `ESTIMATE_UNVERIFIED_DOCS`**, không phải cơ hội production
  được xác nhận. Schema bất đồng hoặc phí thiếu => SKIP, không mặc định phí 0.
- WebSocket chưa triển khai vì chưa xác minh được protocol. REST có pacing,
  timeout, backoff, tuổi book và độ lệch hai book. Đây không phải HFT.

## Cài và chạy

```bash
cd /workspace/polymarket-arb
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python -m polymarket_arb.main
```

Chạy lặp:

```bash
INTERVAL=30 MAX_MARKETS=50 python -m polymarket_arb.main --loop
```

Cấu hình nằm trong process environment. Có `.env.example`, không tự đọc `.env`
để tránh nạp khóa ví ngoài ý muốn. Với Bash, file mẫu do chính bạn quản lý có thể
nạp bằng:

```bash
cp .env.example .env
set -a
source .env
set +a
python -m polymarket_arb.main --loop
```

Không source file không tin cậy. `.env`, `.venv`, dữ liệu và STOP đã gitignore.
Stage 1 không đọc `PRIVATE_KEY`, không tạo credential, không gọi endpoint order.
Tạo `STOP` trong thư mục chạy để dừng. Ctrl+C cũng dừng được. Khi request đang
chờ, dừng sau timeout tối đa 10 giây; backoff/interval kiểm tra STOP mỗi giây.

## Bộ lọc và cấu hình

| Biến | Mặc định | Ý nghĩa |
|---|---:|---|
| MIN_LIQUIDITY | 10000 | `liquidityNum` Gamma, USD |
| MIN_VOLUME | 10000 | `volumeNum` Gamma, tổng volume USD; không phải 24h |
| MIN_EDGE_PCT | 0.5 | Lãi dự kiến / payout của cặp × 100, không phải ROI trên vốn |
| SLIPPAGE_BPS | 20 | Buffer bổ sung trên chi phí mua đã quét depth |
| MAX_USD_PER_TRADE | 25 | Ngân sách ước tính cho cả hai chân, gồm phí/buffer |
| INTERVAL | 30 | Giây giữa các vòng, không chạy vòng chồng lấn |
| MAX_BOOK_AGE / MAX_BOOK_SKEW | 10 / 2 | Tuổi book tối đa / độ lệch timestamp hai chân, giây |
| REQUEST_SPACING | 0.25 | Giây tối thiểu giữa các request, không phải cam kết rate limit của sàn |
| MAX_MARKETS / MAX_PAGES | 50 / 10 | Giới hạn số market đạt lọc / số trang Gamma 100 market |
| RETRIES | 3 | Số retry sau lần đầu, chỉ lỗi transport/429/5xx tạm thời |
| OUTPUT_DIR / STOP_FILE | data / STOP | Nơi lưu kết quả / kill switch |
| DRY_RUN | true | false bị từ chối trong giai đoạn 1 |
| MAX_OPEN_EXPOSURE / DAILY_LOSS_LIMIT | 100 / 10 | Chỉ unit test hàm risk cho giai đoạn sau; scanner không có ví/PnL |

Chỉ nhận market active, chưa đóng, nhận lệnh, có order book, đúng hai outcome
YES/NO và `negRisk=false` rõ ràng trong Gamma. Ghép token theo tên outcome,
không dựa vào thứ tự. Loại ngược thứ tự token/condition, book stale/future,
book thiếu min size, thiếu metadata phí hoặc kiểu dữ liệu sai.
Pagination hiện bị giới hạn và theo thứ tự Gamma trả về; **không phải toàn bộ
thị trường**, không có cam kết luôn tìm được mọi cơ hội.

## Cách tính

Theo hàm `fees.adjust_buy_amount_for_fees` trong SDK V2 1.2.1:

```text
fee_per_share(p) = r × [p × (1 − p)]^e
fee_leg = tổng(q_mức × fee_per_share(p_mức))
```

Lấy `r` và `e` bắt buộc từ `fd` của `/clob-markets/{condition_id}`;
không suy ra từ tên category, không dùng `base_fee` V1 thay thế. Rate 0 chỉ hợp lệ
khi API trả số 0 rõ ràng. Không gắn builder nên chưa tính builder attribution fee.
Docs migration ghi BUY fee cộng vào collateral spend; SELL fee trừ khỏi proceeds.
Docs fees ghi precision 5 chữ số; estimator dùng ceiling bảo thủ, chưa mô phỏng
rounding từng maker fill. Chưa xác minh bằng receipt thật; kết quả vẫn là ước tính.

1. Sắp xếp asks tăng dần, gộp mức trùng; quét đồng thời hai depth theo cùng số shares.
2. Chỉ lấy tranche mà `1 − giá YES − giá NO − phí − buffer` đạt ngưỡng.
3. Giới hạn bằng depth từng chân, ngân sách cả cặp, min size order book.
4. Phí từng chân ước tính bảo thủ làm tròn lên 0.00001 (docs: precision 5 chữ số); số shares ước tính làm tròn xuống cùng
   độ chính xác. Đây là lựa chọn bảo thủ của estimator, **chưa phải lot rule đã xác minh**.
5. `expected_payout = số cặp`, giả định redeem mỗi bộ đầy đủ được 1 collateral;
   `profit = payout − cost`; `edge_pct = profit / payout × 100`.

Depth walk đã tính price impact; SLIPPAGE_BPS là buffer cho biến động/latency bổ sung.
Dừng ở tranche không đạt edge: cố ý bảo thủ, không tối ưu toàn cục khi đường phí
không đơn điệu. `max_size` chỉ là số cặp đạt ngưỡng trong ngân sách/snapshot,
không phải khả năng khớp hay kích thước tối đa của cả thị trường.
Chi phí gas merge/redeem, funding opportunity cost, thời gian đến resolve và
rủi ro kết quả invalid/challenged chưa được định giá. Không gọi đây là lợi nhuận chắc chắn.

## Dữ liệu và bảng kết quả

`data/scans.sqlite3` và `data/scans.csv` lưu timestamp UTC, market/condition,
trạng thái, best asks, depth mỗi chân, size, VWAP, phí, buffer, edge, chi phí,
payout/lãi **dự kiến**, timestamp từng book và tham số phí. Top 10 sắp theo
lãi dự kiến của size được giới hạn. SQLite là bản chính; crash giữa commit và CSV
có thể làm CSV thiếu dòng, không ảnh hưởng tiền vì scanner không giao dịch.
Market title được lọc control character khi in, escape formula injection khi ghi CSV.

`NO_EDGE` cũng ghi diagnostic ở depth/ngân sách khảo sát; `max_size=0`,
`evaluated_size` là size khảo sát. `SKIP_DATA` nghĩa là không đủ cơ sở tính edge;
ô trống **không phải phí hoặc edge bằng 0**. Market bị loại ở Gamma chưa vào scan log.
Ba market liên tiếp lỗi API sẽ dừng; lỗi quét danh sách Gamma dừng vòng chạy,
không tiếp tục vô hạn với dữ liệu cũ. Retry GET có backoff+jitter và Retry-After
số giây, chặn redirect. Không thử tìm host thay thế hoặc bypass proxy.

## Dependency và nguồn gốc

`requirements.txt` pin toàn bộ dependency đã resolve; các import runtime SDK
được khai báo tường minh vì wheel 1.2.1 thiếu `Requires-Dist`. Không cài package
legacy `py-clob-client`. Xem [danh sách mục đích từng dependency](docs/dependencies.md).
Các thư viện ký/Ethereum được SDK import, nhưng scanner không khởi tạo signer
và không nhận khóa. Tests dùng `unittest` stdlib; không cần dịch vụ ngoài.

## Wrap USDC.e → pUSD: chưa mở chức năng

**Chưa có hướng dẫn approve/wrap có thể thực thi trong bản này.** Không có địa
chỉ contract, spender hoặc calldata phỏng đoán. Trước giai đoạn 3 phải đọc được
[tài liệu chính thức](https://docs.polymarket.com), tìm `v2-migration` và API,
đối chiếu địa chỉ Polygon chain 137, decimals, allowance/spender, wrap/redeem và
cơ chế fee của phiên bản production. Sau đó mới viết hướng dẫn và transaction.
Không gửi tiền/approve theo ví dụ hoặc token address trong package cũ.

Bản nháp network của môi trường đã thêm `docs.polymarket.com`,
`gamma-api.polymarket.com`, `clob.polymarket.com`; **Review/Save rồi Publish**
mới áp dụng quyền truy cập, không phải deploy Railway. Đây là giới hạn môi trường
phát triển, không phải yêu cầu nạp tiền hay cấp private key.

## Ranh giới các giai đoạn

- **1:** Scanner hiện tại + unit tests. Chờ xác minh tài liệu và live read.
- **2:** Chưa triển khai. Sau khi bạn đồng ý: paper broker, latency hai chân,
  leg risk, fills từ book, inventory và PnL sau phí. Không dùng snapshot tĩnh làm
  bằng chứng chắc chắn khớp được cả hai chân.
- **3:** Chưa triển khai, chỉ sau khi bạn xác nhận kết quả paper. Cần kiểm tra
  pUSD, approve/wrap đúng docs, giới hạn exposure/lỗ, kill switch, xử lý một chân,
  ký hai lệnh không nguyên tử và khôi phục trạng thái bất định. Bật môi trường
  không được tự bỏ qua bước xác nhận này.
