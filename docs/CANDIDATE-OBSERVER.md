# Dữ liệu ứng viên quan sát độc lập

Không thay đổi bộ luật BUY/SELL, risk, size, prompt, lịch chạy, bộ ký, quản lý vị thế SCALP/RUNNER. Không gửi giao dịch. Không thêm dependency hoặc API trả phí/key mới. Observer chỉ nhận bản sao các field công khai trong allowlist, không nhận ví chủ/nhận lãi, key, chữ ký hay signed transaction. Worker chỉ được truyền biến môi trường proxy/CA và UTC, không truyền signer/API key.

## Bật/tắt và nơi lưu

Mặc định bật trong chế độ LIVE. Cấu hình trong Railway Variables, sau khi đưa bản code này lên:

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `CANDIDATE_OBSERVER_ENABLED` | `true` | `false` tắt riêng observer, không tắt giao dịch |
| `CANDIDATE_OBSERVER_DIR` | `<effective LIVE root>/candidate-observer` | Đường dẫn riêng, nên giữ mặc định để theo Volume đang gắn |
| `CANDIDATE_RETENTION_DAYS` | `3` | Xóa research hết hạn, phạm vi 1–90 ngày |
| `CANDIDATE_MAX_MIB` | `32` | Ngân sách SQLite + headroom rollback journal, 8–2048 MiB |
| `CANDIDATE_MIN_FREE_MIB` | `64` | Chừa đĩa trống cho hệ thống giao dịch; thiếu thì dọn research và ngừng ghi mới |
| `CANDIDATE_DELETE_RAW_AFTER_LABEL` | `true` | Xóa đường giá thô ngay sau khi lưu nhãn; giữ sáu snapshot + nhãn để phân tích |
| `CANDIDATE_MAX_PENDING` | `5000` | Giới hạn ứng viên đang chờ theo dõi; vượt vẫn ghi đăng ký, đánh dấu sáu snapshot dropped |
| `CANDIDATE_API_INTERVAL_MS` | `10000` | Ít nhất 10 giây giữa request bổ sung; một request đang chạy, batch tối đa 30 |
| `CANDIDATE_SAMPLE_MS` | `30000` | Khoảng lưu mẫu đường giá và vòng lấy dữ liệu token đã rời feed; 15–120 giây |
| `CANDIDATE_SNAPSHOT_GRACE_MS` | `20000` | Chấp nhận snapshot từ mốc đến mốc +20 giây, không lấy dữ liệu trước mốc để điền tương lai |

File: `<CANDIDATE_OBSERVER_DIR>/candidates.sqlite`. Với cấu hình lưu trữ hiện có, mặc định là `<RAILWAY_VOLUME_MOUNT_PATH>/meme-pilot/live/candidate-observer/candidates.sqlite`. Không có Volume thì không bảo đảm giữ dữ liệu qua redeploy.

SQLite chạy trong worker 64 MiB heap, cache SQLite 2 MiB. `journal_mode=DELETE`, `synchronous=FULL`, transaction mỗi batch, ACK sau commit. Bộ đệm được gửi ngay khi có thể và được đánh thức mỗi giây. Shutdown chờ tối đa 5 giây để commit. Dữ liệu đã commit được khôi phục qua restart; dữ liệu còn trong buffer hoặc transaction bị rollback lúc tiến trình chết có thể mất. Không tuyên bố zero-loss cho dữ liệu chưa ACK.

Chỉ dọn các bảng trong DB research này, không mở hay sửa ledger, key, file vị thế hoặc file khác. Có thể dọn dữ liệu sớm hơn số ngày retention khi đạt giới hạn dung lượng hoặc thiếu đĩa. DB dành khoảng nửa ngân sách byte cho rollback journal; số token giữ được phụ thuộc số liệu thực tế. Duy nhất mint trong dữ liệu còn được giữ; sau khi bị xóa vì retention/dung lượng, token được thấy lại có thể tạo một đăng ký mới.

