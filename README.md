# Polymarket AI — chạy local trên Windows

Bản hiện tại dùng **SDK chính thức `polymarket-client==0.14.0`** trên Polygon 137.
AI River chọn **BUY YES / BUY NO / SELL / HOLD**. Scanner arbitrage chỉ đọc vẫn có riêng.
Mặc định **DRY_RUN=true**; code đặt lệnh thật chỉ hoạt động khi bạn đổi cấu hình và dùng launcher live.

## Bắt đầu

1. Giải nén vào thư mục riêng. Cài Python 3.11+ và Google Chrome.
2. Bấm **setup_ai.bat**; chương trình cài dependencies, chạy kiểm thử và tạo `.env.ai`.
3. Mở `.env.ai` bằng Notepad; điền địa chỉ API wallet, khóa EVM owner đúng tài khoản và API River **trên máy bạn**. Không gửi file hoặc khóa vào chat.
4. Giữ `DRY_RUN=true`; bấm **check_account.bat** để xác minh signer, chain, cash và allowance. Không gửi lệnh giao dịch hay approval.
5. Bấm **start_ai.bat** để chạy AI thử. Chrome riêng phải được giữ mở.

Chi tiết cấu hình, bật live và xử lý trạng thái chưa xác định: **[AI_TRADING.md](AI_TRADING.md)**.
`start_browser.bat` là scanner arbitrage cũ, không phải launcher AI.

## Vốn và thực thi

- Cash được đọc từ tài khoản; không giả định số dư là 7 USD.
- Tổng BUY đã xác nhận cộng khoản đang chờ tối đa **7 USD trong cả đợt test**. Đây là trần thử nghiệm, không phải cỡ lệnh cố định; SELL không làm mới ngân sách.
- Kiểm tra độ sâu, phí, min-size, dữ liệu mới và allowance; chỉ dùng FOK.
- Ghi SQLite trước gửi; không tự gửi lại lệnh khi timeout hoặc chưa biết kết quả.
- Journal đặt ngoài thư mục tải về, có khóa ngăn hai tiến trình chạy chung ví.
- STOP hoặc Ctrl+C ngừng vòng chạy, không tự đóng vị thế đã mở.
- Thiếu approval thì dừng; bản này không tự approve, wrap, deploy ví, redeem hoặc chuyển tiền.
- AI không được nhận khóa ký. River chỉ nhận dữ liệu thị trường, vị thế bot và ngân sách. Không có web search hay tin tức trực tiếp.

## pUSD và tài khoản

Collateral là pUSD, không phải USDC.e trực tiếp. Với tài khoản đã có cash trên website, chạy account check trước; không nạp thêm để xử lý lỗi auth.
Dùng luồng Deposit/chuyển đổi chính thức của Polymarket nếu cần nạp collateral. **Không gửi tiền vào địa chỉ được website ghi “for API use only”.**
Bản này không chứa script wrap: cần kiểm tra đúng asset, spender, ví owner và tài liệu chính thức trước bất kỳ approval/wrap thủ công nào: https://docs.polymarket.com/concepts/pusd .

## Kiểm chứng

96 unit tests đã qua; fixture transport Chromium offline đã qua, dùng dữ liệu/khóa giả lập.
**Chưa xác thực signer thật, chưa gọi River bằng API của bạn và chưa kiểm chứng BUY/SELL/settlement production trên tài khoản của bạn.**
Không coi test pass là xác nhận đã giao dịch thật. Không có công cụ tự sửa journal sau lệnh UNKNOWN; giữ nguyên trạng thái và kiểm tra tài khoản trước khi xử lý.

## Dependencies và mã nguồn

- [requirements.txt](requirements.txt): phiên bản đầy đủ.
- [docs/dependencies.md](docs/dependencies.md): nguồn và mục đích từng dependency.
- `ai_bot.py`: vòng chạy và account check.
- `polymarket_arb/ai_settings.py`, `ai_model.py`, `ai_engine.py`, `ai_journal.py`, `secure_bridge.py`: cấu hình, AI, thực thi, sổ lệnh và transport có kiểm soát.
- `polymarket_arb/market_data.py`, `pricing.py`, `risk.py`: dữ liệu, tính giá/phí và kiểm tra.
- [BROWSER.md](BROWSER.md): scanner public qua Chrome.
- [docs/SCANNER_HISTORY.md](docs/SCANNER_HISTORY.md): lịch sử scanner, không dùng làm hướng dẫn AI hiện tại.

Kiểm thử: `.venv\Scripts\python.exe -m unittest discover -s tests -v` trên Windows.
