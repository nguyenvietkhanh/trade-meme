> **Đã cập nhật revision 2:** cấu hình 10 vị thế, TP1 +25%, hệ số min và khóa vốn nằm ở [UPDATE-V54-R2.md](UPDATE-V54-R2.md). Phần dưới là mô tả V5.4 ban đầu để đối chiếu lịch sử, không phải mặc định đang dùng.

# LIVE Rules V5.4

Không gọi model. Quy tắc quyết định BUY/SELL/HOLD, bộ ký server hiện có thực thi.
Giữ Volume, LIVE_ROOT, ví, ledger, pending intents và chữ ký cũ khi nâng cấp.
Không reset trạng thái để áp chính sách mới lên vị thế cũ.

## Luồng vào lệnh

1. Lọc rẻ trước RPC holder: volume 5m phải có và >0, dự trữ quote SOL >=5,
   tổng BUY+SELL 5m >=3. Không đạt: `pre_filter_dead`.
2. Xác minh mint/program/authority và pool; holder >=20, top10 <=25%, dev <=5%.
   Thiếu top10/dev hoặc đơn vị % không xác minh được thì không mua. Giá trị
   `top10_pct=0.48` là 0,48%, không tự nhân 100. Có bằng chứng dev bán hoặc bundle
   nghi vấn thì loại. Nguồn ngoài cấu hình tùy chọn không được coi mặc nhiên là an toàn.
3. Chấm điểm 0–10: safety, flow, volume, momentum; thông tin tùy chọn thiếu bị
   trừ điểm. Unique buyers và hai snapshot cách >=5s là bằng chứng hỗ trợ, không
   phải cửa chặn bắt buộc. Ví ký khác nhau không chứng minh nguồn tiền độc lập.
4. STANDARD: điểm >=6, BUY/SELL >=1,1, BUY >=5, giao dịch >=8, volume >=0,5 SOL,
   tăng giá 5m từ 0 đến 100%. PROBE: điểm >=4, tỷ lệ >=1, BUY >=3, giao dịch >=5,
   volume >=0,3 SOL, biến động -2 đến 100%. Ngoài ngưỡng thì bỏ qua.
   Tỷ lệ BUY/SELL >=10 và giá trị bình quân mỗi giao dịch <0,005 SOL chỉ được PROBE.
5. Chỉ lấy quote thật cho ứng viên hợp lệ cuối, theo điểm giảm dần. Ước tính CPMM
   trước đó không có đầy đủ phí và không chứng minh đường bán khả dụng.
   Quote ladder: 100%, 50%, 25%, tối thiểu; chọn size lớn nhất đạt hao hụt khứ hồi
   <=6%, impact mỗi chiều <=2%, tuổi quote <=5 giây. Tối đa 3 lần đọc mỗi size
   (tối đa 12 lần nếu đủ 4 size), backoff có giới hạn. Cache mặc định 1 giây.
   Không tự retry ký/gửi giao dịch tài chính.
6. Treasury đọc lại số dư, exposure, safety và quote trước ký; slot/vốn còn lại
   được tính cho từng lệnh trong batch, không dùng lại cùng ngân sách.

## Size và giảm rủi ro

Size cơ sở = available SOL ×1,5% /0,5. PROBE nhân 1/3. Sau đó áp hệ số giảm và
lấy min với 10% cash ví, 1,5% reserve SOL pool, vốn sau gas 0,05 + buffer 0,005 SOL,
phần exposure còn lại. Exposure là cost basis vị thế + BUY pending, trần 30% equity
portfolio hiện tại; tối đa 5 vị thế. Ví nhỏ không đủ min 0,0025 SOL thì bỏ lệnh,
không tăng size vượt ngân sách để ép mua.

3 lệnh đóng lỗ liên tiếp: ×0,5. Từ 5 lỗ: ×0,25 và PROBE only. Daily realized loss
>5% baseline: ×0,5. Drawdown >10%: ×0,5; >15% chỉ PROBE tối thiểu nếu vẫn đủ
ngân sách. Các hệ số kết hợp nhân. Thống kê theo vị thế đóng, không đếm partial SELL
thành nhiều thắng/thua. Baseline UTC lưu cùng ledger; ngày bật tính năng lần đầu
lấy lần định giá xác minh đầu tiên, không giả định đã biết số dư đầu ngày.
Baseline được điều chỉnh theo nạp/rút. Không có giờ cấm BUY, cooldown lỗ hoặc tự
bật kill switch. KILL_SWITCH thủ công/API pause chỉ chặn BUY; SELL bảo vệ vẫn chạy.
Rủi ro 1,5% là mô hình với giả định lỗ 50%, không bảo đảm lỗ thực tế bị giới hạn.

## Thoát và tương thích

Vị thế mới: stop -20%; sau +50% dời stop về giá vào (BREAKEVEN_AFTER_PCT=0 tắt);
chốt nửa ở 2x, chỉ sau TP xác nhận mới trail -15%. Sau 90 phút trong vùng -5%..+15%
thì time exit. Stop chỉ kích hoạt lệnh, không bảo đảm giá bán hay hòa vốn sau phí.
Vị thế cũ giữ exitPolicy đã lưu; lệnh đã ký tiếp tục đối soát, không phát lại vì
đổi phiên bản. Runtime exit transport giữ tên V5.0 để tương thích dữ liệu cũ;
entry mới có rulesEntryVersion V5.4.

## Quan sát và giới hạn

UI/export có funnel theo giờ/ngày UTC: seen → pre_filter → safety → signal → quote
→ sent và lý do loại. Đây là số lần đánh giá, không phải số token duy nhất.
Quote diagnostics ghi size/age/HTTP/impact/loss/latency/source, không in API key.
Research journal có input/threshold/report. Fill lưu tier, score, size factor,
network fee và thời điểm; thiếu slippage có thể xác minh thì để null.

Chưa có bộ gom holder theo nguồn cấp tiền/beneficial owner. Lịch sử dev/bundle đầy
đủ, RugCheck ngoài, unique buyers hoặc xác nhận hai snapshot có thể chưa đủ dữ liệu;
`unknowns` phải thể hiện điều đó. Không bảo đảm chặn được MOONX hay mọi wash trade.

[Biến cấu hình và mặc định](ENVIRONMENT.md). Sau rollout kiểm tra health, version,
ledger/positions/pending, quote diagnostics và 429/RAM. Không cần đổi key hoặc Volume.
Chưa kiểm chứng lời/lỗ live của chiến lược mới chỉ bằng unit test.
