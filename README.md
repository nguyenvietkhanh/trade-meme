# Meme Pilot — Solana autonomous paper trader

Bot tự đánh giá token và quyết định mua/bán theo quy tắc. Dashboard tiếng Việt lấy bố cục từ ảnh tham khảo: balance, P/L, drawdown, biểu đồ, decision log và radar token. **Không copytrade. Không có kết nối ví hoặc thực thi tiền thật.** Vốn 0,3 SOL trong ứng dụng là vốn mô phỏng, không cần nạp tiền.

## Chạy local

Cần Node.js **24+**, npm và kết nối HTTPS tới `api.dexscreener.com`. Không có thư viện runtime bên ngoài, API key hoặc database server.

```bash
cd trade-meme
npm ci --ignore-scripts
npm test
npm start
```

Mở trình duyệt trên máy của bạn, nhập địa chỉ `http://127.0.0.1:3000`. Đợi báo dữ liệu trực tuyến, xem bộ giới hạn rồi bấm **Bật bot tự giao dịch**. Bot sẽ tự chọn lệnh mô phỏng mỗi vòng quét, không cần bạn xác nhận từng lệnh. Khi chưa bấm bật, chỉ đọc giá và hiển thị radar. Giao dịch thủ công nằm trong phần mở rộng dưới dashboard.

Không bắt buộc tạo `.env`. Muốn đổi cổng, sao chép `.env.example` thành `.env` rồi chỉnh. Node dùng proxy hiện có của máy với `--use-env-proxy`; không tắt TLS verification. Dữ liệu discovery tìm BONK, WIF, POPCAT và “solana” trên DexScreener, lọc chain Solana và chọn pool có thanh khoản cao nhất cho từng mint. Đây là tập quét có giới hạn, không phải toàn bộ Solana hoặc danh sách meme đã xác minh. Có thể thêm tối đa 20 địa chỉ mint vào tập quét ngay trên dashboard. Vị thế mở luôn được yêu cầu cập nhật riêng, không phụ thuộc việc token còn xuất hiện trong kết quả discovery.

## Bot tự quyết định như thế nào?

Chiến lược ban đầu là **momentum với bộ lọc thanh khoản**, chưa được huấn luyện hoặc chứng minh có lãi. Điểm số minh bạch, không phải xác suất thắng và không gọi LLM để đoán giá:

| Điều kiện | Điểm |
| --- | ---: |
| Thanh khoản pool ≥ 100.000 USD | 20 |
| Khối lượng 24 giờ ≥ 100.000 USD | 15 |
| Thay đổi giá 5 phút từ +1% đến +8% | 25 |
| Ít nhất 10 lượt mua trong 5 phút | 10 |
| Số lượt mua > 1,3 lần số lượt bán | 20 |
| Pool ít nhất 6 giờ tuổi | 10 |

**Tất cả điều kiện phải đạt**, cùng giá không quá 90 giây, mới được xét mua. Bot xếp ứng viên theo điểm, kiểm tra ngân sách, giới hạn vị thế và cooldown. Token thiếu tuổi pool hoặc thanh khoản bị loại. Có thể không mua gì trong nhiều giờ. Nhiều ứng viên cùng 100 điểm sẽ giữ thứ tự từ tập quét; không có khẳng định tối ưu lợi nhuận.

- Vốn đầu: **0,3 SOL**; mỗi lệnh: **0,02 SOL**; tối đa **3 vị thế**; dự phòng ít nhất **0,05 SOL**.
- Trượt giá giả định **1,5% mỗi chiều**, phí cố định giả định **0,0001 SOL mỗi lệnh**, được trừ vào số dư. Đây không phải báo giá swap hoặc phí thực tế từ mạng.
- Cắt lỗ **10%**, chốt lời **20%**, dựa vào giá trị thoát lệnh ròng tính bằng SOL sau phí và trượt giá. SOL/USD biến động cũng làm thay đổi P/L theo SOL.
- Khóa mua mới khi lỗ/ngày đạt **0,03 SOL** hoặc drawdown từ đỉnh đạt **15%**. Khi bot đang bật, các vị thế có giá mới được thoát do giới hạn rủi ro. Khóa không tự xóa vào hôm sau; cần đánh giá và reset mô phỏng nếu muốn bắt đầu lại.
- Cooldown **30 phút** sau khi bán token. Stop loss kiểm tra mỗi vòng quét, không đảm bảo bán đúng mức nếu giá nhảy hoặc mất dữ liệu.
- **Dừng tự động** dừng cả mua và thoát lệnh tự động; không đóng vị thế. Bạn có thể bán mô phỏng thủ công khi có giá mới.

Nguồn giá là giá tham khảo của pool. Chưa mô phỏng khả năng khớp, MEV, rug pull, transfer tax, mint/freeze authority hoặc tập trung holder. Mô phỏng có thể bán token mà thực tế không bán được. Không dùng kết quả này để suy ra chắc chắn kiếm được tiền.

## Chạy 24/24

Máy cần luôn bật, có mạng và tắt chế độ sleep. Đóng tab trình duyệt không dừng bot; đóng tiến trình Node sẽ dừng. Sau khi bạn bật tự động một lần, lựa chọn này được lưu. Restart chỉ cho phép bot tiếp tục sau khi nhận giá mới; giới hạn lỗ vẫn được giữ. Nếu đã bấm Dừng, restart sẽ không tự bật lại.