## Nguồn và phạm vi

Hook lấy raw Solana pairs từ DexScreener trước lọc giá/venue/ranking/shortlist; cả profiles và new-pool IDs, discovery queue (gồm nguồn migration/trending), raw pump.fun discovery. Do đó token không lọt radar hoặc thiếu giá vẫn được đăng ký. Feed giá/enrichment hiện có cũng được quan sát, không tạo thêm holder/flow RPC.

Mỗi mint đăng ký một lần trong dữ liệu còn giữ. Ghim pool đầu tiên có địa chỉ hợp lệ, không nối giá của các pool khác thành một đường giá. Ghi riêng `decisionPool` và `decisionPoolMatchesTracked` nếu bộ luật đánh giá pool khác. Nguồn `discovery_queue` là điểm nhận ID, không khẳng định đã xác minh giao dịch migrate; nguồn on-chain chỉ có khi bot hiện tại đã cấu hình và nhận được dữ liệu đó.

Giá bổ sung từ API công khai DexScreener `/latest/dex/pairs/solana/<tối đa 30 pair>`; với ID chưa biết pool dùng `/latest/dex/tokens/<tối đa 30 mint>`. Cache feed còn mới sẽ lùi lịch gọi bổ sung. Không gọi Jupiter, Solana RPC, RugCheck hay API trả phí. Background nhường khi quote đang chạy/có lệnh chưa terminal; request quan sát đang chạy được hủy khi nhận tín hiệu ưu tiên giao dịch. Request đọc đã bắt đầu có thể trùng ngắn với lúc giao dịch vừa khởi động trước tín hiệu vòng tiếp theo; không chiếm hàng đợi ký/gửi lệnh.

HTTP 429/5xx có exponential backoff, tôn trọng `Retry-After`. Response tối đa 2 MiB, timeout 4 giây gồm body. Không dùng dữ liệu token khác khi pair bị thiếu. DexScreener không trả timestamp sàn cho các field này: timestamp của nguồn Dex là lúc nhận response tại máy, không chứng nhận thời điểm cập nhật trên sàn.

## Schema

- `candidates`: `mint` PK, `pool`, `first_seen` UTC epoch milliseconds, JSON `data`, trạng thái hoàn tất/lịch poll. JSON có firstSeenUtc, poolAgeMs, source, decision, skipCode, firstDecision/lastDecision, wouldBuy, filterPassed, evaluationStatus, executor status. Không xem BUY decision hoặc executor accepted là đã khớp.
- `snapshots`: PK `(mint, minute)` với minute 0/1/5/15/30/60. `target_at`, JSON gồm capturedAt, observedAt, source, values, provenance theo từng field, missing, dropped. Lịch chờ được lưu trong DB để tiếp tục sau restart. Mốc trễ quá grace được ghi null + `MISSED_WINDOW`, không hồi điền bằng giá mới. Khi quá tải dùng `QUEUE_FULL`; khi thiếu buffer có cờ `initialObservationDropped` và lý do `OBSERVATION_BUFFER_FULL`.
- `samples`: mẫu giá USD/thanh khoản thực sự đã thấy trong 60 phút, không carry-forward. Dùng để tính cực trị/drawdown; không chỉ dùng sáu snapshot thưa. Mặc định xóa ngay trong transaction sau khi lưu nhãn thành công; nhãn giữ lại coverage/extrema đã tính. Không thể tái dựng đường giá từng mẫu sau khi xóa. Đặt `CANDIDATE_DELETE_RAW_AFTER_LABEL=false` nếu cần giữ, vẫn chịu trần dung lượng/retention.
- `labels`: kết quả JSON, một hàng/mint sau 60 phút và thời gian grace; thiếu phủ dữ liệu thì các nhãn chưa xác định để null.
- `metadata`: bộ đếm snapshot dropped và research pruned tồn tại qua restart. Bộ đếm transport/drop của worker hiện tại là theo phiên, không bảo đảm tích lũy qua crash.

