# Vá logout, API tài khoản và TOML — 2026-10-29

- Logout phải có session ví chủ hợp lệ trước disconnect; header Origin không thay xác thực. Cookie sai/hết hạn/replay bị 401; Origin sai bị 403; không đổi trạng thái bot.
- /api/state và /api/activity yêu cầu session, cả LIVE và paper. Export/research vẫn yêu cầu session. Health công khai chỉ trả status/buildRevision, health chi tiết cần session. Auth status công khai không có signerAvailable.
- UI LIVE xóa dữ liệu cũ khi 401 và cho đăng nhập lại. UI paper reload nếu phiên cũ hết hạn, sau đó hiển thị trạng thái khóa. Chỉ ký thông điệp đăng nhập không bật/tắt giao dịch. Thêm bảo vệ mốc hết hạn nonce/session.
- Chỉ override TOML 4.2.0 →5.0.1, không nâng các SDK ký giao dịch. Lockfile ghi đúng integrity. Parser Buffer/Anchor config được test. npm audit --omit=dev: 0 vulnerabilities tại lần chạy này; không phải chứng minh mọi dependency không còn lỗi chưa công bố.

Kiểm chứng: 123 file test toàn repo qua, HTTP test owner thật bằng key fixture ngẫu nhiên, không có key thật hoặc broadcast; browser kiểm tra no-session, login không trade, expiry xóa dữ liệu. Check/build qua. Các log /tmp/security-full-suite.log, /tmp/security-hotfix-tests.log, /tmp/security-ui.log, /tmp/security-patched-audit.json, /tmp/security-check.log.

Không sửa size/risk/exit, sổ lệnh/vị thế, hot-wallet architecture hoặc ví nhận lãi. Không tự nâng dependency bằng audit fix --force. Healthcheck Railway không cần session vẫn nhận HTTP 200. Người dùng phải đăng nhập bằng ví chủ để xem dữ liệu sau cập nhật. Không có biến mới.
