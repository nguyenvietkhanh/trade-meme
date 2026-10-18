# Meme Pilot — Solana spot

Bot chọn token PumpSwap và tự ký từ ví chủ **7JePGU7MFtRo9z5jMh2486UniD4EB4PpRd8tv2Jhqpsy**. Không cần Helius/Jupiter API key, không tạo ví phụ.

**Kết nối ví chỉ xác thực chủ.** Muốn tự giao dịch không chờ ký, chủ nhập private key của đúng ví một lần qua giao diện đã đăng nhập trên Railway HTTPS hoặc localhost 127.0.0.1. Két AES-256-GCM/scrypt giữ bản mã hóa; mở khóa nạp khóa ký vào RAM. Không nhập seed phrase, không gửi khóa/mật khẩu trong chat hoặc Git. Private key có quyền với toàn bộ ví; hạn mức 1,19 SOL do phần mềm thực thi, không phải hạn mức on-chain. Không dùng ví này giữ tài sản vượt mức chấp nhận rủi ro của bạn.

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

Khám phá tìm kiếm/profiles/pool mới chạy nền mỗi 30 giây sau lần khởi tạo đầu, để nguồn phụ chậm không giữ vòng giá. Giá token và giá SOL vẫn được lấy lại mỗi vòng, deadline 4 giây mỗi đợt; không dùng giá tìm kiếm đã lưu làm giá mới. Danh sách nhớ tối đa 600 mint, lưu cùng trạng thái quét: pool mới và cũ đều được tái xét ngay, không chờ đủ tuổi và không bị loại vì đã tồn tại quá 24 giờ. Mỗi vòng thêm tối đa 30 mint cũ theo lượt; đây không phải cam kết cập nhật cả 600 mint mỗi 5 giây. Ưu tiên token đạt tầng vốn hóa/DEX và xu hướng giá trước khi cắt danh sách 60 token, luôn giữ token vị thế đang theo dõi.

## Kết nối không dùng key

Server dùng `https://api.mainnet-beta.solana.com` và `https://solana-rpc.publicnode.com`. Trước dùng một RPC, kiểm tra genesis mainnet. RPC đọc lỗi/quá tải có thể chuyển sang nguồn dự phòng. Lệnh gửi không tự chuyển endpoint khi chưa rõ kết quả: giữ signature để đối soát, không gửi lệnh thay thế. Cả hai RPC vẫn có thể cùng lỗi hoặc rate-limit; không bảo đảm kết nối miễn phí luôn khả dụng.

`HELIUS_API_KEY`, `JUPITER_API_KEY` và cấu hình RPC cũ không được dùng. Chỉ constructor nội bộ cho test có thể truyền endpoint riêng. Không gửi khóa/seed qua chat hoặc Git. Quét thị trường vẫn dùng DexScreener; RPC không thay thế nguồn dữ liệu giá.

## Quy tắc và thuật toán

Bản `solana-six-stage-desk-v4`; chi tiết và giới hạn: [DESK_RULES.md](DESK_RULES.md). Sáu tầng thực thi bằng code, không phải AI được tự bỏ qua hard limits.

