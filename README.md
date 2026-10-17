# Meme Pilot — Solana mainnet

Bot tự lọc token, ký giao dịch mainnet từ ví bot riêng và ghi nhận kết quả sau xác nhận Solana. Giao diện tiếng Việt có radar, nhật ký quyết định, đường vốn và nhện nhảy khi có lệnh mua/bán đã xác nhận. Mặc định không chạy mô phỏng, không tạo số dư hoặc fills giả.

Chỉ địa chỉ **7JePGU7MFtRo9z5jMh2486UniD4EB4PpRd8tv2Jhqpsy** được xác thực và điều khiển. Khách chưa đăng nhập chỉ xem thị trường; số dư và nhật ký tài chính bị ẩn. Địa chỉ chủ được cố định trong server, không thể đổi bằng biến môi trường hoặc API. Chữ ký đăng nhập không chuyển tiền.

## Bắt đầu trên Railway

Railway dùng Dockerfile và `railway.json`, tự deploy khi nhánh GitHub được kết nối có commit mới. Chạy **một replica** với một volume; không chia sẻ sổ ví giữa nhiều tiến trình.

1. Trong service `trade-meme`, gắn **Volume** (ví dụ mount `/app/.data`). Server tự dùng `RAILWAY_VOLUME_MOUNT_PATH/meme-pilot`, tạo thư mục riêng và chạy HTTP/signer bằng UID 1000. Không có volume thì không cho tạo két, nạp hoặc bật tiền thật.
2. Mở website qua HTTPS. Bấm **Kết nối ví chủ** bằng Phantom/Solflare. Trên điện thoại dùng trình duyệt trong ví. Ví khác bị ngắt kết nối và server từ chối chữ ký.
3. Tạo két với mật khẩu ít nhất 12 ký tự. Nhập **Helius API key** để dùng RPC Helius mainnet và **Jupiter API key** để lấy route swap. Các key được mã hóa trong két. Helius cung cấp RPC; Jupiter cung cấp báo giá và giao dịch swap. Helius không thay thế Jupiter API key.
4. Tải bản sao ví mã hóa và cất mật khẩu riêng. Sau đó bấm **Nạp đến 0,3 SOL từ ví chủ**, kiểm tra giao dịch trên ví trước khi ký. Đây là giao dịch chuyển SOL thật từ ví chủ sang địa chỉ ví bot hiển thị trên trang. Không gửi seed phrase hoặc private key cho ứng dụng/chat.
5. Đợi số dư RPC cập nhật rồi bấm **Bật giao dịch thật**. Bot chỉ mua token đạt toàn bộ điều kiện, có thể không có lệnh trong nhiều giờ.

Có thể cấu hình `HELIUS_API_KEY`, `JUPITER_API_KEY` qua Railway Variables thay cho nhập trong giao diện. `SOLANA_RPC_URL` cho phép RPC HTTPS khác; nếu không cấu hình RPC/key thì dùng public Solana mainnet RPC, dễ bị giới hạn tốc độ. Key Helius nhập trong két được ưu tiên hơn RPC từ môi trường. Không đưa URL chứa key vào Git hoặc chat.

`PUBLIC_ORIGIN` mặc định lấy Railway public domain. Nếu dùng tên miền riêng, đặt đúng origin HTTPS. Không dùng wildcard. Két tự khóa sau restart. Muốn tự mở khóa sau restart, lưu `BOT_VAULT_PASSWORD` trong Railway Variables; đây là quyền truy cập khóa ví, chỉ quản trị viên hạ tầng được đọc. Không có biến này thì đăng nhập và mở két lại sau mỗi deploy. Khi đã bật trước đó, bot chỉ tiếp tục sau mở khóa, giá mới và đối soát.

Tôi chưa thực hiện giao dịch mainnet hoặc xác minh có lãi. Test dùng dữ liệu tổng hợp và RPC giả lập. Triển khai code không đồng nghĩa ví đã được nạp hoặc bot đang ký lệnh.

## Vốn và thoát lệnh

