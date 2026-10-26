# AI Polymarket local — headless-status-v5

AI River chọn BUY YES / BUY NO / SELL / HOLD. Đây là giao dịch dự đoán theo
xác suất, không phải arbitrage bảo đảm lợi nhuận. SDK chính thức được pin ở
`polymarket-client==0.14.0`, Polygon 137. Mặc định `DRY_RUN=true`.

## Cập nhật bản đang chạy trên Windows

Đóng chương trình và Chrome do chương trình mở. Từ ZIP mới chép đè:

- `ai_bot.py`
- `news_check.py`
- `check_news.bat`
- Toàn bộ thư mục `polymarket_arb` (gộp vào đúng thư mục cũ, chọn Replace).

Giữ nguyên `.env.ai`, `.venv` và journal ngoài thư mục tải về. Không có dependency
mới; không cần cài lại để cập nhật từ derive-existing-v3.

Cài lần đầu: Python 3.11+, Google Chrome, chạy `setup_ai.bat`, điền `.env.ai`
trên máy bạn. Khóa signer phải là EVM owner của đúng API wallet; không dùng seed
phrase hoặc khóa Solana. API River khác khóa signer. Không gửi file hoặc keys
vào chat. Không nạp vào địa chỉ website ghi “for API use only”.

## Tin tức thật được đưa vào model như thế nào

Theo yêu cầu bổ sung nghiên cứu, bản này mở thêm **news.google.com** ngoài
Polymarket, RPC Polygon và River. Chỉ câu hỏi market công khai được gửi trong
query RSS Google News. Không cần API key tin tức và không gửi wallet, chữ ký,
credentials CLOB hoặc River tới Google.

RSS được lấy qua Chrome profile riêng, GET đúng `/rss/search`, TLS bật, không
đi theo redirect. Chặn credentials CLOB ở origin khác; không mở article link
hoặc URL do token/model cung cấp. Không vượt CAPTCHA hay 403. RSS lỗi thì báo
UNAVAILABLE/HTTP_..., không giả tạo tin.

Mỗi item có title, nhà xuất bản do RSS báo, URL Google News, published_at,
retrieved_at và source ID. Chỉ giữ headline liên quan từ khóa market, đăng trong
24h và không ở tương lai; tối đa 5 headline/market, 3 market mỗi lần gọi AI
(cộng ưu tiên vị thế bot đang giữ). Cache 10 phút; lỗi cache 1 phút.

**Chỉ đọc tiêu đề RSS, không đọc toàn văn bài báo và không xác minh độc lập tính
đúng của tin.** Hai publisher_host khác nhau là điều kiện trích dẫn tối thiểu,
không chứng minh hai bên độc lập về sở hữu hay tin đúng. Headline có thể thiếu
ngữ cảnh, giật tít hoặc mâu thuẫn; xác suất AI vẫn có thể sai.

AI được nhận đúng nguồn đã thu thập, thời gian và luật resolution. Không được
nhận khóa ký hoặc tự điều hướng web. Mọi headline/mô tả là dữ liệu không tin cậy,
không phải lệnh. BUY mặc định cần dẫn source IDs đúng market, còn mới, từ ít nhất
hai publisher_host. IDs giả, sai market, quá hạn bị từ chối. BUY không dẫn đủ
nguồn chuyển thành HOLD. SELL vị thế bot có thể dựa trên rủi ro/giá khi không có
tin mới. Luật confidence/edge/min-size/depth/fee vẫn áp dụng; không ép BUY.

NEWS_RESEARCH_ENABLED=true là mặc định dù file cấu hình cũ chưa có dòng này.
Tắt rõ ràng bằng false sẽ quay về phân tích market-only và bỏ gate hai nguồn.
Không coi chế độ market-only là có nghiên cứu tin tức.

## Kiểm tra rồi bật tiền thật

1. Chạy `check_news.bat`: chỉ kiểm tra RSS, không đọc `.env.ai`, không gọi model,
   không nạp signer hay account. Có thể đổi query qua `news_check.py --query`.
2. Giữ DRY_RUN=true và chạy `check_account.bat` để đọc tài khoản. Tài khoản hiện
   có dùng GET derive API key, chữ ký L1 do SDK tạo local; không POST tạo key lại.
   Xác minh OWNER, chain 137 và contract code của đúng ví trực tiếp trên Polygon.
   Ví EOA hợp lệ không yêu cầu code; ví contract chưa triển khai bị chặn.
3. `start_ai.bat` chạy dry-run. Có gọi River và mất credit API, không ký order hay
   gửi order. Chrome chạy ẩn mặc định; giữ CMD mở hoặc thu nhỏ, không đóng CMD.
4. Để chạy thật sau khi đã chủ động chọn: trong `.env.ai` đặt **DRY_RUN=false**,
   lưu file, chạy **start_ai_live.bat** (có `--live`). Cả env và cờ CLI đều phải bật.

Banner phải có `revision=headless-status-v5`, `browser=HIDDEN` và `mode=LIVE` khi bật tiền thật (browser=VISIBLE nếu chủ động bật giao diện chẩn đoán).
`NEWS` báo nguồn; `SOURCE` liệt kê nguồn AI dẫn. `ORDER ... CONFIRMED` chỉ xuất
hiện khi SDK settlement và biến động cash/shares được đối soát. `ACCEPTED` không
được hiểu là đã khớp. Dry-run in DRY_RUN_NO_ORDER_SIGNED_OR_SENT.

Mỗi vòng mặc định 180 giây; tối đa 24 lần gọi model/ngày UTC. Đạt giới hạn thì
chương trình dừng, không tự đóng vị thế. Có thể sửa MAX_MODEL_CALLS_PER_DAY trong
cấu hình (1–1000). Credit River tách khỏi vốn giao dịch; RSS không cần key riêng.