- Khám phá pool PumpSwap mới qua GeckoTerminal, DexScreener và profiles. Tầng nhanh lọc vốn hóa **$3k–$5m**, không giới hạn tuổi pool, quote reserve ≥20 SOL, tổng liquidity/cap ≥3%, nhịp giao dịch và blacklist tên token lớn. FDV chỉ thay cap khi mint kết thúc `pump`. Đánh giá lại mỗi 5 giây, không nghỉ token 30 phút vì trượt tầng lọc; thời hạn cũ được xóa khi cập nhật. API chậm có thể kéo dài vòng quét, không chạy chồng yêu cầu.
- Tuổi pool không chặn BUY và không cộng/trừ điểm. Trọng số: động lượng 30, dòng tiền 20, cấu trúc giá 20, thanh khoản/vốn hóa 15, phân bổ holder 10, cộng đồng 5. Ngưỡng 60 điểm, xác nhận hai lần quét và kiểm chứng an toàn vẫn áp dụng. Chỉ dùng thời điểm tạo pool để đánh giá dữ liệu nến H4; thiếu lịch sử nến được ghi chưa biết, không trở thành lệnh cấm theo tuổi.
- Mỗi 10.000 lượt đánh giá, xóa danh sách đánh giá và đặt bộ đếm vòng về 0 rồi tiếp tục quét. Đây là lượt đánh giá, có thể lặp cùng token. Giữ tổng lượt toàn thời gian, số vòng, blacklist, tín hiệu xác nhận, lịch sử khớp lệnh, vị thế, lệnh đang chờ và mọi giới hạn rủi ro. Lỗi kiểm chứng dịch vụ được ghi rõ nguồn/trạng thái HTTP và có thể thử lại từ vòng quét sau; không bỏ kiểm chứng để ép mua.
- On-chain/RugCheck/Jupiter bắt buộc xác minh authority, Token-2022 extensions, LP ≥90%, top 10 trừ vault/curve ≤35%, mỗi ví ≤8%, rủi ro nghiêm trọng và quote vòng 0,2 SOL hao hụt ≤6%, impact mỗi chiều ≤2%. Không đủ kiểm chứng → SKIP. Creator không rõ vẫn nhận điểm holder thấp hơn; không tự đặt tỷ lệ bằng 0.
- DexScreener thiếu trường `liquidity.quote` thì vẫn đưa token tới bước đọc pool on-chain; BUY chỉ qua khi số dư quote SOL thực được xác minh ≥20 SOL, đúng mint/pool và còn mới. Không dùng tổng USD để suy ra số dư. RPC không có chỉ mục tài khoản sẽ thử nguồn đọc dự phòng; nếu cả hai không đọc đủ holder thì vẫn khóa BUY và ghi đúng lý do.
- Điểm 30/20/20/15/10/5. Thiếu dữ liệu chấm điểm nhận nửa điểm thành phần; an toàn bắt buộc vẫn không được bỏ qua. Hai lần quét cách 10–15 giây. Mọi lệnh BUY mới cố định 0,2 SOL khi đạt ≥60 điểm, kể cả khi creator/H4 chưa rõ; các điểm trừ và kiểm tra an toàn giữ nguyên. Vốn tối đa 1,19 SOL, số vị thế theo vốn khả dụng thay vì giới hạn cố định 2; luôn giữ dự phòng 0,05 SOL và phí trước từng lệnh. Vị thế thả nổi vẫn được giữ và theo dõi.
- Chỉ mua khi M5 và H1 đều dương và giá không giảm giữa hai quan sát xác nhận. H4 dùng OHLCV 4 giờ thực, bao gồm nến đang hình thành của pool mới: tránh thân đỏ giảm ≥20% đóng gần đáy, hoặc tăng ≥50% rồi tụt ≥35% từ đỉnh với râu trên ≥55% biên nến. H4 chưa đủ dữ liệu trừ 5 điểm; không bắt pool mới chờ đủ bốn giờ. Một tín hiệu H4 xấu đã thấy được giữ tối đa bốn giờ nếu nguồn lỗi, cho đến khi có nến mới xác minh phục hồi. Mint ví dụ chủ yêu cầu tránh nằm trong `ENTRY_EXCLUDED_MINTS`; quy tắc này không ngăn bán vị thế đang có.
- Stop −20% theo quote bán ròng; +80% bán 78%; moonbag bán nửa tại 2×/4×/8× giá vào. Trailing −30%, siết −25% từ 4×, −20% từ 8×. Time-stop 45 phút chưa từng đạt +20%; giữ tối đa sáu giờ; volume suy kiệt dưới 30% lúc vào và giá dưới entry thì thoát. Token đã stop-loss khóa 24 giờ.
- Đã bỏ giới hạn lỗ/ngày và gỡ khóa BUY loại `daily` cũ khi đọc sổ/kiểm tra rủi ro; không tự bật bộ ký đang khóa hoặc xóa các giới hạn khác. Drawdown 15% đóng hết vị thế rồi dừng, cần bật lại thủ công. Đã bỏ nghỉ BUY sau chuỗi thua; vẫn ghi số vị thế thua liên tiếp và gỡ thời hạn nghỉ cũ khi đọc sổ/kiểm tra rủi ro. Dữ liệu cũ >30 giây hoặc lỗi liên tiếp khóa BUY nhưng vẫn quản lý SELL. Có nút pause BUY riêng và dừng/khóa toàn bộ bộ ký.
- Slippage mua/bán/khẩn ≤4/3/10%; priority+tip ≤0,002 SOL/chiều (thực tế dùng mức thấp hơn, không gửi Jito tip). Tối đa ba retry sau lần đầu, luôn đối soát giao dịch chưa rõ kết quả. Bán hết sẽ đóng ATA trống do vị thế ứng dụng quản lý để thu hồi rent khi an toàn.

