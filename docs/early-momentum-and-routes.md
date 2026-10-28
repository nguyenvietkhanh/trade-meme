# Phát hiện đầu nhịp và cặp PumpSwap ngoài SOL

Thay đổi bổ sung dữ liệu và cách chia slot ứng viên cho AI, cùng executor route
SOL → token trung gian → token đích. Không phải thuật toán cam kết bắt được
một token trước khi tăng sốc; ảnh sau khi tăng không chứng minh khả năng dự báo.
Mint minh họa của người dùng không được hardcode vào BUY hay watchlist.

## Dữ liệu và AI

- LIVE dành tối đa một nửa slot cho ứng viên 2000 < marketCapUsd < 30000,
  M5 dương và không quá 100%, xếp ưu tiên theo volume M5 so với trung bình
  5 phút của 55 phút trước (suy ra từ H1 trừ M5). Các slot còn lại dùng
  thứ tự momentum hiện có, không trùng mint. Đây chỉ là chia slot; AI vẫn
  quyết định BUY/SELL/HOLD và chọn stop. Không đặt thêm cổng cứng vốn hóa.
- `earlyMomentum`: phạm vi 15 nến trước nến cuối, vị trí close so với đỉnh nền,
  tăng giá M1/3M, volume M1 so với nền 15M và volume 3M so với 3M trước,
  tỷ lệ số giao dịch BUY và chênh số BUY/SELL. Chỉ dùng nến M1 đã đóng,
  liên tiếp, đúng mint/pool và còn mới. Thiếu dữ liệu ghi null.
- Tỷ lệ số BUY không phải tỷ lệ tiền BUY hay số người mua độc lập.
- Context thêm quoteMint/quoteSymbol, H6/H24 quan sát được. H6/H24 tăng lớn
  không đồng nghĩa M5 > 100%, nhưng có thể là vào muộn.
- Prompt bổ sung ở `src/prompts/live-ai-focus.v2.txt`, bật bằng biến Railway:

  ```env
  LIVE_AI_PROMPT_VERSION=v2
  ```

  Không cần thêm API key hay đổi khóa ký. V1 vẫn là mặc định nếu chưa chọn v2;
  asset system gốc v2 và validator/schema quyết định giữ nguyên. Hash toàn
  prompt vẫn được tính từ nội dung thực tế, bao gồm focus và batch wrapper.
- Radar hiển thị vẫn yêu cầu tuổi pair >=10 giờ; không áp tuổi này cho AI.
- Nguồn discovery không bao phủ tất cả pool, không bảo đảm phát hiện mọi token.

## Executor cho cặp ngoài SOL

- Nếu cùng token có pool SOL, LIVE ưu tiên pool đó. Pool của vị thế đang giữ
  được ưu tiên tuyệt đối; không đổi pool hay xóa sổ vị thế cũ.
- Khi pool được chọn có quoteMint khác SOL, executor tìm quote ExactIn Jupiter
  qua endpoint hiện có của dự án. Vốn vào và tiền bán ra vẫn là SOL;
  không sử dụng số token trung gian đã có trong ví.
- Chỉ route tuyến tính 1–3 hop, 100% mỗi hop, toàn bộ pool thuộc PumpSwap.
  Không hỗ trợ split, Raydium/Orca hay mọi loại quote asset một cách vô điều kiện.
  Token trung gian và đích phải qua mintCheck: SPL Token thường, mint/freeze
  đã thu hồi. Route Token-2022 bị từ chối; đường SOL trực tiếp giữ hỗ trợ cũ.
  Ví dụ USDC còn quyền mint/freeze sẽ không qua cổng này.
- Kiểm tra PDA pool, phiên bản/mayhem/cashback, vault/mint/owner, lượng input
  liên thông từng hop, quote slot, impact, trần tỷ lệ dự trữ, không platform fee.
- BUY cần quote bán ngược, kiểm tra cả graph ngược, chi phí khứ hồi ước tính
  <=6% sau buffer 50000 lamports, và không kém entry reference hiện có.
  Quote ngược không phải giao dịch đã khớp hay bảo đảm bán được trong tương lai.
- Instruction phải khớp owner, ATA, input, quoted output, slippage, pool và
  không có signer phụ. Chỉ cho setup ATA, nạp SOL vào WSOL ATA, sync native,
  đóng WSOL về chính owner. Không approve/delegate/transfer ra ví khác.
- Tự đặt compute budget, kiểm tra phí mạng <=25000 lamports. Mô phỏng RPC phải
  thành công và trả đầy đủ CPI trace: chỉ cho chương trình hỗ trợ và các swap
  PumpSwap được SDK giải mã, đúng thứ tự pool. Không đoán enum Jupiter mới
  nếu public IDL cũ; instruction lạ/trace thiếu bị từ chối.
- Cùng lớp simulation hiện có kiểm tra token debit/output, thay đổi tài sản
  khác, owner/delegate, dự phòng SOL. Các account writable mới cũng được kiểm
  tra để tránh giữ lại token trung gian hoặc tính nhầm rent. Quote route quá
  5 giây bị loại. Sign/broadcast/reconcile dùng pipeline bền vững cũ.
- Vẫn <=90% SOL/lệnh, giữ 0.05 SOL và buffer 0.005 SOL, cùng cơ chế đặt chỗ
  vốn và tối đa 5 lệnh đang chờ. Không gửi lại chữ ký cũ.
- `executionVenue` được lưu trên order và vị thế để SELL sau restart dùng đúng
  executor. Vị thế cũ thiếu field này mặc định dùng PumpSwap SOL trực tiếp.
  SELL route giữ ATA token đích; rent chưa hoàn không được ghi thành lợi nhuận.

## Giới hạn dữ liệu giá và xác minh

Reader giá dự trữ RPC ~1 giây hiện chỉ hỗ trợ token/SOL. Cặp ngoài SOL dùng
fallback giá USD/SOL từ feed thị trường khi còn mới, không được gắn nhãn là
spot RPC 1 giây. Dữ liệu cũ vẫn bị chặn theo guard hiện có; không bảo đảm stop
khớp đúng giá trong thị trường biến động hoặc khi RPC/quote mất kết nối.

Nguồn ABI được đối chiếu ở repository chính thức:
- https://github.com/jup-ag/instruction-parser/blob/main/src/constants.ts
- https://github.com/jup-ag/instruction-parser/blob/main/src/idl/jupiter.ts
- SDK PumpSwap 2.1.0 được pin trong package-lock hiện có.

Kiểm thử dùng fixture và RPC/API giả lập; không gửi order, không đọc .env thật
hay khóa ví. Fixture Jupiter chỉ kiểm tra cấu trúc, quote binding và CPI guard,
không chứng minh một route thực sẽ được Jupiter tạo/chấp nhận. Truy cập công
khai DexScreener trong môi trường này bị policy mạng chặn; chưa xác minh route
production cho mint minh họa, chưa gọi API model thật hoặc gửi tiền thật.
Runtime sẽ từ chối nếu endpoint/ABI/trace không tương thích. Không thể tuyên bố
đã hoạt động trên Railway chỉ từ kết quả build/unit test.