Bộ chỉ số snapshot: priceUsd, marketCapUsd (không thay market cap bằng FDV), liquidityUsd, buys5m, sells5m, uniqueBuyers5m, uniqueSellers5m, volume5mUsd, buyVolume5mUsd, sellVolume5mUsd, change5mPct, change1hPct, holderCount, top10Pct, devPct.

Các field thị trường dùng timestamp feed không quá 15 giây. Unique buyers/sellers chỉ dùng cache flow hoàn chỉnh, đúng mint/pool, không quá 15 giây. Holder/top10/dev chỉ dùng cache safety hiện có không quá 60 giây; top10 phải loại trừ pool. Nguồn/timestamp riêng của các field cache vẫn được ghi, không gọi đó là dữ liệu mới lấy tại mốc snapshot. Trong grace có thể bổ sung field null từ nguồn hợp lệ; giá đã có được giữ nguyên. Snapshot ghi giá muộn trong grace vẫn thể hiện timestamp thực tế.

DexScreener không có unique buyers/sellers hoặc volume mua/bán riêng. Chưa có cache hợp lệ thì null và mã thiếu; không chia volume tổng theo tỷ lệ số lệnh, không giả định ví là người độc lập. Volume mua/bán riêng hiện để null vì nguồn cache đang dùng không cung cấp toàn cửa sổ 5 phút đã xác minh. Rất nhiều token bị pre_filter sớm sẽ chưa có holder/dev/top10; observer không tăng RPC để lấp chúng.

## Quy ước nhãn

- max_gain_pct: đỉnh quan sát so với giá snapshot T+0.
- return_15m, return_60m: giá snapshot tương ứng so với T+0, thiếu giá thì null.
- max_drawdown_pct: mức giảm lớn nhất từ đỉnh trước đó đến đáy sau đó trong chuỗi mẫu; số dương. Có thêm max_loss_from_initial_pct để phân biệt giảm so với giá ban đầu.
- is_rug=true nếu thực sự thấy giá giảm >90% hoặc thanh khoản giảm >80% so với ban đầu. Không suy ra rug từ API lỗi hoặc pair biến mất.
- Chỉ ghi is_rug=false khi chuỗi mẫu có đủ phủ theo lịch cấu hình, không có khoảng trống quá 2 × sample interval, có giá đầu và thanh khoản của các mẫu. Các trường hợp còn lại null. Đây là “không thấy rug trong chuỗi mẫu đủ phủ”, không chứng minh giữa hai mẫu không từng có một cú sụt ngắn.
- RUG ưu tiên; WIN nếu max_gain_pct ≥30 và không thấy rug trên chuỗi đủ phủ; LOSS nếu không rug, không WIN và return_60m <0; FLAT nếu không rug, không WIN và return_60m ≥0. Mốc phân biệt FLAT/LOSS là 0%, được nêu rõ vì yêu cầu chưa đặt khoảng flat riêng. Thiếu dữ liệu cần thiết: label=null.
- `bot_would_have_bought` phản ánh có BUY decision thực tế trong giờ đầu theo bộ luật đang chạy, không dựng lại filter bằng dữ liệu tương lai và không phải xác nhận đã mua. `filterPassed` ghi pass setup riêng; SKIP do slot/size/quote vẫn là SKIP. Chưa được bộ luật xét: `evaluationStatus=NOT_EVALUATED`, không trộn vào nhóm SKIP đã đánh giá.

Nhãn là kết quả giá quan sát, chưa trừ phí và không mô phỏng khớp lệnh. Cực trị giữa hai mẫu chưa biết; API stale ở phía nhà cung cấp cũng không thể phát hiện hoàn toàn. Các nhãn thiếu phủ không được ép thành FLAT/LOSS.

## Hàng đợi và lỗi