Jupiter chỉ cung cấp báo giá và mức nhận tối thiểu; SDK PumpSwap dựng và mô phỏng giao dịch trên pool. Token cổ điển và Token-2022 với extension thụ động được hỗ trợ; fee/hook/permanentDelegate và extension chưa hiểu bị từ chối. Quote chưa phải giá khớp thật. Cấu trúc nến lấy OHLCV 1 phút; nếu không đủ nến hợp lệ thì chỉ nhận nửa điểm, không dựng nến từ snapshot.

Giao diện đếm riêng số token bị chặn ở tầng nguồn, thị trường, an toàn, xác nhận và điểm. Lý do chính không tính các kiểm chứng chưa được yêu cầu cho token đã bị loại ở tầng trước. Ví chủ có trạng thái riêng cho bộ ký khóa/chưa bật, pause BUY, RPC lỗi, hạn mức vốn, cooldown và hết retry. Quét tăng không chứng minh đã bật thực thi.

**Chưa xác nhận trực tiếp mainnet/Railway:** API/RPC có thể bị chặn hoặc rate-limit. Môi trường Codex từng trả `CONNECT 403` từ proxy Envoy trước khi tới Railway/DexScreener/RugCheck/Jupiter; điều này không chứng minh dịch vụ trên Railway trả 403. Khi dữ liệu an toàn không có, bot không mua. Nguồn HTTP không bảo đảm bắt đủ mọi pool migrate hoặc tốc độ mili giây. Chưa có bằng chứng sinh lợi thực tế.

## Chuyển lãi

Đích cố định: **5uYdJyFmZkvZT5S3A7iq1kLx2aLwcMgVXMfxjdGf5qVZ**. Các API/UI không cho đổi đích.

## Báo cáo Telegram

Đăng nhập đúng ví chủ → mở khóa bộ ký → mục **Telegram · Báo cáo giao dịch** → nhập bot token và Chat ID → **Lưu và bật báo cáo Telegram** → **Gửi tin thử**. Trước đó bấm **Start** trong bot Telegram để bot có thể nhắn riêng. Chỉ chủ đã xác thực và đúng origin HTTPS/loopback được lưu cấu hình hoặc gửi thử. Token không được nhúng vào Git, trả về API, ghi log, localStorage hay bản xuất nhật ký.

`telegram-config.json` trong DATA_DIR mã hóa AES-256-GCM, khóa HKDF từ khóa ví chủ, salt/IV ngẫu nhiên và AAD ràng buộc ví; file 0600. Sau restart, cần mở khóa bộ ký để đọc cấu hình. Tắt Telegram xóa cấu hình hoạt động; lưu cấu hình mới cho phép thử lại tin từng thất bại. Volume giữ cả cấu hình và hàng đợi qua redeploy.

