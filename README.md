# Meme Pilot — giao dịch trực tiếp bằng ví chủ

Ứng dụng quét token Solana/PumpSwap, đề xuất mua/bán và đưa giao dịch mainnet sang **Phantom hoặc Solflare của chủ ví để ký**. Chỉ địa chỉ **7JePGU7MFtRo9z5jMh2486UniD4EB4PpRd8tv2Jhqpsy** được đăng nhập. Không tạo ví phụ, không chuyển vốn sang ví khác, không giữ khóa riêng của ví chủ trên server và không cần volume Railway để giao dịch.

**Kết nối ví không cấp quyền tự ký 24/24.** Chữ ký đăng nhập chỉ xác thực. Mỗi giao dịch mua/bán cần chủ ví xác nhận trong ứng dụng ví. Phiên bản này tự chọn tín hiệu và tỷ lệ thoát; chưa có cơ chế ủy quyền ký không giám sát. Không yêu cầu seed phrase/private key trong chat hoặc giao diện.

## Dùng website

1. Mở trang HTTPS trong Phantom/Solflare hoặc trình duyệt đã cài extension. Bấm **Kết nối ví chủ**, chọn đúng địa chỉ và ký thông điệp đăng nhập.
2. Nhập **Helius API key** cho RPC; giao dịch được dựng trực tiếp bằng SDK PumpSwap, không dùng Jupiter hoặc key swap riêng, bấm **Lưu kết nối phiên này**. Có thể cấu hình Helius key trong Railway Variables thay cho nhập trên trang. Key nhập ở giao diện chỉ lưu trong bộ nhớ server đến restart, không lưu vào localStorage hoặc nhật ký.
3. Kiểm tra số dư SOL đọc từ ví chủ rồi bấm **Bật bot chọn lệnh**. Ngân sách ứng dụng giới hạn tối đa 0,3 SOL trong số SOL đang có; không cần giao dịch nạp riêng.
4. Bot tự chọn mua/bán và mở yêu cầu ký khi tab đang hiển thị. Xem và xác nhận trong ví. Có thể tắt **Tự mở yêu cầu ký** để bấm **Ký mua/bán** thủ công. Từ chối ký hoặc lỗi chuẩn bị sẽ dừng bot, không tự mở lại yêu cầu liên tục. Ứng dụng ghi giao dịch đã ký vào nhật ký trình duyệt trước khi gửi lên mạng. Chỉ ghi nhận vị thế/fill sau xác nhận Solana.
5. Giữ tab mở để tiếp tục theo dõi. Đóng tab, ví chưa ký hoặc mất dữ liệu sẽ không thực hiện cắt lỗ/chốt lời. **Dừng theo dõi** không đóng vị thế. Có thể ký bán toàn bộ phần token do ứng dụng quản lý từ danh sách vị thế.

Bảng số dư hiển thị SOL native khả dụng của ví chủ, không phải tổng giá trị mọi tài sản trong ví. P&L/đường vốn chỉ tính ngân sách và các giao dịch được ứng dụng ghi nhận, gồm đánh dấu giá vị thế chưa chốt. Token đã có sẵn trong ví không được tự động đưa vào danh mục bán. Trước mua, nếu ví đã giữ cùng mint, ứng dụng từ chối để tránh trộn tài sản.

## Vốn và chiến lược

| Giới hạn | Giá trị |
| --- | --- |
| Ngân sách ban đầu trong ví chủ | Tối đa 0,3 SOL, theo số dư thực tế khi khởi tạo nhật ký |
| Mỗi lần mua | 0,03 SOL + phí/rent được kiểm tra |
| Vị thế đồng thời | 5 |
| Dự phòng | 0,05 SOL trong ngân sách và trong ví |
| Cắt lỗ đề xuất | −20% giá trị ròng so với giá vốn USD của phần còn lại |
| Chốt lần đầu | Đạt +80%: bán lượng đủ thu khoảng 140% vốn USD ban đầu |
| Phần còn lại | Mỗi lần giá x2 từ lần chốt trước, đề xuất bán 50% |
| Đóng phần lẻ | Giá trị ròng ≤0,25 USD hoặc ≤0,0001% lượng token ban đầu |
| Khóa mua mới | Lỗ/ngày 0,03 SOL hoặc drawdown 15% |
| Cooldown | 30 phút sau khi đóng vị thế |