| Giới hạn | Mặc định |
| --- | --- |
| Vốn ban đầu tối đa | 0,3 SOL trong ví bot |
| Mỗi lần mua | 0,03 SOL, cộng phí mạng/rent được kiểm tra |
| Vị thế đồng thời | 5 |
| SOL dự phòng | Ít nhất 0,05 SOL khi mua mới |
| Ngưỡng cắt lỗ | −20% giá trị ròng so với giá vốn USD của phần còn lại |
| Chốt lần đầu | Khi đạt +80%, bán lượng đủ thu khoảng 140% vốn USD ban đầu |
| Phần thả nổi | Mỗi lần giá tăng gấp đôi từ lần chốt trước, bán 50% phần còn lại |
| Đóng phần lẻ | Giá trị ròng ≤0,25 USD hoặc ≤0,0001% lượng token ban đầu |
| Khóa mua mới | Lỗ/ngày 0,03 SOL hoặc drawdown 15% |
| Cooldown token | 30 phút sau đóng vị thế hoặc từ chối kiểm tra chính sách |

Ví dụ mua $100: khi giá trị ròng đạt $180, mục tiêu thu $140, phần còn lại tiếp tục chạy. Khi giá nhảy qua nhiều mốc, bot chốt một lần theo báo giá đang có; không tạo lệnh tại giá quá khứ. Mainnet kiểm tra lại lượng bán bằng báo giá Jupiter ròng sau phí. Giá tham chiếu, giá quote, thời điểm xác nhận và SOL/USD có thể lệch nhau; không bảo đảm thu đúng số USD hoặc bán đúng ngưỡng cắt lỗ.

Lỗ/ngày tính theo tổng equity cả vị thế mở, mốc UTC. Khóa rủi ro giữ qua restart và không tự xóa khi sang ngày; vẫn quản lý thoát lệnh nếu bot đang bật. **Dừng ký lệnh/Khóa két** dừng cả tự mua và tự bán, không đóng vị thế. Muốn rút SOL, đóng hết vị thế, đợi đối soát rồi rút; người nhận cố định là ví chủ. Không nạp/rút trực tiếp ngoài luồng sau khi đã bật: số dư thay đổi ngoài sổ sẽ làm bot dừng để đối soát.

## Lọc token và chấm điểm

Nguồn DexScreener gồm các tìm kiếm giới hạn và tối đa 30 profile Solana mới nhất. Đây không phải toàn bộ token trên Solana. Giữ cập nhật riêng cho token đang nắm. Ưu tiên pool PumpSwap theo mint; profile hay boost không chứng minh token an toàn.

Điều kiện bắt buộc: PumpSwap; có profile; pool từ 10 giờ; market cap 100.000–5.000.000 USD (dùng FDV có ghi nhãn khi thiếu market cap); thanh khoản ≥25.000 USD và ≥5% định giá; volume 24h ≥50.000 USD; volume 5m ≥1.000 USD; tăng 5m +1–12%; ≥10 lượt mua và mua/bán >1,3; volume 5m tăng ≥1,2 lần so với trung bình các đoạn 5m còn lại trong giờ. H1 phải dương và ≤80%; loại H6 dưới −30% hoặc H24 trên +500%. Cần hai quan sát cách nhau 30 giây–3 phút, giữ lực mua/giá và không rút thanh khoản quá 15%. Feed quá 90 giây không dùng để vào/thoát lệnh.

Điểm liên tục theo độ sâu (15), hoạt động (10), momentum (15), áp lực mua (15), tăng volume (15), xu hướng (10), xác nhận (10), profile (5), độ tin cậy market cap (5; FDV 2). Cần ≥70/100 và toàn bộ điều kiện. Boost trả phí không cộng điểm. Điểm không phải xác suất thắng; thuật toán chưa có bằng chứng lợi nhuận ngoài thị trường.

Trước mua: kiểm tra mint classic SPL, quyền mint/freeze đã tắt, không tài khoản token nào giữ quá 20% supply, có route mua và bán lại, quote mới, price impact tối đa 2%, slippage tối đa 1,5%, ngưỡng chi phí quote vòng mua/bán 8%. Kiểm tra tài khoản lớn không gộp theo chủ hưởng lợi, không xác minh LP lock, insider/bundle, giao dịch wash hoặc loại trừ LP. Có thể bỏ sót rủi ro hoặc loại nhầm token có pool giữ cung lớn. Không hỗ trợ Token-2022/transfer hooks. Vẫn có rủi ro rug, MEV, thanh khoản biến mất và mất vốn.