Sau mỗi BUY/SELL **đã xác nhận**, hàng đợi được ghi cùng cập nhật receipt trước khi gửi: SOL chi/nhận thực, phí mạng, PnL lần bán, PnL đã chốt của vị thế/tổng tài khoản, ngân sách còn lại và link giao dịch. Không biến yêu cầu lệnh hay lợi nhuận chưa chốt thành báo cáo thành công. Gửi HTTP bên ngoài hàng đợi giao dịch, tối đa sáu lần thử; lỗi Telegram không tắt bot hoặc tạo lại giao dịch. Telegram không có khóa idempotency cho sendMessage: nếu đã nhận tin nhưng phản hồi bị mất, retry có thể tạo tin trùng cùng signature. API chỉ dùng `api.telegram.org`, không theo redirect; lỗi hiển thị không chứa token. Chưa xác minh gửi tới bot/chat thật từ môi trường này.

Sau khi lệnh bán xác nhận, sổ tính lãi ròng bằng SOL sau giá vốn/chi phí và phí giao dịch thất bại. Trước mua tiếp, bot xét chuyển phần nhỏ hơn của lãi chưa chuyển và tiền mặt vượt phần vốn gốc chưa nằm trong token; đồng thời giữ ngân sách gốc tính theo tiền mặt cộng giá vốn token còn giữ, và tối thiểu 0,05 SOL native thực tế, dự phòng phí 0,00001 SOL. Tối thiểu chuyển 0,001 SOL, tối đa 0,3 SOL/lần. Chỉ lãi đã chốt, không dựa trên tăng giá chưa bán. Lỗ trước phải được bù lại; phần lợi nhuận còn nằm trong token được giữ đến khi có đủ tiền mặt.

Lệnh chuyển dùng ví chủ làm fee payer, đúng đích cố định, kiểm tra phí/số dư/simulation. Bộ ký đã mở tự ký; không chờ xác nhận từng lần. Chỉ ghi đã chuyển khi receipt xác nhận cả số dư giảm, số dư tăng của đích và fee. Kết quả chưa rõ được đối soát sau restart/reload mà không ký/gửi lại. Khoản chuyển được cộng lại khi tính tổng hiệu quả vốn để không hiện thành lỗ; phí chuyển vẫn làm giảm P&L.

Nguồn tính vốn/lãi là nhật ký `owner-agent-state.json` trên server. Sổ chỉ lưu bền vững khi đặt trên ổ dữ liệu/Volume; đây không phải hợp đồng giới hạn chi tiêu on-chain. Không sửa số liệu bằng tay hoặc chạy nhiều service/replica độc lập cho cùng ví. Chuyển/rút tài sản ngoài ứng dụng làm lệch sổ và phải kiểm tra trước khi tiếp tục.

## Nhật ký, kiểm toán và bảo mật

Nhật ký server gắn theo chủ, chứa vị thế, phí đo được, trades/payouts và pending transaction; không chứa private key hoặc mật khẩu. Trình duyệt server mode không lưu khóa hay journal cá nhân vào localStorage. Bộ ký chỉ ký giao dịch chuẩn bị bởi chính policy/execution nội bộ, đúng fee payer; server vẫn xác minh signer Ed25519/hash trước gửi. Ghi signed bytes/signature và fsync **trước broadcast**. Chỉ ghi fill sau xác nhận. Kết quả chưa rõ khóa lệnh mới cho tới đối soát; expiry chờ block height finalized. Lỗi token trước gửi được bỏ qua/cooldown; 3 lệnh lỗi/hết hạn liên tiếp dừng bộ điều phối. Lỗi lưu trữ dừng ký. Nút khóa ngăn ký tiếp ngay cả khi lưu lỗi. Ngừng trong lúc chuẩn bị sẽ hủy trước ký; đã ký nhưng chưa gửi vẫn giữ để đối soát/hết hạn.

Xuất nhật ký trước khi redeploy hoặc di chuyển dữ liệu. Xuất chỉ chứa state, không xuất két hoặc khóa. Khôi phục chỉ khi dừng và không có pending đang xử lý, phải cùng chủ, đúng schema; không reset budget khi còn vị thế. `owner-signer.json` chỉ chứa bản mã hóa; không tự tạo đè két có sẵn. Sau restart không có khóa trong RAM, kể cả sổ trước đó đang chạy. Dùng một service/replica.