## Vốn, order và journal

Cash được đọc động từ CLOB; không hardcode số dư. AI chọn số tiền trong giới hạn.
Tổng BUY đã xác nhận cộng reservation đang chờ tối đa **7 USD cả đợt test**;
SELL/lãi không làm mới ngân sách, nạp thêm không tự nâng trần. MAX_USD_PER_TRADE
là trần lệnh, không phải cỡ lệnh cố định. Đây là guard phần mềm/SDK max_spend,
không phải quyền chi tiêu bất biến trên chain; owner/allowances có quyền rộng hơn.

Không tự approve/wrap/deploy/redeem/chuyển tiền. Thiếu allowance thì chặn. Không
dùng tài khoản để trade thủ công đồng thời với bot. Vị thế ngoài bot không được
tự nhận quản lý. Không có exchange-resident stop-loss; DAILY_LOSS_LIMIT mặc định
1 USD dùng realized PnL UTC để khóa BUY mới, không bảo đảm chặn unrealized loss.

Chỉ FOK. Quotes được lấy lại sau model. Lưu signed intent + cap và SENDING trong
SQLite synchronous=FULL trước gửi. Payload được transport cấp một lần; không
retry POST order khi timeout. UNKNOWN/delayed thiếu fill giữ reservation và dừng;
chưa có công cụ tự sửa journal. Giữ nguyên trạng thái và kiểm tra tài khoản,
không xóa sổ để thử lại. Tiny remaining shares có thể không đủ min-size để SELL.

Windows journal: `%LOCALAPPDATA%\PolymarketAITest\<wallet>\ledger.sqlite3`.
Linux: `~/.local/share/PolymarketAITest/<wallet>/ledger.sqlite3`.
Khóa một tiến trình/ví. Đổi Downloads không reset vốn. Marker còn mà DB mất thì
chặn tạo lại. NEWS_RESEARCH và AI_DECISION lưu bằng chứng/citation phục vụ đối
chiếu. Ledger chứa signed orders: không gửi journal riêng tư vào chat.

Ctrl+C hoặc file STOP trong thư mục app dừng vòng chạy, không hủy transaction đã
gửi hoặc tự bán vị thế. Khi chương trình đóng, vị thế đang mở tiếp tục có rủi ro.

## Kết quả kiểm thử và giới hạn xác minh

116 unit tests đã qua; Chromium offline fixture đã kiểm tra public RSS, auth
headers không sang Google, nội dung private không hiển thị và chặn replay order.
Tài khoản người dùng đã đọc thành công số dư và gọi River HOLD ở
bản trước. RSS cũng đã đọc được trên máy người dùng ở bản v4. **Chưa kiểm chứng chế độ ẩn trên Windows của người dùng hoặc BUY/SELL tiền thật.**
Không gọi model/đặt order thật bằng keys của người dùng trong quá trình phát triển.

SDK transport + derive bootstrap được inject có giới hạn trong factory lock,
pin đúng 0.14.0; không thay URL/crypto SDK. Thay SDK version thì phải review lại.
Trang “Local SDK bridge: private data is not displayed.” là bình thường. Gửi các
dòng SDK NETWORK/HTTP/STOPPED khi gặp lỗi; không gửi response body hoặc secrets.

## Chrome ẩn và tiến độ vòng quét

`BROWSER_HEADLESS=true` là mặc định kể cả `.env.ai` cũ chưa có dòng này. Vẫn dùng
Chrome đã cài, TLS và chính sách API như trước; không bật stealth hoặc vượt
CAPTCHA/403. Đặt false nếu cần mở cửa sổ để chẩn đoán kết nối. `news_check.py`
không đọc `.env.ai`, mặc định chạy ẩn; dùng `--show-browser` để hiện cửa sổ riêng.

Khi cập nhật, Ctrl+C ở CMD và chờ Stopped trước, rồi đóng các cửa sổ Local SDK
bridge còn lại. Không tắt toàn bộ Chrome cá nhân bằng taskkill. Chép `ai_bot.py`,
`news_check.py` và toàn bộ thư mục `polymarket_arb` vào bản cũ, giữ nguyên keys,
`.venv` và journal. Thay đổi này không sửa chế độ LIVE hay giới hạn vốn.

Runtime tái sử dụng một context/page cho mỗi API host. Context khởi tạo thất bại
được đóng ngay; page đã đóng được thay và giải phóng context cũ. Browser mất
kết nối được khởi tạo lại trước request; không làm phát lại POST order hoặc
giải phóng reservation UNKNOWN. Nhiều subprocess Chrome trong Task Manager
không đồng nghĩa nhiều phiên bot; không cần cửa sổ UI để bot gọi API.

CMD in SCAN START/END theo giờ Việt Nam (UTC+7), số market, bước QUOTE/NEWS,
lúc đang chờ River và số lần gọi model đã dùng/ngày UTC. Sau mỗi vòng chờ đúng
AI_INTERVAL_SECONDS (mặc định 180s), in giờ chạy kế tiếp và ALIVE mỗi 30s với
next_in. ALIVE là trạng thái tiến trình trong lúc chờ, không phải xác nhận API
đang thông hoặc một order đã khớp. Trong request đang chạy có log bước trước
request và lỗi/retry; heartbeat chỉ chạy trong khoảng chờ giữa các vòng.

Giữ CMD mở hoặc thu nhỏ. Đóng CMD sẽ dừng tiến trình; Ctrl+C dừng có cleanup.
Như trước, dừng bot không tự đóng vị thế hay hủy giao dịch đã gửi.
