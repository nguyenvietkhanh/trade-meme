# Restart ngày 2026-10-29: dữ kiện và sửa tải đọc nền

## Dữ kiện từ log người dùng

- 09:04:32 UTC: heapUsed 56 MiB, heapTotal 84 MiB, RSS 286 MiB.
- 09:05:30 UTC: heapUsed 58 MiB, heapTotal 85 MiB, RSS 286 MiB.
- 09:06:27 UTC: có mount volume, startup log và sessionStartedAt mới. Xác nhận tiến trình/container đã khởi động lại; không xác định được nguyên nhân chỉ bằng các dòng này.
- Sau startup: RSS 142 →187 →191 →193 MiB trong các mẫu tới 09:10:27 UTC; heapUsed khoảng 47–59 MiB. Đây không phải số đo toàn container hoặc tiến trình con, và không chứng minh không có đỉnh RAM giữa hai mẫu.
- Không có FATAL, exit code, OOMKilled hoặc SIGTERM trong đoạn được gửi. Các lỗi SPL/mint/version là lỗi đọc/validation đã bị catch. Chưa có bằng chứng chúng trực tiếp làm tiến trình thoát.
- RESEARCH CLEANUP ghi đã dọn 3,89 MiB, còn 28,10 MiB của phần research đó. Không đồng nghĩa toàn Volume chỉ có 28,10 MiB hoặc nguyên nhân restart là hết đĩa.

## Điểm tải lặp được sửa

1. `ReadRejectionCache` giữ tối đa 512 lỗi định danh/token-program của dữ liệu đọc, TTL 10 phút. Key đầy đủ mint:pool. Sai pool hoặc SPL không được hỗ trợ vẫn bị từ chối, không đưa giá/flow giả. Sau TTL kiểm tra lại, không blacklist vĩnh viễn. Lỗi RPC tạm thời không bị đưa vào negative cache này.
2. `PaperPoolReader` không liên tục bootstrap lại pool đã bị xác định không hợp lệ. Check owner/PDA/mint/quote/SPL/version vẫn giữ nguyên.
3. Swap-flow gộp những lượt đọc cùng mint/pool đang chạy. Lỗi sai mint/program cũng được negative-cache; scheduler trì hoãn riêng pool đó thay vì tốn lượt đọc theo vòng. Không thay cách đếm giao dịch khi đọc thành công.
4. Receipt bị RPC từ chối do phiên bản vẫn giữ `complete=false`/retryAt như cũ, không giả làm flow sạch. Không in hàng loạt chữ ký cho từng lỗi unsupported-version; đọc bị từ chối vẫn nằm trong cache và làm coverage không hoàn chỉnh.

Đây là giảm tải RPC/SDK/log từ tác vụ đọc, không phải bằng chứng đã chữa được nguyên nhân restart production. Không nới validation để cho các token lỗi qua.

## RAM và lý do thoát

- RUNTIME MEMORY có thêm externalMiB, arrayBuffersMiB, uptimeSeconds; RAM từng worker có timestamp/age riêng. Heap con không được cộng nhầm vào heap main.
- Trên Linux cgroup v2, đọc memory.current, memory.max, memory.events. Có containerCurrentMiB, containerLimitMiB và các counter oom/oom_kill/max/high. Không hỗ trợ/quyền đọc không đủ: null/unavailable, không ném lỗi vào vòng giao dịch.
- RSS main không phải tổng RAM container. Không cộng RSS các tiến trình rồi coi đó là cgroup usage vì có thể có trang dùng chung. Worker thread observer dùng chung RSS process; child trading worker có process riêng.
- SIGTERM/SIGINT được log trước shutdown hiện có; uncaughtExceptionMonitor chỉ log dấu mốc/lớp lỗi, không nuốt exception để tiếp tục vận hành trong trạng thái chưa rõ. SIGKILL không thể bắt bằng JavaScript.
- Counter cgroup có thể reset khi container mới được tạo. Counter tăng cũng cần đối chiếu termination event. Exit 137 chỉ xác nhận SIGKILL; riêng nó chưa chứng minh OOM. Cần Railway termination reason/OOMKilled và limit RAM để kết luận.

Không tăng NODE_OPTIONS/heap một cách mặc định khi chưa biết ngân sách RAM. Không thêm restart theo giờ, không tắt BUY/SELL bảo vệ, không tự gửi lại giao dịch.

## Phạm vi

File mới: src/read-rejection-cache.js, src/runtime-memory.js, test/crash-diagnostics.test.js, tài liệu này.

File sửa trong phần xử lý restart: src/paper-amm-model.js, src/paper-swap-flow.js, src/paper-strategy-data.js, src/paper-bot-worker.js, src/paper-supervisor.js, src/paper-server.js, test/paper-amm-model.test.js, test/paper-swap-flow.test.js. Không thay mã sizing/risk/rules, signer, ledger, stored exits hoặc vị thế cũ. Các thay đổi observer chưa commit từ yêu cầu trước vẫn được giữ nguyên.

Kiểm tra: /tmp/crash-read-regression.log (23 test), /tmp/crash-heap192.log (regression ở heap 192 MiB), /tmp/crash-full-suite.log, /tmp/crash-check.log, /tmp/crash-build.log. Xem kết quả hoàn tất ở bàn giao; test fixture không phải theo dõi uptime production. Chưa deploy, chưa đọc được Railway memory/termination events thật, không ký/gửi lệnh.

Kết quả đã hoàn tất: 120 file test toàn repo qua, 0 file lỗi; 23/23 test đọc/diagnostic qua; 17/17 test regression ở heap 192 MiB qua; check (`/tmp/crash-check-final.log`) và build qua. Chưa chứng minh runtime production hết restart.