**Lưu trữ Railway:** có volume thì két và sổ nằm trong `RAILWAY_VOLUME_MOUNT_PATH/meme-pilot`. Volume không còn là điều kiện bật bot, BUY hoặc khôi phục vị thế. Không có Volume vẫn giao dịch nhưng dữ liệu có thể mất khi thay container. Danh sách toàn ví cập nhật nền, không khóa BUY và không kéo dài vòng giao dịch; trước ký đọc số dư riêng của mint liên quan và mô phỏng mọi tài khoản token thuộc chủ có mặt trong giao dịch. Lỗi đọc số dư riêng hoặc mô phỏng vẫn ngăn chính lệnh đó, không giả định số dư bằng không. Gắn Volume `/data` vào đúng service; Railway tự đặt `RAILWAY_VOLUME_MOUNT_PATH`, ứng dụng ghi `/data/meme-pilot`. Trước khi gắn Volume/redeploy, dừng bot và xuất nhật ký: ổ mới không tự sao chép dữ liệu của container cũ. Cần giữ khóa gốc, mật khẩu và cấu hình Telegram để nhập lại nếu két/cấu hình cũ mất. Không chạy nhiều replica cho cùng ví.

### Khôi phục vị thế bị mất sổ

Sổ chính và `owner-agent-state.backup.json` được ghi atomic/fsync trước broadcast. Bản sao nằm cùng ổ nên không thay thế Volume hoặc bản xuất bên ngoài. Nếu mất file chính nhưng còn bản sao, khởi động dừng như thông thường; chủ mở khóa và bật lại BUY/SELL, pending vẫn được đối soát và không gửi lại. Lịch sử chưa đầy đủ thì chưa tự chuyển lãi. File chính hỏng không bị ghi đè. Sổ còn tồn tại luôn được giữ nguyên. Nếu sổ mất, chủ có thể bật một sổ mới từ ngân sách SOL hiện có; lịch sử trước đó không được bịa lại và token ngoài sổ không tự trở thành vị thế. Chỉ quản lý lại vị thế cũ khi chủ khôi phục nó.

Đăng nhập ví chủ → **Đối soát token trong ví** → nhập mint và link giao dịch mua → **Kiểm tra giao dịch mua** → **Khôi phục vị thế đã xác minh**. Có thể điền sẵn bằng query `recoverMint` và `recoverTx`; chỉ chứa thông tin công khai. Hai endpoint `/api/signer/recovery-preview` và `/api/signer/recovery-apply` đều yêu cầu chủ đã xác thực, đúng origin. Chức năng này chỉ đọc RPC và ghi sổ, không ký/gửi giao dịch; không tự bán token chưa được chủ nhận vào sổ.

Receipt phải là lệnh PumpSwap exact-quote 0,02/0,03 SOL lịch sử hoặc 0,2 SOL hiện tại thành công, đúng người ký/payer, mint, pool/PDA; trước mua không có token đó. Số token còn nguyên, không có giao dịch token xen kẽ (kiểm tra tối đa 50 giao dịch mới hơn của tài khoản token, gồm cả chuyển qua delegate); thiếu/mâu thuẫn dữ liệu thì yêu cầu nhật ký đầy đủ. Khôi phục vốn bằng chênh lệch SOL thực của receipt, không cộng phí/rent lần hai, không trừ giá vốn mua thêm khỏi tiền mặt hiện tại. Ghi BUY lịch sử đúng thời gian blockchain, khôi phục một lần theo signature, không gửi thông báo giả như vừa thực hiện lệnh mới.

