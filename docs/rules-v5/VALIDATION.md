# Kiểm tra phát hành V5.4 — 2026-10-29

- `npm test`: 112 file test, 0 file lỗi, không bỏ file nào.
- `npm run check`, `npm run build`, `git diff --check`: đạt.
- Kiểm tra riêng treasury/entry: 12 test đạt, gồm chặn embedded quote sai size,
  stale, impact quá ngưỡng hoặc thiếu dữ liệu; không phát lệnh khi proof không hợp lệ.
- Chromium với API mock nội bộ: viewport 390 và 1120 px; không lỗi JavaScript,
  không tràn ngang; thu gọn mọi box trừ Pipeline; trạng thái thu gọn còn sau reload;
  nút pause gửi đúng pause, không tự resume và không yêu cầu xác nhận size.
- Test receipt/restart giữ nguyên position và signature; không broadcast trùng.

Các kiểm tra dùng fixture/mock, không dùng signer hoặc gửi giao dịch thật.
Không chứng minh hiệu quả/PnL hoặc mức hao hụt thực tế trên thị trường LIVE.
Không có quyền truy cập trạng thái deploy/Volume Railway trong môi trường kiểm tra;
phải phân biệt push GitHub thành công với deployment đã healthy.