**Cách 1 — Docker Compose:** cần Docker và Compose đã cài trên máy local.

```bash
docker compose up -d --build
docker compose logs -f --tail=100
# Dừng tiến trình, giữ dữ liệu:
docker compose down
```

Compose đặt restart `unless-stopped`, chỉ công bố cổng trên loopback, lưu trạng thái vào volume `paper-data` và giới hạn kích thước log. Docker Desktop trên Windows/macOS phải đang chạy; bật khởi động cùng hệ điều hành nếu cần. Image Docker đã build và kiểm tra khởi động/HTTP health trong cloud; kết nối feed qua mạng Docker trên máy local cần kiểm tra khi triển khai.

**Cách 2 — Linux systemd:** dùng mẫu `ops/meme-pilot.service.example`, thay đường dẫn tuyệt đối tới checkout và Node 24, chép vào `~/.config/systemd/user/meme-pilot.service`, rồi:

```bash
systemctl --user daemon-reload
systemctl --user enable --now meme-pilot
journalctl --user -u meme-pilot -f
```

Để chạy khi logout, cấu hình user lingering theo chính sách máy local của bạn. Mẫu systemd chưa được chạy trong cloud này.

Chỉ chạy **một tiến trình** với một thư mục dữ liệu. Dịch vụ local chưa có đăng nhập đa người dùng; không mở port trực tiếp ra Internet.

## Lưu dữ liệu và kiểm tra

Trạng thái nằm trong `.data/paper-state.json`, ghi file tạm rồi đổi tên; không commit vào Git. Có tối đa 500 fills gần nhất, 300 quyết định gần nhất, 200 log và 1.440 điểm đường vốn (khoảng 12 giờ ở chu kỳ 30 giây). Win rate và số lệnh đóng tính trên cửa sổ 500 fills, không phải toàn bộ đời bot. Xuất JSON trước khi dữ liệu vượt cửa sổ nếu cần phân tích lâu dài. Reset yêu cầu xác nhận, lưu bản archive trước khi tạo tài khoản mới. Dữ liệu chỉ là mô phỏng.

```bash
npm run check
npm test
curl -fsS http://127.0.0.1:3000/api/health
```

Health `status: ok` chỉ chứng minh server chạy; `marketFresh: true` mới cho biết feed hiện tại mới và không báo lỗi. `/api/state` chứa kết quả đầy đủ. `/api/export` xuất fills đang lưu. Test dùng fixture tổng hợp trong tiến trình riêng, không thay nguồn dữ liệu của `npm start`.

## Trạng thái xác minh trong cloud

- Engine, bộ lọc, market adapter, luồng HTTP, lưu trạng thái, resume sau restart và các giới hạn được kiểm thử tự động. Dashboard desktop/mobile đã kiểm tra bằng Chromium, không có lỗi JavaScript hoặc tràn ngang ở viewport đã chọn.
- Ban đầu proxy cloud trả **403**. Sau cập nhật cấu hình, đã lấy được dữ liệu DexScreener thật và chạy vòng đánh giá tự động. Không có lệnh ở lần kiểm tra vì chưa có token đạt toàn bộ bộ lọc; chưa có bằng chứng sinh lợi. Domain cần cho phép: `api.dexscreener.com`.
- Local có chính sách mạng riêng; nếu truy cập domain được thì không cần cấu hình cloud này. Không tạo giá giả để che lỗi feed.

## Trước giai đoạn tiền thật

Chưa triển khai giao dịch mainnet. Cần đánh giá forward test, bổ sung kiểm tra token on-chain/route mua và bán, quote khớp thực tế, RPC, quản lý ví riêng, xác nhận giao dịch và đối soát sau restart. Thỏa thuận mức vốn/lỗ và cơ chế ký phải rõ trước khi bật. Không gửi seed phrase hoặc private key trong chat.

## Railway — demo công khai

Repository có `railway.json`, dùng Dockerfile và chạy `src/railway.js`. Entry point này bind `0.0.0.0`, nhận `PORT` do Railway cấp, tự chạy paper trading sau khi lấy được giá mới, và khóa toàn bộ API điều khiển để khách truy cập chỉ xem dashboard. Server cũng tự nhận diện các biến nền tảng Railway, nên vẫn áp dụng đúng chế độ tự chạy và chỉ xem nếu Railway dùng lệnh npm/Docker mặc định thay cho entry point riêng; risk halt đã lưu vẫn được giữ. Không cần secret hoặc ví. Dùng Railway CLI đã đăng nhập:

```bash
railway init --name meme-pilot
railway add --service meme-pilot
railway up --service meme-pilot
railway domain --service meme-pilot
```

Chọn workspace/project/service khi CLI yêu cầu. Railway có thể phát sinh phí hosting theo gói tài khoản. Không có volume thì số dư/lịch sử demo có thể reset sau redeploy; nếu cần giữ dữ liệu, cấu hình volume và quyền ghi cho user `node` (UID 1000) tại `/app/.data`. Public health trả `ok` khi server chạy; vẫn cần xác minh `marketFresh: true` và feed trên dashboard sau deploy. Chưa bật thực thi giao dịch thật.
