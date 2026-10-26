# Giải pháp đọc bằng Chrome trên máy local

Giữ mạng dây và các cài đặt bảo mật. Yêu cầu Windows, Python 3.11+ và Google Chrome
đã cài sẵn. Giải nén bản mới vào thư mục riêng và bấm **start_browser.bat**.
Script tạo venv, cài dependencies, chạy tests, mở Chrome để kiểm tra hai API rồi
chạy scanner chỉ đọc nếu preflight thành công. Không cần tự gõ các lệnh curl nữa.
Internet vẫn cần để pip cài package từ PyPI trong lần đầu.

Đây là lựa chọn transport dựa trên việc Chrome của bạn từng đọc được APIs;
**chưa được kiểm chứng trên máy Windows của bạn**, không phải bảo đảm sẽ hết reset.
Phiên Chrome tự động có hồ sơ trống, nên không thừa hưởng cookie/proxy từ extension
của Chrome cá nhân. Browser tuân theo kết nối Chrome/hệ điều hành bình thường.

Backend dùng Playwright chính thức của Microsoft và Chrome được cài trên máy.
Không tải binary trình duyệt mới, không dùng stealth, không giả fingerprint,
không bỏ TLS, không xử lý CAPTCHA, không đi qua proxy bên thứ ba do bot cung cấp.
Context chặn request ngoài ba host docs.polymarket.com, gamma-api.polymarket.com,
clob.polymarket.com; chỉ cho GET. Request bảo mật/challenge sẽ được báo lỗi và dừng.
Không mở token website, không kết nối Chrome đang chứa ví, không bật remote debug
server cho người khác, không nhận private key hay header xác thực trong backend.

Để Chrome tự động mở trong khi quét; Ctrl+C ở cửa sổ console để dừng.
Nếu lỗi, gửi ZIP mới trong verification (chỉ dữ liệu công khai). Không gửi .env.
Không thay đổi .env cũ: launcher ép backend=browser và DRY_RUN=true trong phiên
của chính nó. Các cấu hình lọc khác trong .env vẫn được giữ.

**Đây vẫn là scanner, không phải bản giao dịch thật hoàn chỉnh.** Kết nối đọc dữ
liệu thành công không chứng minh đặt lệnh/authentication hoạt động. Yêu cầu live
và vốn đọc động từ ví vẫn chưa triển khai; chưa có yêu cầu nạp tiền hay nhập khóa.

macOS/Linux (Chrome cài sẵn):

```bash
sh setup.sh
.venv/bin/python local_verify.py --api-only --backend browser
PUBLIC_HTTP_BACKEND=browser .venv/bin/python run_local.py --loop
```

Chỉ chạy nếu bước verify thành công. Trong môi trường cloud có proxy/CA quản lý,
không dùng browser để đổi đường ra hoặc vượt chính sách; chỉ tests offline ở đây.
