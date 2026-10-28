# Bộ dữ liệu thụ động PumpSwap

Lớp này **không đổi prompt, body gọi model, bộ chọn ứng viên, quyết định, hạn mức,
SL/TP hay logic ký/gửi/đối soát**. Không gọi thêm API/RPC/quote. Chỉ ghi dữ liệu từ
luồng đang có. Bản ghi có thể thiếu khi quá tải, hết đĩa hoặc crash; không được coi
là lịch sử giao dịch đầy đủ. Sổ tiền thật vẫn là nguồn đối soát, không phải dataset.

## Bật / tắt

```ini
DATASET_ENABLED=true
DATASET_MAX_MIB=500
DATASET_RETENTION_DAYS=14
DATASET_MIN_FREE_MIB=64
DATASET_BUFFER_MIB=4
DATASET_FLUSH_MS=5000
DATASET_MAX_ACTIVE_LABELS=30000
DATASET_MAX_QUEUED_MESSAGES=16
```

Mặc định `DATASET_ENABLED=false` để không tự ghi thêm vào Volume đang gần đầy.
Đổi biến rồi deploy/restart để áp dụng. Tắt không xóa dataset cũ. Giữ nguyên Volume
và sổ tiền thật. Không thêm API key hoặc khóa ví. Chỉ bật collector trong LIVE;
không tự chuyển LIVE sang paper/shadow, không tự đổi chu kỳ AI để giảm dung lượng.

Với Volume 500 MB, cap dataset 500 MiB **không có nghĩa đủ chỗ**: cần chừa sổ lệnh,
research và 64 MiB trống. Có thể dùng cap128 MiB nếu dung lượng còn lại cho phép;
không xóa ledger để dành chỗ. Khi không đủ reserve, collector ngừng ghi/drop dữ liệu,
báo `DATASET_DISK_RESERVE`, không chặn inference hoặc cố lấy phần trống dành cho sổ.

## Files

`<LIVE_ROOT>/dataset/YYYY-MM-DD/<stream>-<session>-<part>.jsonl.gz`

Ngày thư mục dùng UTC; mỗi record có timestamp epoch ms. Có thể đổi sang giờ Việt
Nam khi phân tích. Gzip nối nhiều member; đọc bằng gzip chuẩn hỗ trợ concatenation.
Part mục tiêu4MiB nén; giới hạn chung500MiB hoặc14ngày,điều kiện nào đến trước.
Chỉ xóa file dataset nhận dạng đúng tên,không theo symlink,không động vào fills,
ledger,Telegram,vault hoặc thư mục khác. Không có dependency mới ngoài Node built-ins.

- **model_calls**: một dòng/call thực đã thử gửi HTTP, gồm callId,requestedAt,
  respondedAt,latencyMs,model,temperature,maxTokens,promptSha256,snapshotId,
  toàn bộ context đã redaction,rawOutput chưa parse(trừ redaction),validate,
  decisions và executorResults. HTTP/network/parse/validation lỗi vẫn được ghi.
  Không đọc response body lỗi HTTP để tránh thay đổi luồng network hiện tại;
  rawOutput khi đó null. Response quá lớn/echo API key được bỏ theo check cũ.
- **candidate_snapshots**: một dòng/candidate/call: features đúng context bao gồm
  nến,flow,cờ complete,mintSafety,cap,age…; selectedForBuy;bought và boughtCoverage.
  bought=false cho không chọn/bị loại,true khi đã có xác nhận;gửi chưa rõ kết quả
  là null,không tự coi là đã mua hay không mua.
- **executor_results**: các sự kiện nối bằng callId,decisionIndex,intentId:
  validation_rejected/executor_accepted/send_started/sent/send_unknown/rejected/
  confirmed. sent là phản hồi gửi,KHÔNG phải fill. Polling có thể lặp cùng intentId;
  không đếm các dòng thành số lệnh. Metadata callId/index được gắn vào intent mới
  và giữ trong sổ,không tham gia tính vốn hoặc chữ ký giao dịch; lệnh cũ không có
  metadata vẫn được đối soát bình thường.