Main buffer tối đa 2048 observation rows, một batch 128 đang chờ ACK. Khi đầy, bỏ feature observation trước và giữ đăng ký mint trong buffer metadata phụ tối đa 8192. Nếu cả buffer phụ đầy thì có `droppedCandidateRegistrations`; không tuyên bố đã ghi mọi token khi con số này >0. Snapshot chờ quá dung lượng hoặc bỏ lỡ thời điểm đều có dropped flag. Không thể vừa bảo đảm bộ nhớ hữu hạn vừa hứa không mất bất kỳ sự kiện nào khi thiết bị ghi ngừng hoạt động vô hạn.

Lỗi hook, DB, worker, mạng, disk-full được bắt và log bằng mã cố định, rate-limit log phía main; không truyền lỗi sang quyết định/gửi lệnh. Worker chết sẽ báo workerFailed và ngừng quan sát đến khi restart; không dừng bot và không tự đổi cờ BUY. Không cam kết cứu được toàn tiến trình nếu Railway tự tắt container hay hết RAM toàn máy.

## Thống kê và phân tích

Đăng nhập chủ ví như hiện tại rồi GET `/api/research/candidates/status`. `/api/state` và `/api/export` cũng có `candidateObserver`: candidates, snapshots, labeled, pendingSnapshots, droppedSnapshots, buffered, bufferedCandidateRegistrations, dropped, droppedMessages, droppedCandidateRegistrations, usedBytes/maxBytes, freeBytes/minFreeBytes, prunedCandidates, apiCalls, nextRequestAt, error. Số liệu worker cập nhật khoảng 5 giây/lần.

Chạy offline trên DB/backup SQLite nhất quán, với Node 24:

```sh
node scripts/analyze-candidates.js /path/candidates.sqlite --csv /path/candidates.csv
# Hoặc:
npm run analyze:candidates -- /path/candidates.sqlite --csv /path/candidates.csv
```

Script mở DB read-only, không overwrite nguồn bằng CSV. In số token theo nhãn và UNLABELED, trung vị từng chỉ số T+0/1/5 của WIN so với RUG/LOSS, số mẫu hợp lệ từng chỉ số, WIN rate BUY/SKIP và nhóm NOT_EVALUATED riêng. Dưới 200 token có nhãn hợp lệ: cảnh báo chưa đủ kết luận. CSV một dòng/mint, có sáu bộ feature, timestamps, missing, provenance và coverage. Khi sao lưu DB đang chạy cần công cụ SQLite backup nhất quán; không copy riêng file giữa transaction đang ghi. Đọc/export DB lớn khi bot chạy có thể làm observer chờ khóa DB; không khóa ledger giao dịch.

## Kiểm tra và bàn giao ngày 2026-10-29

- Hai lượt bộ test toàn repo đều qua 119 file, không có file lỗi; log `/tmp/candidate-full-suite.log` và `/tmp/candidate-full-final.log`. Sau các thay đổi observer cuối, chạy lại test observer riêng trong `/tmp/candidate-tests-final.log`.
- 26/26 test observer cuối đã qua (gồm dọn dữ liệu cho gói miễn phí). Test gồm nhãn WIN/RUG/LOSS/FLAT, thiếu dữ liệu, restart/missed windows, null/provenance, raw tokens trước lọc, queue/drop, dọn dung lượng, lỗi mở DB, batch 429/backoff, ưu tiên giao dịch, CSV và disk reserve. Kết quả cuối ghi trong `/tmp/candidate-tests-final.log` và `/tmp/candidate-full-final.log`.
- `npm run check` / build đã qua; log `/tmp/candidate-check-final.log`, `/tmp/candidate-build.log`. Kết quả cuối xem báo cáo bàn giao trong câu trả lời.
- Benchmark dữ liệu GIẢ, không phải thị trường: 200 mint, 24.200 observation calls, 1.200 snapshot, 200 nhãn, 5.443.584 byte (~5,19 MiB), ~3,02 giây cho ghi/tính nhãn. Khoảng 27.218 byte/token; 1.000 token mới/ngày tương đương ~26 MiB/ngày theo mẫu này. 128 MiB không đủ giữ đủ 14 ngày ở tốc độ đó; cơ chế dọn dung lượng sẽ xóa sớm. Cần đo lại trên Railway; đây không phải benchmark inference hoặc throughput production. Báo cáo `/tmp/candidate-benchmark-report.json`.
- Thử nguồn công khai thật: CONNECT đến `api.dexscreener.com` bị proxy môi trường chặn 403 (`curl` exit 56, HTTP=000). Token thị trường mới thu thành công trong môi trường này: **0**. Không có thống kê thị trường 60 phút, chưa có tỷ lệ WIN thật. Không gửi lệnh để thử.
- Không có quyền đọc Volume/Railway runtime ở phiên này. Chưa triển khai/chưa xác nhận worker chạy được trên production. Không đọc key/API key hoặc ký/gửi giao dịch.

