# Chạy local — trạng thái hiện tại

Đây là scanner giai đoạn 1 và công cụ lấy bằng chứng API/tài liệu chính thức,
**chưa phải bot giao dịch thật hoàn chỉnh**. DRY_RUN=false vẫn bị chặn.
Không nhập private key; không nạp tiền cho chương trình này.

## Windows

1. Cài Python 3.11+ từ python.org, giải nén ZIP vào thư mục riêng.
2. Chạy `setup.bat` để tạo venv, cài dependency và chạy tests.
3. Chạy `verify.bat` để tải tài liệu/API public từ máy của bạn.
4. Chạy `run.bat` để quét lặp, dùng `.env` cục bộ.

## macOS / Linux

```bash
sh setup.sh
python3 local_verify.py
.venv/bin/python run_local.py --loop
```

Công cụ xác minh dùng stdlib, không cần cài dependency hoặc mở ví.
Nó tạo `verification/<timestamp>.zip`, chỉ gồm nội dung public từ ba host
chính thức. Có thể gửi file đó lại để đối chiếu docs/fee/contract trước phần live.
Không gửi `.env`, private key hoặc toàn bộ thư mục ví. Công cụ không kiểm tra
vùng pháp lý, quyền tài khoản hay khả năng khớp lệnh bằng việc HTTP trả 200.

## Yêu cầu live mới nhất được ghi nhận, chưa triển khai

Vốn phải đọc từ số dư collateral/allowance khả dụng của tài khoản thực; không cố
định 10 USDC hay 25 USD. Cần trừ tiền bị khóa ở lệnh/vị thế đang mở, tính phí và
dự phòng gas. MAX_USD_PER_TRADE là giới hạn rủi ro mỗi lệnh, không phải tổng vốn;
không được giả định collateral bằng số USDC hiển thị trong ví.

Chỉ nối live sau khi xác minh: collateral/decimals/contract, wrap/approval,
fee và net shares, account/funder/signature type, tick/lot, hai chân không atomic,
recovery của lệnh timeout/khớp một chân, persistent journal và kill switch.
Khóa chỉ được đọc từ environment trên máy bạn, không gửi chat hoặc log.

Không có auto-deploy, transfer, approve, wrap hoặc order trong các script local.

## Báo cáo local lần đầu

Đã đọc docs trong ZIP của bạn. Cả Gamma và CLOB lỗi URLError, chưa biết nguyên
nhân. Tải lại nhánh mới rồi chạy `verify.bat --api-only` để lấy mã lỗi phân loại;
không cần setup lại nếu dependency đã cài. Không tắt kiểm tra chứng chỉ TLS.