- **forward_labels**:1/3/5/10/15/30 phút tính từ entryAt=respondedAt+2000ms.
  Entry/endpoint là điểm RPC spot mới đầu tiên tại hoặc sau mốc,cho phép lệch tối
  đa2s; không forward-fill. Nguồn priceAt phải không quá1.5s so với lúc lấy mẫu.
  MFE/MAE riêng từng cửa sổ,không lấy cực trị sau cửa sổ. Complete đòi entry,
  endpoint và không có gap>2s. Không complete thì mfePct/maePct,triple-barrier label
  null; observedMfePct/observedMaePct và observedHit chỉ mô tả phần đã quan sát.
  Barrier đầu tiên chạm các cặpSL/TP(10,15),(15,30),(20,40)%;không chạm thì TIMEOUT
  theo từng horizon. Đây là nhãn theo spot lấy mẫu~1s,không phải chứng minh khớp
  giá barrier. Gaps không thể loại trừ chạm barrier ẩn nên không gán nhãn chắc chắn.
- **fills_enriched**:event fill/failed_transaction/price_path. Giá quote và giá khớp
  suy ra từ receipt(token delta,decimals,SOL delta đã điều chỉnh network fee/rent),
  slippage,networkFee,timestamp quyết định/gửi/xác nhận,stop,lý do thoát. Không đọc
  inner-swap amounts mới;priceBasis ghi rõ cách suy ra. Không trừ fee lần hai khi
  tính PnL từ net delta. Pool fee chưa tách riêng thì không giả định0. Path5s ghi
  null khi giá stale. MFE/MAE dựa điểm quan sát;vị thế có trước collector không có
  entryPrice chắc chắn thì để null,coverage.startedBeforeCollection=true.
  Win rate chỉ tăng khi một vị thế đóng có positionPnlSol xác minh;partial SELL
  không tăng mẫu số. Không ghi nhận lãi/lỗ chưa xác minh do bán/chuyển ngoài ví.
- **errors**:category/code tách RPC,JUPITER_429,MODEL_429,REVERT,QUOTE_STALE,
  QUOTE_ERROR,STOP_REQUIRED,WALLET_NOT_CONNECTED,SIGNER_UNAVAILABLE,OTHER và
  DATASET_GAP. Đọc lỗi trước khi executor gộp thành PREPARE_FAILED khi có thể.
  Không đổi mã lỗi hay cách bot xử lý lỗi đang có.

Model/candidate rows hoàn tất sau cửa sổ nối60s hoặc lúc shutdown. Những kết quả
đến muộn nằm trong executor_results/fills_enriched; khi phân tích nối lại theoID,
không coi null trong snapshot ban đầu là kết luận cuối cùng. Nếu muốn lấy ngay sau
chạy,hãy chờ ít nhất60s + flush5s;labels30m cần hơn30m.

`quoteVsMid` dùng quote thực của lệnh nếu có decimals và giá context để tính chi
phí lệch so với mid,ghi nguồn/thời gian. Ứng viên bị bỏ qua thường chưa từng quote:
entryCostPct/exitCostPct=null,status=not_quoted. KHÔNG tự giả định chi phí0 hoặc
phát sinh quote RPC mới chỉ để lấp trường. Nhãn spot không phải PnL sau mọi phí;
chỉ dùng mô phỏng có chi phí khi đủ bằng chứng quote/fee.

Không khôi phục giá quá khứ đã mất. Shutdown sạch kết thúc các cửa sổ chưa đủ bằng
coverage=interrupted. Kill/crash có thể mất buffer/call đang chờ và label state;
không có cam kết exactly-once hoặc phục hồi label state sau crash. Lệnh thật vẫn
phục hồi theo ledger hiện có;sentAt trước restart có thể null. Khi cần nghiên cứu
qua restart phải coi ranh giới phiên là gap,không nối như đường giá liên tục.

## Bảo mật và hiệu năng

Worker ghi riêng,env chỉTZ,không nhận key hoặc signed bytes. Chỉ whitelist metadata
order/receipt được gửi sang dataset. Wallet/recipient đã biết và chữ ký được hash
với salt bền vững;mint/pool giữ nguyên. Secret/transaction fields bị loại;raw model
output cũng qua redaction. Không xuất `.redaction-salt`. RawOutput là bản gốc đã che,
không phải bản gốc byte-identical nếu chứa dữ liệu bị cấm.

Nén chạy gzipSync **trong worker**,không chặn event loop inference,không dùng gzip
trong critical path. Main thread chỉ có structured-clone/postMessage có giới hạn;
không thể hứa overheadCPU bằng0. Queue đầy bỏ telemetry và đếm droppedTransportMessages.
Buffer vượt4MiB bỏ record và đếm droppedRows;active labels vượt30k ghi capacity_dropped.
Worker/đĩa lỗi fail-open. Token rời tập feed đang quét có thể không còn giá:collector không tự mở rộng tập RPC theo dõi,nên coverage sẽ thiếu(có thể liên quan xu hướng giảm,không được loại các mẫu này rồi báo win rate đẹp). Không đợi fsync dataset trước khi trade.