Không suy ra SOL/USD quá khứ từ receipt. Vị thế khôi phục dùng giá vốn/quote ròng bằng SOL cho stop/TP/runner. Không giả định đỉnh giá trong thời gian sổ mất: time-stop 45 phút cần ít nhất 45 phút theo dõi từ lúc khôi phục; max-hold 6 giờ vẫn tính từ block time gốc. Lịch sử tài khoản chưa đầy đủ thì P&L tổng hiển thị chưa xác định và chưa tự chuyển lãi; chủ mở khóa và bật lại BUY/SELL mà không cần hoàn tất khôi phục thủ công. Một receipt mua không chứng minh toàn bộ P&L/ngưỡng lỗ trước đó. Giới hạn vốn/vị thế và lỗ vẫn áp dụng cho sổ đang quản lý; tài sản ngoài sổ không được tính là đã khôi phục.

Auditor hiển thị 7 ngày gần nhất: lệnh đóng, win rate, kỳ vọng R theo rủi ro ban đầu, max drawdown và vị thế >72h. Thiếu dữ liệu thì báo thiếu, không tự đặt fee/slippage bằng 0 hoặc bịa giao dịch giả định. Tham chiếu: ≥40 vị thế đóng đo được, win rate ≥33%, expectancy ≥+0,4R, max DD ≤15%. Không tự đổi ngưỡng sau khi xem kết quả, không tự bật quyền giao dịch vì báo cáo đạt. Chưa có đủ mẫu không phải bằng chứng có lãi.

Tài liệu đính kèm mô tả futures short/alerts-only; chỉ dùng ý tưởng phân vai, quy tắc chung và kiểm toán. Không nhập quy tắc short/FVG hoặc quyền hạn của tài liệu thay cho yêu cầu Solana spot.

Chủ cố định; nonce một lần 3 phút, session 15 phút; cookie HttpOnly/SameSite=Strict/Secure HTTPS; POST đúng origin/JSON/header. Tài chính chủ chỉ hiển thị sau đăng nhập. Legacy ví phụ chỉ giữ để khôi phục dữ liệu cũ; không xóa két/sổ cũ. `/api/live/backup` có bảo vệ chủ; API điều khiển ví phụ trả 410. Production dùng `OwnerAgent`/`OwnerSignerVault`; các module ví phụ cũ không được khởi tạo.

Vốn cấp thêm: chỉ ghi nhận phần SOL native đã đọc từ ví vượt tiền mặt trong sổ, tới tổng vốn gốc tối đa 1,19 SOL. Tiền nạp tăng đồng thời vốn gốc, tiền mặt, mốc đỉnh và mốc đầu ngày; không tính là lãi, không xóa lỗ, vị thế hay cờ dừng cũ. Không bổ sung vốn khi còn giao dịch đã ký đang chờ kết quả. Lệnh cũ giữ nguyên số lượng/giá vốn.

## Chạy và Railway

Node.js 24+:

```bash
npm ci --ignore-scripts --include=dev
npm run build
npm run check
npm test
npm start
```

Railway auto-deploy nhánh `codex/meme-pilot-railway` bằng Dockerfile/railway.json; một replica. Không dùng Docker secret mounts vì builder Railway hiện chỉ hỗ trợ cache mounts. Volume lưu sổ và két của bộ ký; thiếu Volume chỉ cảnh báo dữ liệu có thể mất, không khóa BUY. `PUBLIC_ORIGIN` cần đúng HTTPS origin khi dùng domain riêng. Egress: api.dexscreener.com, api.geckoterminal.com, api.rugcheck.xyz, lite-api.jup.ag và hai RPC trên; không cần Helius/Jupiter. Install scripts tắt; SDK transitive TOML/BigInt dùng các bản override đã kiểm tra.

`/api/health`: `mode=live`, `rpcMode=keyless`, `signingMode=owner-agent` và `unattendedSigningAvailable=true`, `strategyVersion=solana-six-stage-desk-v4`. Đây là HTTP/feed readiness, không chứng minh giao dịch/lợi nhuận. `/api/direct/status` cần đăng nhập chủ.

Kiểm thử dùng fixture, chữ ký ví thử và RPC giả lập. Chưa gửi giao dịch SOL thật, chưa kiểm chứng hiệu quả thị trường hoặc trạng thái Railway Online từ môi trường này.
