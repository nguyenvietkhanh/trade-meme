# Meme Pilot — Solana spot

Bot chọn token PumpSwap và tự ký từ ví chủ **7JePGU7MFtRo9z5jMh2486UniD4EB4PpRd8tv2Jhqpsy**. Không cần Helius/Jupiter API key, không tạo ví phụ.

**Kết nối ví chỉ xác thực chủ.** Muốn tự giao dịch không chờ ký, chủ nhập private key của đúng ví một lần qua giao diện đã đăng nhập trên Railway HTTPS hoặc localhost 127.0.0.1. Két AES-256-GCM/scrypt giữ bản mã hóa; mở khóa nạp khóa ký vào RAM. Không nhập seed phrase, không gửi khóa/mật khẩu trong chat hoặc Git. Private key có quyền với toàn bộ ví; hạn mức 0,3 SOL do phần mềm thực thi, không phải hạn mức on-chain. Không dùng ví này giữ tài sản vượt mức chấp nhận rủi ro của bạn.

## Sử dụng

1. Mở website HTTPS trong Phantom/Solflare hoặc trình duyệt có extension. Kết nối đúng ví chủ và ký thông điệp đăng nhập.
2. Mạng Solana kết nối tự động, không có ô Helius/Jupiter key.
3. Trong **BỘ KÝ TỰ ĐỘNG**, nhập khóa riêng base58 hoặc JSON 64 byte của đúng ví chủ, đặt mật khẩu mã hóa ít nhất 12 ký tự, bấm **Mã hóa và lưu bộ ký**. Các ô nhập được xóa sau yêu cầu; không lưu vào localStorage.
4. Bấm **Bật tự giao dịch**. Server tự quét, chọn, ký, gửi và đối soát mua/bán/chuyển lãi. Không gọi `signTransaction` của extension mỗi lệnh. Đóng tab hoặc session giao diện hết hạn không làm bot ngừng chạy.
5. **Dừng theo dõi** ngừng lệnh mới; **Dừng và khóa bộ ký** bỏ khóa đã mở khỏi bộ ký. Vị thế vẫn tồn tại. Có thể bán toàn bộ phần token ứng dụng quản lý bằng nút ở vị thế khi bộ ký đang mở.
6. Sau restart bộ ký luôn khóa và ngừng chạy: kết nối chủ, mở bằng mật khẩu rồi bật lại. Pending đã ký vẫn đối soát khi két đang khóa. Không tự bật hoặc tự ký lại một giao dịch chưa rõ kết quả.

Chỉ SOL native khả dụng hiển thị trong số dư ví. P&L/đường vốn tính ngân sách, giá vị thế và lãi đã chuyển; không tính mọi token khác trong ví. Không mua trộn hoặc tự bán token đã có sẵn. Browser signing cũ chỉ còn fallback khi server bật `SIGNER_MODE=disabled`; không chạy hai ngân sách đồng thời.

## Tốc độ

Quét DexScreener mục tiêu mỗi **5 giây**, bộ điều phối mỗi **2 giây** và chỉ đánh giá giá mới; thời gian API/RPC có thể làm vòng quét lâu hơn. Không còn thời gian chờ người ký. Giao diện đo riêng thời gian chuẩn bị, ký, phản hồi gửi RPC và xác nhận của lệnh gần nhất; không dùng thời gian ký để quảng cáo thời gian khớp. Đây **chưa phải hạ tầng mili giây**: chưa tích hợp feed gRPC/shred/WebSocket pool, colocation hay Jito. Không hứa latency hoặc khả năng khớp trước đối thủ. Muốn tiến tới mục tiêu đó cần dữ liệu on-chain, RPC chuyên dụng và đo tín hiệu → gửi → xác nhận; không thể suy ra từ thời gian ký cục bộ.

## Kết nối không dùng key

Server dùng `https://api.mainnet-beta.solana.com` và `https://solana-rpc.publicnode.com`. Trước dùng một RPC, kiểm tra genesis mainnet. RPC đọc lỗi/quá tải có thể chuyển sang nguồn dự phòng. Lệnh gửi không tự chuyển endpoint khi chưa rõ kết quả: giữ signature để đối soát, không gửi lệnh thay thế. Cả hai RPC vẫn có thể cùng lỗi hoặc rate-limit; không bảo đảm kết nối miễn phí luôn khả dụng.

`HELIUS_API_KEY`, `JUPITER_API_KEY` và cấu hình RPC cũ không được dùng. Chỉ constructor nội bộ cho test có thể truyền endpoint riêng. Không gửi khóa/seed qua chat hoặc Git. Quét thị trường vẫn dùng DexScreener; RPC không thay thế nguồn dữ liệu giá.

## Quy tắc và thuật toán

