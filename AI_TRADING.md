# AI YES/NO local — SDK chính thức 0.14.0

Đây là nhánh **directional**: AI chọn BUY_YES, BUY_NO, SELL vị thế của bot, hoặc
HOLD. Không phải arbitrage mua hai phía; xác suất từ AI chưa được hiệu chuẩn và
có thể sai. Bạn có thể mất toàn bộ phần vốn thử. Không có cam kết sinh lời.

## Trạng thái kiểm chứng

Đã đọc docs chính thức về ví/auth, pUSD, fee, đặt/quản lý lệnh, V2 migration.
Đã cài SDK `polymarket-client==0.14.0` từ PyPI chính thức, kiểm tra wheel và API
trong mã nguồn; package standalone cũ được bỏ khỏi dependencies.
**Chưa xác thực ví, chưa gọi River, chưa gửi giao dịch tiền thật trên tài khoản
của bạn.** Unit/fixture tests không chứng minh các bước đó hoạt động production.

Chỉ dùng ví hiện có, không tự deploy ví mới, approve token, wrap, split, merge,
redeem hoặc chuyển tiền. Nếu thiếu approval thì dừng với mã rõ ràng; không tự
cấp unlimited allowance. Dùng website Polymarket để quản lý approvals/redemption.
Việc chọn loại ví dựa vào signer + địa chỉ tài khoản qua SDK; không suy từ email.
Session key chưa được hỗ trợ trong bản này: signer phải là owner đúng tài khoản.

## Windows: cài và kiểm tra

1. Giải nén vào thư mục riêng; chạy **setup_ai.bat**.
2. Mở `.env.ai` bằng trình soạn thảo. Windows có thể ẩn phần mở rộng.
3. Điền **trên máy bạn**:
   - `POLYMARKET_WALLET_ADDRESS`: địa chỉ API wallet đã sao chép từ Polymarket.
   - `SIGNER_PRIVATE_KEY`: khóa EVM của signer sở hữu đúng tài khoản Polymarket.
     Không dùng seed phrase, không dùng khóa ví Solana, không dùng một khóa tạo mới.
   - `MODEL_API_KEY`: API River của bạn. Đây không phải khóa Polymarket.
4. Giữ `DRY_RUN=true`; chạy **check_account.bat**. Nó xác thực ví, kiểm tra chain
   137, đọc cash/allowance và trạng thái journal. Có thể tạo/derive CLOB credentials
   bằng chữ ký xác thực; không gửi lệnh, deploy, approve hay giao dịch on-chain.
5. Chạy **start_ai.bat**: AI được gọi, quotes được kiểm tra, in đề xuất/dry-run;
   không ký order giao dịch hay gửi order. L1 auth vẫn có chữ ký chứng minh signer.

Không gửi `.env.ai`, private key, seed phrase, OTP, API secret hoặc toàn bộ AppData
vào chat. Chỉ điền khóa nếu đã có cách lấy khóa signer chính thức của tài khoản;
không cần và không nên nạp thêm tiền để xử lý lỗi auth.

## Bật thật một cách rõ ràng

Sau khi đã xem account check và dry-run trên máy bạn:

- Trong `.env.ai` đổi thành `DRY_RUN=false`.
- Chạy **start_ai_live.bat** (có `--live`).

Chỉ đổi file hoặc chỉ bấm launcher đều không đủ; cả hai phải bật. Đổi lại true
để về mô phỏng, hoặc Ctrl+C/tạo file STOP trong thư mục app để dừng. STOP không
đảo ngược order đã được chấp nhận và không tự bán vị thế. Không xóa journal.
macOS/Linux dùng `.venv/bin/python ai_bot.py --check-account`, `--loop` hoặc
`--loop --live` với cùng quy tắc môi trường.

## Vốn động, trần thử 7 USD

Không hardcode số dư 6.57 hay giả định ví có 7. Mỗi quyết định đọc lại balance
pUSD và allowance CLOB, trừ hạn mức đã sử dụng; có order mở ngoài bot thì khóa
lệnh mới để tránh chiếm dụng vốn. `MAX_USD_PER_TRADE` là giới hạn, không phải cỡ
lệnh bắt buộc; AI chọn số tiền, depth/min-size/fee có thể khiến lệnh bị từ chối.

Bản test này dùng cách bảo thủ: **tổng BUY đã xác nhận cộng tiền tối đa đang chờ
không vượt 7 USD trong toàn bộ đợt test**. Đây là tổng chi BUY, không chỉ exposure
đang mở; tiền SELL/lãi không tự làm mới ngân sách. Khi xác nhận được debit thực,
phần dự phòng phí chưa dùng được giải phóng. Không tự tăng ngân sách khi nạp tiền.
Đổi MAX_TEST_BUDGET >7 bị từ chối. Phí AI River tính riêng trên tài khoản API,
không thuộc 7 USD trading; có `MAX_MODEL_CALLS_PER_DAY` (mặc định 24, UTC).

Hạn mức là guard phần mềm và `max_spend` của SDK, không phải quyền chi tiêu 7 USD
bất biến trên chain. Khóa owner có quyền rộng hơn guard; thay đổi phí tại match,
can thiệp thủ công đồng thời hoặc lỗi tài khoản có thể cần xem xét. Không dùng
cùng tài khoản để thao tác thủ công trong lúc bot đang khớp và đối soát.

