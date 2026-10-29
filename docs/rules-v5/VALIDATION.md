# Kiểm tra revision 2 — 29/10/2026

- Toàn bộ `npm test`: **118 file**, 0 file lỗi, không bỏ file.
- Các test bổ sung sau full suite: API export auth + CSV, treasury/runner/scalp,
  capacity/lock/tranche/labels; đạt. Khởi động owner HTTP có budget 5s để tránh
  false timeout khi import SDK; toàn bộ kiểm tra owner/cross-origin vẫn chạy.
- `npm run check`, `npm run build`, `git diff --check`: đạt.
- Chromium mock: 390px và 1120px, không lỗi JS/tràn ngang, mọi box trừ Pipeline
  thu gọn và lưu trạng thái, pause gửi đúng pause, không bắt xác nhận size.
- Stress heap **192 MiB**: SDK reuse, 50.000 snapshot/book vào kênh bị nghẽn,
  original response body tiêu thụ một lần không unread clone tee: đạt.
- Test từ dữ liệu thật: 3 candidate dead-pool trong export user và đoạn quote
  impact→429→provider backoff của ngày 29/10. Các baseline/event/runner còn lại là
  fixture mô phỏng được gắn rõ; không coi đó là vài trăm event LIVE.
- Treasury tests giữ vị thế/chữ ký qua restart, không broadcast trùng; tranche
  chỉ tăng qua receipt xác nhận. No time exit RUNNER, separate group risk/exposure/PnL,
  root LP proof/event/grant/cash/depth gates, FIFO SELL priority được kiểm tra.

Không dùng signer thật hoặc gửi giao dịch tài chính trong các kiểm tra.
Không có credentials/log/Volume Railway ở môi trường này: không tuyên bố RAM
production đã hết tăng hoặc deployment đã healthy. `RUNTIME MEMORY` và funnel
cần đối chiếu sau rollout. Đoạn log thực có OOM, không có heap snapshot để chứng
minh duy nhất một nguồn leak. Source không truy cập được vẫn báo unavailable.