Ví dụ mua $100: khi giá trị ròng đạt $180, mục tiêu thu $140; phần còn lại chạy theo các mốc x2. Lệnh vẫn cần ví ký. Giá quote, phí, thời điểm xác nhận và SOL/USD có thể thay đổi; không bảo đảm chốt đúng số USD hay cắt lỗ đúng −20%. Không tạo lệnh giả tại giá quá khứ nếu giá nhảy qua nhiều mốc.

Giới hạn ngân sách và lỗ áp dụng trong nhật ký trình duyệt. Chỉ dùng **một hồ sơ trình duyệt hoạt động** cho ví; không khởi tạo các ngân sách độc lập trên nhiều thiết bị. Những giới hạn này không phải quyền hạn của smart contract và không chặn chủ ví tự giao dịch ngoài ứng dụng. Khi token thực tế thấp hơn số lượng ứng dụng quản lý, ứng dụng dừng theo dõi để chủ ví kiểm tra giao dịch ngoài luồng.

## Quét và kiểm tra token

DexScreener cung cấp tập tìm kiếm giới hạn và tối đa 30 profile Solana mới nhất, không phải toàn bộ thị trường. Các mint vị thế đang quản lý được cập nhật riêng.

Điều kiện bắt buộc: PumpSwap, có profile, pool từ 10 giờ; market cap $100k–$5m (FDV được ghi nhãn khi thiếu market cap); thanh khoản ≥$25k và ≥5% định giá; volume 24h ≥$50k; volume 5m ≥$1k; tăng giá 5m +1–12%; ≥10 lượt mua và mua/bán >1,3; volume 5m tăng tốc ≥1,2 lần so với phần giờ còn lại. H1 dương và ≤80%; loại H6 dưới −30% hoặc H24 trên +500%. Hai quan sát cách nhau 30 giây–3 phút phải giữ lực mua/giá và không mất thanh khoản quá 15%. Dữ liệu quá 90 giây không dùng để đề xuất lệnh.

Điểm liên tục theo độ sâu, hoạt động, momentum, áp lực mua, tăng volume, xu hướng, xác nhận, profile và độ tin cậy định giá. Cần ≥70/100 và toàn bộ điều kiện. Boost trả phí không cộng điểm. Điểm không phải xác suất thắng.

Trước ký: kiểm tra classic SPL, quyền mint/freeze đã tắt, không tài khoản token nào giữ quá 20% supply; có quote mua và bán lại; kiểm tra pool on-chain đúng mint/WSOL và chương trình PumpSwap, chỉ hỗ trợ pool v2 không mayhem/cashback; kiểm tra slot, price impact ≤2%, slippage ≤1,5%, quote chi phí vòng mua/bán ≤8%. Kiểm tra tài khoản lớn không gộp theo chủ hưởng lợi, không xác minh LP lock, insider/bundle hoặc wash trading và có thể loại cả LP pool lớn. Không hỗ trợ Token-2022/transfer hooks. Thuật toán chưa có bằng chứng sinh lợi ngoài thị trường.

## Ký, lưu lịch sử và đối soát

Server chỉ chuẩn bị giao dịch **chưa ký** cho đúng fee payer là ví chủ. Ví extension ký trên trình duyệt. Trước gửi, server xác minh chữ ký Ed25519 của chủ ví và hash thông điệp phải khớp giao dịch đã chuẩn bị; server không có phương thức tự ký từ khóa ví chủ. Kiểm tra RPC simulation trước ký là bước kỹ thuật, không phải giao dịch giấy.

Nhật ký localStorage gắn theo địa chỉ chủ, chứa vị thế, fills và giao dịch chờ; không chứa khóa riêng/API key. Signature và bytes đã ký được lưu **trước broadcast**. Nếu mất phản hồi hoặc server restart, chỉ đối soát signature đang có; không tạo signature thay thế. Yêu cầu chưa gửi bị gián đoạn có thể hủy riêng. Giao dịch đã gửi phải chờ xác nhận/hết hạn. Phí thực tế của giao dịch thất bại vẫn được ghi vào ngân sách.