Xem `/api/state` hoặc `/api/health` →dataset:
`rawBytesPerSecond`, `compressedBytesPerSecond`, `estimatedMiBPerDay`,diskBytes,
prunedBytes,droppedRows,droppedTransportMessages,droppedTransportMessages(main),
activeLabels,pendingCalls,error. Ước tính ngắn hạn cần warm-up ít nhất30phút để có
đủ các nhãn;pruning/drop làm tốc độ ghi thấp hơn nhu cầu thật.

## Xuất mẫu đã che

Tại container/thư mục app:

```sh
./export_redacted.sh /duong-dan/meme-pilot/live /tmp/pumpswap-export 250
tar -czf /tmp/pumpswap-export.tar.gz -C /tmp/pumpswap-export .
```

Script chỉ đọc6stream dataset đúng tên,không đọc .env/ledger/vault/khóaTelegram.
Xuất tối đa250dòng/stream từfilemới,giới hạn64MiB đọc giải nén/stream;manifest ghi
số dòng/cảnh báo gzip hỏng. Đây là mẫu,không bảo đảm có đủ thắng/thua hoặc coverage.
Mỗi stream JSONL riêng;join theoID khi phân tích. Không trỏ output vào thư mục
rotation. Cần Node,shell;tar chỉ dùng nếu muốn đóng gói. Không có khóa thật trong
lệnh;không gửi raw ledger lên chat.

## Dung lượng và benchmark

Chạy `node scripts/dataset-benchmark.mjs` để đo sizing/chi phí enqueue bằng dữ liệu
**giả lập**,không dùng làm kết quả trading hoặc benchmark production.

Ví dụ trên môi trường phát triển:60candidates/call,16nến đầy đủ,nhiều float có độ
chính xác cao,call5s,6nhãn/candidate:
- model_calls:52,254bytes gzip/call;
- candidate_snapshots:52,591bytes gzip/call;
- forward_labels:15,419bytes gzip/call;
- tổng~1,982MiB/ngày(~2GiB),chưa tínhfill/path/errors.
- cap500MiB chỉ giữ~6.05giờ ở mật độ đó,KHÔNG giữ được14ngày.
- enqueue20context synthetic:mean~0.26ms,p95~0.44ms,max~0.53ms trên máy kiểm thử;
  không phải cam kết latency Railway.

Dữ liệu thực có thể nhỏ hơn nhiều nếu ít ứng viên/nến,hoặc lớn hơn khi nhiều vị
thế/lỗi. 14ngày ở2GiB/ngày cần khoảng28GiB chỉ cho dataset,ngoài sổ và reserve.
Không tăng Volume hay đổi interval bot tự động. Dùng tốc độ ghi thực tế để quyết
định dung lượng;collector tuân thủ cap và reserve thay vì làm đầy sổ tiền thật.

## Các file thay đổi

File mới:
- src/dataset.js — collector và cấu hình,buffer thông điệp giới hạn.
- src/dataset-worker.js — ghi/nén/retention,join call/decision/executor/fill.
- src/dataset-labeler.js — delayed entry,horizon,coverage và triple-barrier.
- src/dataset-redaction.js — hash định danh,loại secret/signed bytes,phân loại lỗi.
- src/dataset-observe.js — fail-open observer.
- src/dataset-validation.js — giải thích lỗi phục vụ dataset,không quyết định trade.
- scripts/export-dataset.mjs và export_redacted.sh — xuất mẫu đã che.
- scripts/dataset-benchmark.mjs — sizing giả lập,không gọi mạng.
- test/dataset.test.js — labeler,redaction,retention,export và fail-open tests.
- docs/dataset.md — schema,cách bật và các giới hạn dữ liệu.

File cập nhật:
- src/paper-model-client.js — quan sát request/raw response/validate/timing/hash prompt.
- src/paper-model-runtime.js và src/multi-live-runtime.js — telemetry quyết định vàID.
- src/paper-bot-worker.js và src/paper-supervisor.js — chuyển telemetry quaIPC.
- src/live-fleet.js và src/automatic-fleet.js — kết quả executor và lỗi.
- src/live-treasury.js và src/automatic-treasury.js — receipt/send observations.
- src/paper-server.js — nối collector,quan sát giá sẵn có,status và shutdown.
- Dockerfile — copy export script vào image.
- .env.example và README.md — cấu hình và hướng dẫn.

Không thay src/paper-model-context.js(prompt/validation),autonomous-policy.js,
desk-rules.js,pump-swap.js hoặc luật chiến lược/giới hạn.
