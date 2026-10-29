# SCALP: số dư SOL ≤1 dùng sàn 20%

Mặc định bật qua `SMALL_WALLET_ORDER_ENABLED=true` (không cần thêm biến trên Railway). Nếu đã đặt biến này thành false thì cần đổi lại để bật. Ngưỡng cố định 1 SOL, tỷ lệ cố định 20%.

- Căn cứ **số dư SOL thực của ví chính** tại lần lập kế hoạch và kiểm tra lại trước ký. Không dùng equity gồm token, không dùng SOL khả dụng sau giữ chỗ làm mẫu số.
- Số dư >0 và ≤1 SOL: sàn mỗi lệnh SCALP = ceil(lamports /5). Ví 0,5 SOL: 0,1 SOL/lệnh. Ví 1 SOL: 0,2 SOL/lệnh. Số dư không hợp lệ/cũ không tự giả định thuộc nhánh nhỏ.
- Sàn này thay mức size cũ thấp hơn (cả STANDARD, PROBE và QUICK), đồng thời nâng trần ví 10% cũ lên mức cần thiết 20% **chỉ ở nhánh ≤1 SOL**. Vì trần cũ cấu hình tối đa 10%, mặc định lệnh ở nhánh nhỏ sẽ bằng 20%, không lớn hơn. Tỷ lệ 20% chưa bao gồm network fee/rent; vẫn có gas/fee buffers.
- Hệ số giảm size, chế độ minimal và quote ladder không được hạ dưới sàn. Giới hạn thanh khoản 1,5% reserve, exposure 50%, số vị thế, vốn còn lại, tiền đặt chỗ, 0,05 SOL gas + buffer, hard safety/impact/roundtrip/QUICK cost quota vẫn chặn. Không đủ thì SKIP, không ép tăng vượt các giới hạn này. Ví dụ ví 1 SOL cần pool reserve ít nhất ~13,34 SOL theo trần depth mặc định để đủ size 0,2 SOL; còn phải qua quote thật.
- Số dư >1 SOL: công thức size/PROBE/QUICK/soft-risk/quote ladder cũ. Test so sánh các kết quả kế hoạch với nhánh override tắt, tại nhiều số dư/tier/hệ số.
- RUNNER vẫn theo policy nhóm riêng. `limits.scalpMinOrderSol` mô tả sàn SCALP; min chung của bộ kiểm tra vận chuyển không đổi để không chặn nhầm RUNNER. Parent RulesTreasury và grant re-evaluation là nơi cưỡng chế sàn SCALP thật.
- Khóa vốn trước quote, tính cả các hold khác và pending orders; không có nhiều lệnh cùng dùng một khoản SOL/exposure. Với exposure 50% và mỗi lệnh 20%, mặc định có thể chỉ đủ hai lệnh mới dù MAX_POSITIONS vẫn là 10.
- Quote thật không thử mức dưới sàn; nếu một selector trả mức nhỏ hơn thì reject, giải phóng hold và không cấp grant. Parent từ chối lệnh dưới sàn trước chuẩn bị/ký. Recheck trước ký phát hiện số dư đổi hoặc vượt qua ngưỡng 1 SOL, không tự sửa size của giao dịch đã chuẩn bị.
- Vị thế đang mở và exit đã lưu không bị thay đổi. Lệnh đã ký được đối soát như cũ; BUY chưa ký dùng size cũ có thể bị từ chối do không còn hợp lệ.

R1_detail có small_wallet_rule, minimum_order_sol, minimum_order_blocked và assumed_loss_sol; rủi ro giả định thực được ghi từ size × assumed loss. Các trường risk_fraction/baseRiskSize là phép tính cũ trước override. Đã có một dòng trạng thái trên UI hiển thị nhánh/sàn theo số dư còn mới. Khi bị chặn có mã SMALL_WALLET_MINIMUM_BLOCKED hoặc RULES_SMALL_WALLET_MINIMUM.

Bản phát hành này còn gồm các thay đổi trước đã được người dùng yêu cầu: candidate observer, dọn raw sau nhãn + retention 3 ngày/32 MiB, bounded read rejection/cache, gộp RPC đọc trùng và memory diagnostics. Không thêm API key/dịch vụ trả phí, không đọc key thật và không gửi lệnh thử.

Kiểm chứng trước triển khai: 121 file test toàn repo qua, 0 file lỗi (`/tmp/small-wallet-full-suite.log`); 10/10 test mới cho ngưỡng/sàn/depth/gas/exposure/quote/concurrency/parent/RUNNER (`/tmp/small-wallet-new-tests.log`). Check/build qua. UI kiểm tra thực trên Chromium 390px/1120px ở số dư 0,5/1/1,000000001/2 SOL, không lỗi JS hoặc tràn ngang (`/tmp/small-wallet-ui.log`). Toàn bộ thử giao dịch là fixture/mock, không đọc key thật hay gửi lệnh on-chain.