File mới: `src/candidate-observer.js`, `src/candidate-observer-data.js`, `src/candidate-observer-store.js`, `src/candidate-observer-worker.js`, `scripts/analyze-candidates.js`, `test/candidate-observer.test.js`, tài liệu này.

File sửa: `src/market.js` (hook raw feed), `src/discovery.js` và `src/pump-fun-market.js` (hook ID trước lọc), `src/live-fleet.js` (quan sát executor status), `src/paper-server.js` (worker lifecycle, hook kết quả, read-only stats), `.env.example`, `package.json` (lệnh analyze/check).

Riêng module observer không sửa: rules-config/v5/risk/allocation/runtime/client/treasury, runner, live-treasury, prompt, UI, risk limits. Bản phát hành tổng hợp còn có thay đổi sizing SCALP được yêu cầu riêng, xem `docs/rules-v5/SMALL-WALLET-SIZING.md`. Review diff với `git diff` và các file mới; patch bàn giao bao gồm cả file mới.

## Mặc định cho gói miễn phí

Giữ đủ cửa sổ 60 phút + grace để gán nhãn. Sau đó xóa ngay samples thô của token đã hoàn tất, giữ candidates, sáu snapshot và nhãn tối đa 3 ngày. Mỗi 60 giây dọn dữ liệu quá hạn/áp lực dung lượng và chạy incremental vacuum để trả trang trống về filesystem; startup cũng dọn các sample hoàn tất còn sót từ bản cũ. Ngân sách observer mặc định 32 MiB, chừa 64 MiB đĩa trống. Cờ `lastCleanupAt`, `rawSamplesDeleted`, `prunedCandidates` cho biết tiến trình dọn. Khi quá tải vẫn có thể xóa sớm hơn 3 ngày.

Giới hạn này chỉ áp dụng DB candidate-observer. Log cũ, dormant dataset, dataset cũ và dung lượng Railway khác không tự được xóa bởi module này; chưa kiểm tra được tổng Volume production. Cần xuất CSV định kỳ trước khi retention xóa nếu muốn tích lũy dữ liệu nghiên cứu lâu dài. Không xóa ledger/lệnh/vị thế/ví. Các biến đã đặt trên Railway sẽ ghi đè mặc định mới: cần đổi chúng nếu vẫn đang là 14 ngày/128 MiB.

Kiểm chứng phần dọn: `/tmp/candidate-free-tier-tests.log` có 26/26 test qua, gồm xóa raw sau khi commit nhãn, rollback không mất raw, tắt riêng xóa raw, dọn khi restart và kiểm tra kích thước DB thật giảm sau vacuum. `npm run check` qua (`/tmp/candidate-free-tier-check.log`). Benchmark dữ liệu GIẢ tương tự 200 token sau dọn: 2.863.104 byte (~2,73 MiB), giữ đủ 1.200 snapshot và 200 nhãn; trước dọn bản cũ 5.443.584 byte. Khoảng 14.316 byte/token trong mẫu này; đây không phải tốc độ/dung lượng production. Báo cáo `/tmp/candidate-free-tier-benchmark.json`. Chưa push/deploy hay dọn Volume thật.