Bộ quy tắc runtime dùng chung: [src/desk-rules.js](src/desk-rules.js); mô tả: [DESK_RULES.md](DESK_RULES.md). Pipeline: screener → xác nhận setup → giới hạn rủi ro → kiểm tra on-chain → thực thi có chữ ký → thoát/chuyển lãi → kiểm toán. Đây là các module mã, không phải sáu AI độc lập.

- Vốn ≤0,3 SOL; mua 0,03 SOL/lệnh; tối đa 5 vị thế; dự phòng 0,05 SOL. Cắt lỗ -20%; ngừng mua mới khi lỗ/ngày 0,03 SOL hoặc drawdown 15%, vẫn xét thoát lệnh.
- +80% giá trị ròng: bán lượng đủ thu 140% vốn USD ban đầu. Phần còn lại bán nửa ở mỗi lần giá thực tế x2, cuối cùng đóng phần lẻ. Không tạo fill ở giá quá khứ nếu giá nhảy qua nhiều mốc.
- Pool PumpSwap ≥10h, profile, định giá $100k–$5m; liquidity ≥$25k và ≥5% định giá; volume 24h ≥$50k, 5m ≥$1k. H5 +1–12%, ≥10 lượt mua, mua/bán >1,3, volume tăng tốc ≥1,2; H1 dương/≤80%, không sụp H6 hoặc tăng quá mức H24. Volume giữa các khoảng phải nhất quán; giá phải hợp lệ.
- Hai quan sát cách 30s–3m phải giữ giá/thanh khoản. Có anchor, biến động giá và tỷ lệ giữ thanh khoản từ quan sát thực. Đây không phải dữ liệu nến OHLC; không suy diễn FVG hoặc tín hiệu 1D/4H từ số liệu 5m.
- Điểm ≥70 và mọi điều kiện đạt. Boost không cộng điểm. FDV có nhãn khi thiếu market cap; điểm không phải xác suất thắng.

SDK PumpSwap 2.1.0 dựng exact-input swap trực tiếp từ pool/config/reserve on-chain. Chỉ classic SPL/WSOL, không mayhem/cashback/Token-2022 hooks. Kiểm tra mint/freeze authority, phân bổ tài khoản lớn, pool đúng mint/program/PDA, slot, impact dự trữ ≤2%, slippage ≤1,5%, quote mua/bán vòng ≤8%; simulation toàn bộ tài khoản token đang sở hữu trước yêu cầu ký. Phí mạng ≤0,000025 SOL, swap/rent cộng thêm ≤0,005 SOL. Kiểm tra phân bổ không gộp theo chủ hưởng lợi, không chứng minh LP lock/insider/wash trading và có thể loại pool LP lớn. Chưa có bằng chứng thuật toán sinh lợi thực tế.

## Chuyển lãi

Đích cố định: **5uYdJyFmZkvZT5S3A7iq1kLx2aLwcMgVXMfxjdGf5qVZ**. Các API/UI không cho đổi đích.

Sau khi lệnh bán xác nhận, sổ tính lãi ròng bằng SOL sau giá vốn/chi phí và phí giao dịch thất bại. Trước mua tiếp, bot xét chuyển phần nhỏ hơn của lãi chưa chuyển và tiền mặt vượt phần vốn gốc chưa nằm trong token; đồng thời giữ ngân sách gốc tính theo tiền mặt cộng giá vốn token còn giữ, và tối thiểu 0,05 SOL native thực tế, dự phòng phí 0,00001 SOL. Tối thiểu chuyển 0,001 SOL, tối đa 0,3 SOL/lần. Chỉ lãi đã chốt, không dựa trên tăng giá chưa bán. Lỗ trước phải được bù lại; phần lợi nhuận còn nằm trong token được giữ đến khi có đủ tiền mặt.

Lệnh chuyển dùng ví chủ làm fee payer, đúng đích cố định, kiểm tra phí/số dư/simulation. Bộ ký đã mở tự ký; không chờ xác nhận từng lần. Chỉ ghi đã chuyển khi receipt xác nhận cả số dư giảm, số dư tăng của đích và fee. Kết quả chưa rõ được đối soát sau restart/reload mà không ký/gửi lại. Khoản chuyển được cộng lại khi tính tổng hiệu quả vốn để không hiện thành lỗ; phí chuyển vẫn làm giảm P&L.

Nguồn tính vốn/lãi là nhật ký `owner-agent-state.json` trên server. Đây không phải hợp đồng giới hạn chi tiêu hoặc sổ lưu bền vững trên server. Không sửa số liệu bằng tay hoặc chạy nhiều service/replica độc lập cho cùng ví. Chuyển/rút tài sản ngoài ứng dụng làm lệch sổ và phải kiểm tra trước khi tiếp tục.

## Nhật ký, kiểm toán và bảo mật