**Xuất nhật ký giao dịch** trước khi xóa dữ liệu trình duyệt/đổi thiết bị; dùng **Khôi phục nhật ký** trên thiết bị mới và đợi kiểm tra số token. Không xóa nhật ký để xử lý giao dịch chưa rõ kết quả. Server không giữ bản sao đầy đủ của nhật ký cá nhân và không tự khôi phục giá vốn của giao dịch ngoài ứng dụng. Các bản sao cũ cần đối chiếu lịch sử ví trước khi tiếp tục dùng.

Nonce đăng nhập một lần, hạn 3 phút; session hạn 15 phút, cookie HttpOnly/SameSite=Strict/Secure trên HTTPS. POST yêu cầu đúng origin/JSON/header riêng. Hết phiên cần kết nối lại; giao dịch chờ vẫn giữ trong nhật ký. Ngăn trùng yêu cầu trong tab, dùng Web Locks nếu trình duyệt hỗ trợ và một intent chưa giải quyết trên server. Kiểm tra ví lại trước ký. Không bán quá số raw token được ứng dụng quản lý, kể cả khi ví có thêm cùng token.

Giao dịch được kiểm tra genesis mainnet, chương trình, phí, đầu vào/đầu ra và thay đổi tài khoản token sau simulation. Phí mạng ≤0,000025 SOL, ưu tiên cố định tối đa 0,000015 SOL (300.000 CU); giới hạn cộng thêm cho swap/rent 0,005 SOL. Mất mạng, thanh khoản hoặc thiếu chữ ký vẫn có thể gây lỗ; đây chưa phải audit độc lập và không có cam kết lợi nhuận.

## Railway và local

Railway tự deploy nhánh `codex/meme-pilot-railway` bằng Dockerfile/railway.json. Volume chỉ còn là lựa chọn lưu lịch sử scanner, không phải điều kiện kết nối/ký lệnh. Không dùng `RUN --mount=type=secret` vì builder Railway hiện chỉ hỗ trợ cache mount. Một service/replica được khuyến nghị cho bộ điều phối intent. Domain riêng cần `PUBLIC_ORIGIN` khớp đúng origin HTTPS.

Biến môi trường tùy chọn: `HELIUS_API_KEY` hoặc `SOLANA_RPC_URL` HTTPS khác. Địa chỉ ví chủ cố định, không đổi qua biến môi trường. Chỉ cấu hình key qua giao diện đã đăng nhập hoặc Railway Variables, không qua chat/Git. Mainnet cần HTTPS tới `api.dexscreener.com`, `mainnet.helius-rpc.com` hoặc RPC đã chọn.

Dữ liệu ví phụ cũ không bị xóa hoặc tự chuyển tiền; bản mã hóa cũ, nếu có, vẫn có thể tải qua `/api/live/backup` sau đăng nhập chủ để khôi phục riêng. Các API tạo/nạp/điều khiển ví phụ đã ngừng hoạt động. `BOT_VAULT_PASSWORD` không được dùng trong luồng ví chủ.

Cần Node.js 24+:

```bash
npm ci --ignore-scripts --include=dev
npm run build
npm run check
npm test
npm start
```

`/api/health` xác nhận HTTP và feed, không xác nhận ví đã ký hay có lãi. `/api/state` cung cấp scanner và ẩn tài chính; bảng tài chính chủ ví được dựng từ RPC và nhật ký của trình duyệt đã đăng nhập. API `/api/direct/*` cần phiên chủ. Khóa/seed ví không được nhập vào ứng dụng.

Kiểm thử dùng fixture tổng hợp: chuẩn bị unsigned swap, xác minh chữ ký và nội dung, từ chối ví sai, ngân sách, tài sản có sẵn, đối soát sau restart và fills không lặp. Trình duyệt kiểm tra ghi nhật ký trước ký/trước gửi, không tạo fill trước xác nhận, reload không ký lại và giao diện mobile. Chưa gửi giao dịch mainnet thật. Engine paper/legacy signer chỉ còn dùng trong test nội bộ; không bật `PAPER_WORKSPACE=true` trên sản phẩm.

Swap dùng `@pump-fun/pump-swap-sdk` 2.1.0 (chỉ pool v2 SOL/classic SPL), không gọi Jupiter. SDK đọc pool/phí/dự trữ qua RPC Helius. Native BigInt chuyển đổi dùng bản JS của `@exodus/bigint-buffer` thay cho native addon cũ; TOML gián tiếp được nâng lên 4.2.0. Cài đặt vẫn tắt install scripts.