## Thực thi và đối soát

- Chỉ FOK, không để order GTC chờ trên book. BUY dùng `max_spend` bao gồm phí và
  `max_price` từ depth thực; SELL giới hạn số shares thuộc vị thế của bot và min price.
- AI không được truy cập signer hoặc credentials; chỉ nhận market, số dư dùng được,
  vị thế bot (tối đa MAX_OPEN_POSITIONS, mặc định 3), mô tả và luật resolution. **Không có web search/tin tức trực tiếp**;
  AI được yêu cầu HOLD khi dữ liệu không đủ, không được giả nhận đã nghiên cứu web.
- Quotes được lấy lại sau thời gian gọi model. Thiếu phí, book stale/skew, min-size,
  confidence/forecast edge không đạt => không gửi. Đây có thể là HOLD dài, không ép mua.
- SDK ký local; lưu signed order + cap trong SQLite `synchronous=FULL` trước gửi.
  Transport cấp một lần cho đúng payload đã ghi. Không retry POST order khi timeout.
- `accepted`/`matched` không được ghi là filled ngay. Chờ từng trade CONFIRMED,
  kiểm tra order ID và biến động balance trước/sau. Unknown hoặc delayed thiếu fill
  giữ reservation, dừng; không tạo chữ ký/lệnh mới để thử lại.
- PnL chỉ ghi khi SELL đã xác nhận và đối soát cash/shares. Daily loss dùng realized
  PnL UTC; unrealized loss có thể lớn hơn. Không có exchange-resident stop-loss.
- Phiên này chưa có công cụ tự sửa journal sau unknown/manual trades. Nếu dừng vì
  UNRESOLVED/EXTERNAL CHANGE: xem order trên Polymarket và giữ nguyên journal;
  không xóa trạng thái để chạy tiếp. Vị thế resolve có thể redeem trên website.

## Journal tồn tại qua các bản tải mới

Windows: `%LOCALAPPDATA%\PolymarketAITest\<địa chỉ ví>\ledger.sqlite3`.
Linux: `~/.local/share/PolymarketAITest/<ví>/ledger.sqlite3`.
Một process lock cho mỗi ví. Đổi thư mục Downloads không reset hạn mức. Nếu marker
còn nhưng ledger mất, từ chối tạo lại. Sao lưu toàn thư mục khi bot đã dừng;
không gửi signed orders/ledger riêng tư vào chat. Không tạo journal mới để bỏ qua lỗi.

## Transport và các giới hạn hiện tại

SDK mới chưa cung cấp public constructor injection transport phù hợp trường hợp
mạng này. Adapter được pin cho 0.14.0: injection chỉ ở constructor trong lock,
không thay URL hay crypto của SDK, không patch toàn bộ HTTPX. Public scanner vẫn
có lựa chọn Python/curl/Chrome đã thử; account/order dùng Chrome transport riêng.

Chrome dùng profile trống; một trang client được fulfill local ở origin API để
fetch cùng origin. Không có remote scripts hoặc nội dung key hiển thị trong trang.
Chỉ Polymarket CLOB/Gamma/relayer và RPC Polygon mặc định được cho phép. RPC chỉ
read methods; relayer chỉ GET; POST cấp credential cho phép; mọi financial write
bị chặn trừ một payload /order có permit. Không dùng stealth, không bỏ TLS,
không giải CAPTCHA hay vượt 403. Token/chữ ký trong RAM chỉ đến đúng CLOB.

Còn cần kiểm chứng local: SDK auth bằng signer thật, RPC/relayer, balance/allowance,
River model, và FOK BUY/SELL/settlement. **Đừng coi test pass là xác nhận đã chạy thật.**

## Trang Chrome trắng và lỗi kết nối

Dòng `Local SDK bridge: private data is not displayed.` là bình thường. Đây là
trang local được trình duyệt dùng để fetch API; không phải trang đăng nhập hay
thông báo lỗi. Giữ Chrome mở; đọc kết quả trong cửa sổ lệnh.

Bản chẩn đoán in `SDK NETWORK | host=... | stage=... | code=... | attempt=...`
hoặc `SDK HTTP | host=... | stage=... | status=...`. Không in query, wallet,
headers, chữ ký, response body hay credentials. Chỉ GET và RPC đọc được thử
lại tối đa 3 lần khi lỗi mạng tạm thời. Không retry HTTP 403, lỗi chứng chỉ,
POST tạo API credential hoặc POST đặt order. Lỗi không chắc chắn của order
vẫn giữ reservation và dừng, không phát lại giao dịch.

Nếu đang dùng bản trước: tải ZIP bản mới, đóng bot/Chrome, chỉ chép đè
`ai_bot.py` và `polymarket_arb/secure_bridge.py` vào đúng chỗ trong thư mục cũ.
Giữ nguyên `.env.ai`, `.venv` và journal. Không cần cài lại dependency cho bản
chẩn đoán này. Chạy lại `check_account.bat` và gửi các dòng `SDK NETWORK`,
`SDK HTTP`, `STOPPED` để xác định API hỏng. Không gửi file cấu hình hay keys.