Nhật ký server gắn theo chủ, chứa vị thế, phí đo được, trades/payouts và pending transaction; không chứa private key hoặc mật khẩu. Trình duyệt server mode không lưu khóa hay journal cá nhân vào localStorage. Bộ ký chỉ ký giao dịch chuẩn bị bởi chính policy/execution nội bộ, đúng fee payer; server vẫn xác minh signer Ed25519/hash trước gửi. Ghi signed bytes/signature và fsync **trước broadcast**. Chỉ ghi fill sau xác nhận. Kết quả chưa rõ khóa lệnh mới cho tới đối soát; expiry chờ block height finalized. Lỗi token trước gửi được bỏ qua/cooldown; 3 lệnh lỗi/hết hạn liên tiếp dừng bộ điều phối. Lỗi lưu trữ dừng ký. Nút khóa ngăn ký tiếp ngay cả khi lưu lỗi. Ngừng trong lúc chuẩn bị sẽ hủy trước ký; đã ký nhưng chưa gửi vẫn giữ để đối soát/hết hạn.

Xuất nhật ký trước khi redeploy hoặc di chuyển dữ liệu. Xuất chỉ chứa state, không xuất két hoặc khóa. Khôi phục chỉ khi dừng và không có pending đang xử lý, phải cùng chủ, đúng schema; không reset budget khi còn vị thế. `owner-signer.json` chỉ chứa bản mã hóa; không tự tạo đè két có sẵn. Sau restart không có khóa trong RAM, kể cả sổ trước đó đang chạy. Dùng một service/replica.

**Lưu trữ Railway:** có volume thì két và sổ nằm trong `RAILWAY_VOLUME_MOUNT_PATH/meme-pilot`. Không có volume, service vẫn cho thiết lập và chạy nhưng dữ liệu có thể mất qua deploy/restart thay container. Khi mất sổ/khóa, bot không thể tự phục hồi hoặc quản lý vị thế cũ; cần khôi phục, đối chiếu on-chain và nhập lại khóa nếu két bị mất. Volume không bắt buộc để bấm chạy, nhưng cần cho lưu bền vững qua redeploy. Giao diện hiển thị rõ trạng thái lưu trữ.

Auditor hiển thị 7 ngày gần nhất: lệnh đóng, win rate, kỳ vọng R theo rủi ro ban đầu, max drawdown và vị thế >72h. Thiếu dữ liệu thì báo thiếu, không tự đặt fee/slippage bằng 0 hoặc bịa giao dịch giả định. Tham chiếu: ≥40 vị thế đóng đo được, win rate ≥33%, expectancy ≥+0,4R, max DD ≤15%. Không tự đổi ngưỡng sau khi xem kết quả, không tự bật quyền giao dịch vì báo cáo đạt. Chưa có đủ mẫu không phải bằng chứng có lãi.

Tài liệu đính kèm mô tả futures short/alerts-only; chỉ dùng ý tưởng phân vai, quy tắc chung và kiểm toán. Không nhập quy tắc short/FVG hoặc quyền hạn của tài liệu thay cho yêu cầu Solana spot.

Chủ cố định; nonce một lần 3 phút, session 15 phút; cookie HttpOnly/SameSite=Strict/Secure HTTPS; POST đúng origin/JSON/header. Tài chính chủ chỉ hiển thị sau đăng nhập. Legacy ví phụ chỉ giữ để khôi phục dữ liệu cũ; không xóa két/sổ cũ. `/api/live/backup` có bảo vệ chủ; API điều khiển ví phụ trả 410. Production dùng `OwnerAgent`/`OwnerSignerVault`; các module ví phụ cũ không được khởi tạo.

## Chạy và Railway

Node.js 24+:

```bash
npm ci --ignore-scripts --include=dev
npm run build
npm run check
npm test
npm start
```

Railway auto-deploy nhánh `codex/meme-pilot-railway` bằng Dockerfile/railway.json; một replica. Không dùng Docker secret mounts vì builder Railway hiện chỉ hỗ trợ cache mounts. Volume lưu sổ và két của bộ ký; thiếu volume được cảnh báo, không chặn thiết lập. `PUBLIC_ORIGIN` cần đúng HTTPS origin khi dùng domain riêng. Egress: DexScreener và hai RPC trên; không cần Helius/Jupiter. Install scripts tắt; SDK transitive TOML/BigInt dùng các bản override đã kiểm tra.

`/api/health`: `mode=live`, `rpcMode=keyless`, `signingMode=owner-agent` và `unattendedSigningAvailable=true`, `strategyVersion=solana-momentum-desk-v2`. Đây là HTTP/feed readiness, không chứng minh giao dịch/lợi nhuận. `/api/direct/status` cần đăng nhập chủ.

Kiểm thử dùng fixture, chữ ký ví thử và RPC giả lập. Chưa gửi giao dịch SOL thật, chưa kiểm chứng hiệu quả thị trường hoặc trạng thái Railway Online từ môi trường này.