## Bảo mật và đối soát

Két AES-256-GCM với scrypt; file 0600, thư mục 0700. Khóa riêng chỉ dùng trên server khi mở két; không trả lại cho trình duyệt. Bản sao mã hóa cần mật khẩu để khôi phục. Chạy server và người quản trị Railway có quyền truy cập bộ nhớ có thể tiếp cận khóa khi két đang mở; mã hóa trên đĩa không ngăn được máy chủ đã bị chiếm quyền.

Nonce đăng nhập dùng một lần, hạn 3 phút; session ngẫu nhiên hạn 15 phút, cookie HttpOnly/SameSite=Strict/Secure trên HTTPS. POST yêu cầu đúng origin, JSON và header riêng; giới hạn số lần thử. Dữ liệu ví, export và backup yêu cầu đăng nhập chủ. Không lưu key hoặc mật khẩu trong localStorage, log hay Git.

Mainnet kiểm tra genesis hash, fee payer, chương trình, phí và trạng thái sau mô phỏng transaction trước khi ký. Mô phỏng transaction là kiểm tra kỹ thuật RPC, không phải giao dịch giấy. Một giao dịch chưa xác định kết quả khóa lệnh mới; signature được fsync trước broadcast và đối soát theo receipt sau restart, không tự gửi lại với signature mới. Phí mạng tối đa 0,000025 SOL, ưu tiên tối đa 0,00002 SOL; thay đổi SOL do swap/rent chịu giới hạn cộng thêm 0,005 SOL. Lệnh lỗi có thể vẫn tốn phí và khiến kiểm tra số dư dừng bot; không giả ghi nhận thành công.

Mất RPC/feed, sai số dư hoặc kiểm tra không đạt có thể dừng ký. Cần xem nhật ký trước bật lại. Mất quyền đọc volume, mất password hoặc mất bản sao có thể cản trở khôi phục tài sản. Sao lưu volume (két và live-state) cùng bản sao mã hóa. Đây chưa phải audit bảo mật độc lập.

## Chạy local và kiểm tra

Cần Node.js 24+:

```bash
npm ci --ignore-scripts
npm run build
npm run check
npm test
npm start
```

Mở `http://127.0.0.1:3000`. Sao chép `.env.example` nếu cần đổi cấu hình. Chỉ chạy một tiến trình. Docker Compose có volume và restart:

```bash
docker compose up -d --build
```

Đóng tab không dừng bot; máy/server phải còn chạy và có mạng. Các domain cần: `api.dexscreener.com`, `api.jup.ag`, `mainnet.helius-rpc.com` hoặc RPC đã cấu hình.

`/api/health`: `status:ok` chỉ kiểm tra HTTP, `marketFresh` kiểm tra feed; không chứng minh signer sẵn sàng hoặc giao dịch đã khớp. `/api/state` mặc định mainnet, ẩn tài chính khi chưa xác thực. `/api/live/status` và `/api/export` cần phiên chủ. Dữ liệu nằm trong scanner-state.json, live-state.json và wallet-vault.json trên volume. Cửa sổ fills 500, quyết định 300, log 200, đường vốn 1.440 điểm; xuất lịch sử trước khi vượt cửa sổ nếu cần lưu lâu dài.

Engine paper chỉ phục vụ test nội bộ khi đặt rõ `PAPER_WORKSPACE=true`; không bật cờ này trên service tiền thật. Test tổng hợp không chứng minh kết quả mainnet. Bộ test bao gồm xác thực/replay/origin, mã hóa/tamper, giới hạn giao dịch, quote/simulation, WAL/đối soát, bộ lọc và chốt lời từng phần.

## Dependency audit

Pin `@solana/web3.js` 1.98.4 và override jayson 5.0.0 (giữ API browser client đang dùng, loại bỏ uuid/stream-json cũ có advisory). Kiểm thử transport JSON-RPC qua cấu hình Helius xác nhận client tương thích. `npm audit --omit=dev` hiện báo 0 advisory; kết quả này không thay thế audit độc lập của ứng dụng hoặc hợp đồng token.
