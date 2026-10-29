# LIVE Rules V5.2 — không gọi AI

Theo yêu cầu ngày 29/10/2026 (giờ Việt Nam), LIVE dùng bộ quy tắc định lượng
thay model, giữ ví chủ và bộ ký tự động trên server. Không đọc khóa từ chat,
không đổi người nhận lãi, không xóa sổ hoặc phát lại chữ ký cũ.

## Luồng

1. Scout: nguồn PumpSwap hiện có + khám phá pump.fun trước migrate. Không áp
   bộ lọc vốn hóa 2k–30k hay tuổi radar 10 giờ của prompt cũ cho LIVE mới.
2. Analyst: tính F1–F8 và R1–R9 bằng code, không prompt inference hay model API.
   Bằng chứng thiếu/cũ hiển thị mã SKIP cụ thể. Dữ liệu chưa có không thành 0
   hoặc nhãn sạch/an toàn.
3. Sniper: VALID_SETUP sinh giấy phép nội bộ, gắn đúng mint, pool, số lượng và
   thời hạn. Bộ ký cha đọc lại evidence, kiểm lại vốn hiện tại, vị thế, holder/dev on-chain và chấm lại điểm từ giá trị holder/dev thật. Sau
   prepare còn kiểm lại sizing/vốn và tuổi evidence/quote trước ký. Giấy phép chỉ gắn một intent ID.
4. Risk: chạy độc lập với pause BUY, theo giá mới. Vị thế V5 dùng stop -20%,
   bán 50% tại 2x, trailing -15% sau khi receipt xác nhận TP, time exit sau
   90 phút nếu giá nằm [-5%, +15%] so với giá vào. Các trigger được chốt/lưu khi đã chạm để việc hồi giá trong thời gian
   chuẩn bị lệnh không làm mất stop/TP; signer kiểm lại đúng lý do và số lượng
   SELL. Không có đóng mọi vị thế
   vô điều kiện khi đủ 90 phút. Stop là trigger, không đảm bảo giá thoát.
5. Banker: receipt on-chain mới tạo fill/PnL. Giữ Telegram và cơ chế chuyển lãi
   hiện có; partial SELL không trở thành một vị thế thắng riêng.

Năm dòng UI là năm bước nghiệp vụ, không phải năm LLM hoặc năm tiến trình giả.
Worker vẫn dùng chung cơ chế IPC/queue/signer/reconcile đã có. Một số tên field
nội bộ cũ như aiStopLossPct/aiRiskEvidence còn giữ để tương thích sổ cũ; dữ liệu
mới được tạo từ phép tính deterministic, không phải AI. Rule grant đi trong
aiRiskEvidence.rulesGrant. decisionEngine mới là rules-v5; modelName/prompt hash
mới là null. MODEL_* và LIVE_AI_PROMPT_VERSION không được dùng để gọi AI ở LIVE.
Paper cũ vẫn là nhánh sản phẩm riêng và cũng được ép tắt gọi model ở server;
Rules V5 áp dụng cho LIVE.

## Vốn, xác nhận và lịch chạy

- Equity lấy từ SOL on-chain + giá trị vị thế có giá mới + rent đang khóa.
  Không thay equity bằng vốn giả hoặc tiền nạp cố định. Thiếu định giá thì
  không cấp lệnh BUY mới. USD/USDC trong output là quy đổi theo giá SOL/USD,
  không phải chuyển tiền hay số dư USDC thực tế.
- **AUTO** hoàn toàn: không còn STANDARD 2% / ADAPTIVE 15% hay xác nhận
  SIZE_DEVIATION. Quyền này được người dùng cấp rõ ràng trong yêu cầu mới.
- Trần mỗi BUY = **50% số SOL đang có trong ví**, đồng thời không vượt 50%
  equity. Vị thế token đang giữ không làm tăng trần trên số SOL thực có.
  Ví dụ ví 0,5 SOL, trần 0,25 SOL; không phải lệnh nào cũng dùng hết trần.
- Bot chấm điểm phân bổ trước chi phí: 6 điểm →10% SOL, 7→20%, 8→30%,
  9→40%, 10→50%; điểm lẻ nội suy, luôn kẹp 10–50%. Ngưỡng điểm và toàn bộ
  gate an toàn vẫn áp dụng riêng; có thể HOLD dù đã tính được kích thước.
- Số tiền thực = min(target, trần 50%, vốn khả dụng đã trừ đặt chỗ/lãi,
  SOL ví −0,05 gas −0,005 đệm phí, 2% dự trữ SOL của pool nếu đã đọc).
  Làm tròn xuống lamport. Order <max(0,0025 SOL, trần phí mạng×40) thì SKIP.
  Không còn sàn mua bắt buộc 0,05 SOL; 0,05 SOL là phần **để lại làm gas**.
- Tối đa 5 vị thế, pending BUY chiếm cả slot và vốn. Nhiều lệnh dùng chung
  ngân sách, không được mỗi lệnh tiêu lại cùng một số dư. Nếu cỡ lệnh bị
  kẹp khác quote, phải đợi quote đúng size; không dùng giá quote của size cũ.
- Profile core lấy quote đúng size sau khi đọc holder và depth. Tổng friction
  tối đa 8%; quote vòng thực vẫn ≤6% và impact mỗi chiều ≤2%. Sizing được
  chọn trước quote để tránh vòng lặp score–friction–size.
- Signer đọc lại số dư ví, cap 50%, đặt chỗ, holder/dev, quote và mô phỏng
  trước ký. Thay đổi size/vốn thì bỏ intent chưa ký và xét lại, không tự nới
  quyền trên grant. Lệnh đã ký vẫn đối soát bằng ID/chữ ký cũ.
- Không xác nhận từng size và không bấm ví cho từng giao dịch. Kết nối/xác
  thực ví ban đầu, nút Tiếp tục BUY / Dừng BUY vẫn là quyền điều khiển của chủ.
- BUY hoạt động **24/7**, bỏ cổng giờ UTC ở cả bộ quyết định và signer.
  Không chặn theo percentile toàn thị trường. SELL bảo vệ và đối soát luôn chạy.
- R8 hạ từ 8 xuống **6**. R1 vẫn kiểm tra vốn, slot và định giá; giá trị vị thế
  đang tăng không tự làm fail chỉ vì vượt kích thước lệnh ban đầu. Không tăng sizing.
- Tất cả box UI có thu gọn/mở và nhớ trạng thái trên thiết bị, trừ Pipeline.

## Khác biệt giữa V5.2 và prompt V5.0 nguyên bản

Nguồn nguyên văn được lưu bất biến ở prompt-v5.txt. V5.2 nới điều kiện vào theo
yêu cầu cập nhật của người dùng; không còn là bản sao nguyên xi mọi hard rule V5.0:

- Tổng điểm dương tối đa là 8.5, không phải 9.0 như ví dụ STANDARD.
- V5.0/V5.1 từng trừ điểm ADAPTIVE và yêu cầu xác nhận cỡ lệnh. V5.2 bỏ
  mode ADAPTIVE và penalty đó. Điểm full-research tối đa 8,5; core tối đa 10.
- Ví dụ chi phí cao vẫn có thể bị SKIP dù đủ điểm: hard cap friction 8% và
  các quote/simulation guard không được bỏ để cố tạo giao dịch.
- R8 mới score >=6.0. Kết quả vẫn VALID_SETUP hoặc SKIP; không tạo WATCH giả.
  Điểm không phải xác suất thắng và không chứng minh chiến lược có lãi.
- F6 ở INFEASIBLE bằng proposed_size_sol(0) nhân friction, kết quả 0 SOL.
  Ví dụ 0.104 SOL dùng denominator khác, không được sao chép.
- Khi max_concurrent_positions=0, kiểm tra R1b 0<0 là false, không phải true
  như ví dụ INFEASIBLE.
- Không coi các tuyên bố mô phỏng 100k episodes, 98%, -1.19%, +8.14% là số
  hiệu quả đã được xác minh. Reward/training/Brier trong tài liệu không chạy
  như một chương trình huấn luyện; không tạo confidence xác suất thắng giả.
  Output confidence=0 ghi rõ chưa hiệu chuẩn, không dùng để nhân sizing.
- Các câu “không được bỏ cơ hội” không bỏ qua hard rules, dữ liệu bắt buộc,
  vốn thật, quyền ký và kiểm tra thực thi.

Đầu vào đầy đủ tạo kết quả 17 key theo schema. Thiếu các đầu vào bắt buộc tạo
bản ghi chẩn đoán RULES_DATA_MISSING riêng, thay vì tạo JSON giả với số 0 và
nhãn pass. validator.py được nhắc trong tài liệu chưa được cung cấp; các phép
đối chiếu hiện tại là unit test độc lập F1–F8 và các biên R1–R9.

## Nguồn dữ liệu: phần nào đã có, phần nào còn thiếu

Không cần cấu hình AI hoặc MODEL_API_KEY để kết nối/chạy LIVE.
Khi không có adapter nghiên cứu, server dùng RPC hiện có để đọc mint/pool,
đếm holder theo owner, loại LP/curve, top10, tỷ lệ dev và tiến độ curve.
Quét holder được giới hạn/lên lịch background, không gọi 12 full scans cùng lúc.
Feed thị trường tiếp tục cung cấp giá, volume và số lượt BUY/SELL.

Những số này chưa đủ chứng minh các điều kiện sau:
- dev đã từng bán trong 10 phút đầu từ lịch sử đầy đủ;
- block-0 buyer count gắn đúng slot tạo token;
- bundle clusters với độ phủ lịch sử đã kiểm chứng;
- global pump.fun volume percentile với baseline/as-of xác định;
- mô hình dump lúc graduation;
- lịch sử monotonic curve, ATH, volume ổn định/declining;
- tuổi các tài khoản mạng xã hội, funding sạch và narrative heat định lượng.

Không suy ra block-0 từ slot giao dịch sớm nhất của một trang trade bị cắt.
Không suy ra funding sạch chỉ vì mint/freeze đã revoke. Không dùng vài headline
hay số holder để tự tạo narrative heat. V5.0 chặn toàn bộ khi thiếu những trường này. V5.2 mặc định dùng
**onchain-momentum**, ghi rõ lịch sử nghiên cứu chưa xác minh, và không cấp
điểm thưởng funding/social/narrative giả. Nếu cấu hình dịch vụ nghiên cứu
đầy đủ, adapter vẫn yêu cầu coverage/freshness đúng hợp đồng.

### Profile mặc định onchain-momentum (không cần thêm Variables)

- Mint/pool phải qua kiểm tra RPC thực và simulation hiện có. Holder cộng theo owner,
  loại vault LP/curve: top10 ≤25%, dev ≤5%, ≥20 holder. Creator PumpSwap lấy từ
  `coinCreator` on-chain; thiếu dev không coi là 0%.
- Dự trữ SOL thực ≥5 SOL; quote không vượt 2% depth/impact.
- Giá 5 phút tăng >0 và ≤100%; ≥5 BUY, tổng ≥8 giao dịch; BUY/SELL ≥1,1
  (mẫu số ít nhất 1), volume ≥0,5 SOL. Giá ≤5s, dữ liệu activity ≤30s.
- Tín hiệu creator bán gần đây hoặc suspected bundle đã quan sát chặn BUY.
  Không có tín hiệu **không chứng minh** dev chưa bán ở quá khứ/bundle sạch.
- Quote vòng mua–bán theo chính cỡ lệnh từ ví phải thành công, loss ≤6%, hai
  impact ≤2%, tuổi ≤5s. Tổng friction dùng loss thực + dự phòng phí mạng hai
  chiều, mỗi chiều 0,000025 SOL là trần phí execution đã có. Phí protocol/
  slippage không tách được thì để null, không bịa bằng 0.
- Điểm core tối đa 10: top10 <15% +3, ≤20% +2, ≤25% +1; dev <3% +2,
  ≤5% +1; momentum 5m phù hợp +2; BUY/SELL ≥1,2 +1; volume ≥2 SOL +1;
  dự trữ ≥10 SOL +1. Friction >6% trừ 2. Không có penalty ADAPTIVE. Ngưỡng ≥6.
- Hồ sơ holder cache tối đa 30s cho scanner, có timestamp riêng. Bộ ký kiểm
  tra holder/dev lại trực tiếp; quote và evidence có TTL riêng, không gia hạn
  dữ liệu cũ bằng timestamp mới. Cache ≤500 token và RPC scan được lên lịch.
- Không tự mua nếu thiếu bằng chứng core, ví chưa kết nối, tạm dừng, thiếu gas,
  hết slot hoặc quote khác cỡ lệnh đã chọn. UI hiển thị các lý do này.

Sửa đường thực thi: BUY curve chỉ cho phép với capability nội bộ của treasury
LIVE, không nhận capability từ JSON. Các caller curve cũ vẫn bị chặn BUY.
Với PumpSwap không trả entryQuoteProof, signer lấy quote vòng đọc thật trước
ký và kiểm lại cỡ lệnh, độ mới và cap; không bỏ cổng chi phí vì thiếu field.
`rulesPolicyVersion` của vị thế/exit vẫn V5.0 để tiếp tục bảo vệ các vị thế cũ;
version của **entry policy**/fingerprint mới là V5.2. Không sửa ledger/chữ ký cũ.

Muốn cung cấp đủ DECISION INPUTS từ một nguồn nghiên cứu thật có thể cấu hình:

```env
TRADING_MODE=live
TRADING_PRODUCT=solana-spot
# Giữ nguyên LIVE_SIGNER_SECRET_KEY, HELIUS_API_KEY, PUBLIC_ORIGIN, Volume hiện có.
# Chỉ đặt URL sau khi có dịch vụ cung cấp các số liệu và coverage thực:
RULES_EVIDENCE_URL=https://your-owned-verified-data-service.example/rules-evidence
```

URL trên là minh họa hợp đồng, không phải dịch vụ có sẵn. Không copy URL mẫu
vào Railway. Nếu chưa có nhà cung cấp thật, để trống; các giới hạn dữ liệu sẽ
được báo trên UI. Helius raw RPC không tự cung cấp sẵn tất cả field nói trên.
Không có nguồn mới được bí mật cài hoặc đăng ký thuê bao trong bản cập nhật.

GET adapter chỉ gửi query `mint` và `pool`; không gửi wallet owner, số dư,
private key, signed tx hoặc API key. HTTPS, không follow redirect, timeout
2.5s, giới hạn response 128k. Cấu trúc response:

```json
{
  "mint":"public mint", "pool":"public pool", "checkedAt":1793275200000,
  "source":"provider-and-method-version",
  "coverage": {
    "top10ExcludesLpAndCurve":true, "devHistoryFromLaunch":true,
    "block0Complete":true, "bundlesComplete":true,
    "volumePercentileAsOfVerified":true
  },
  "inputs": {
    "market_cap":12000,"curve_progress_pct":40,"holder_count":120,
    "top10_pct":10,"dev_wallet_pct":2,"dev_sell_history":[],
    "block0_buyer_count":0,"bundle_clusters":[],
    "volume_5m":1000,"volume_1h":8000,"buy_sell_ratio":1.4,
    "liquidity_depth":12000,"graduation_dump_model":20,
    "narrative_heat":8,"funding_source_trace":{"status":"clean"},
    "holder_growth_rate":2,"token_age_minutes":60,
    "socials":{"presence":true,"account_age_days":[60]},
    "global_pumpfun_volume_24h_percentile":60,
    "priority_fee_sol":0.000025,"protocol_fee_pct":1,
    "expected_slippage_pct":1
  },
  "observations": {
    "curveMonotonic":true,"volume5mStable":true,"liquidityHealthy":true,
    "newAthWithin120m":true,"volume1hDeclining":false,
    "dumpMath":"(20/100)*100 = 20"
  }
}
```

Đây là fixture minh họa cấu trúc, KHÔNG phải dữ liệu token thật. Provider phải
công bố phương pháp/chuỗi quan sát cho các tính chất không thể suy ra từ một
snapshot (monotonic, stable, ATH), và ngưỡng định nghĩa liquidity healthy: prompt
không cho công thức của chúng. Bộ máy không tự invent các tiêu chí này.
Các coverage flag do provider khai không phải kiểm toán; cần kiểm chứng nhà
cung cấp. RPC holder/dev độc lập vẫn được kiểm lại và dùng chấm lại điểm trước ký.
F5 giữ đúng các thành phần trong prompt; các khoản base fee/rent không được
âm thầm đổi thành protocol fee. Guard thực thi riêng vẫn kiểm phí mạng/rent và
chi phí khứ hồi thực của quote. Ước tính không bảo đảm chi phí tương lai hoặc MEV.
Source đầu vào yêu cầu <=5 giây tại quyết định; grant tối đa 10 giây, quote có
các guard freshness riêng. Không thể bảo đảm các điều kiện còn nguyên lúc khớp.
Protocol/priority/slippage phải lấy từ nguồn chi phí thật hoặc ước lượng có
căn cứ, không coi 1%/0.25% trong mô tả là biểu phí production bất biến.

## Bảo toàn sổ cũ

- Không đổi ID, signature, raw quantity, cost basis hay khóa state cũ.
- Orders đã ký tiếp tục reconcile ngay cả khi không có rule grant sau restart.
  Không prune chữ ký vì đổi engine hoặc vượt giới hạn mới.
- BUY AI cũ chưa ký không được vượt qua cổng grant của V5.
- Vị thế mới lưu rulesPolicyVersion, entryPriceSol, initialQuantity và exitPolicy
  V5. TP được đánh dấu chỉ từ receipt thật.
- Vị thế cũ giữ stop đã lưu, không tự nới stop hoặc suy đoán entry ban đầu sau
  partial SELL để gắn TP/trailing mới. UI báo số vị thế cũ rõ ràng.
- Giá curve đọc RPC 1 giây; khi hoàn tất curve, reader có thể theo pool PumpSwap
  canonical mà vẫn giữ pairAddress của lot cũ. SELL dùng curveRoute hiện có.
  Không thêm giao dịch Raydium khi executor chưa hỗ trợ; pool chưa có sẽ chờ.

## UI và vận hành

Giao diện mới dùng equity lớn, đồ thị, năm bước màu, Activity và mục tiêu 2x
như ảnh tham khảo. Số liệu lấy /api/state; không hardcode 8.622 USD, 87% win
hay 3.77x. Thiếu equity/PnL hoặc có dòng token ngoài AI chưa đối soát thì hiện
chưa xác minh. Không lấy PnL từng partial SELL làm win rate. Đồ thị SOL thật,
USD là quy đổi hiện tại. Mục tiêu 2x không thay đổi thuật toán/cỡ lệnh.

Không có private key input trên UI. Kết nối ví chỉ ký thông điệp xác thực;
server ký giao dịch bằng bộ ký hiện có. Telegram vẫn có cấu hình/test, các
receipt và chuyển lãi vẫn theo luồng cũ. Asset HTML/JS/CSS có hash generation.

Rules result + DECISION INPUTS/observations hiện tại nằm trong BotStateStore
và export sổ. Lịch sử đầy đủ đi vào research/journal/*.jsonl.gz bất đồng bộ,
giới hạn 32 MiB/3 ngày và buffer 2 MiB, dùng cơ chế dọn research hiện có.
Không nhồi 12 payload lớn mỗi 5 giây vào decision JSONL không giới hạn; outbox
chỉ giữ sự kiện quyết định/thực thi gọn. Trạng thái research báo số dòng bị
mất khi buffer/disk không theo kịp, không được coi là dữ liệu đầy đủ vô hạn. Các trường evidence ngoài allowlist
bị bỏ; địa chỉ funding/holder không đưa vào payload quyết định. Dataset fill và
error vẫn qua pipeline cũ; không tạo model_calls giả khi không còn gọi model.

## Kiểm tra

- Unit F1–F8, biên R1–R9, điểm tối đa/mâu thuẫn ví dụ, ack, missing/stale data,
  trigger thoát, routing IPC và grant trước ký.
- Treasury fixture kiểm tiền/holder, ký đúng một lần, ghi bền trước send, receipt
  và khôi phục lot/signature. Tất cả key là key ngẫu nhiên trong test.
- HTTP thực của app xác nhận externalModelCalls=0 sau login, auth/origin, ack,
  signer thiếu và asset immutable; không gọi broker thật.
- Chromium local kiểm tra mobile 390px / desktop 1120px, không tràn ngang hoặc
  lỗi JavaScript; số dư ảnh kiểm thử là fixture riêng, không phải tài khoản thật.
- Không đọc .env thật, không gửi lệnh hoặc sửa dữ liệu production bằng test.

## Giảm tải RPC và giới hạn RAM sau lỗi heap OOM

Log production xác nhận Node hết heap, còn Helius/Solana HTTP429 và PublicNode
403 làm nguồn dữ liệu không khả dụng. Không có heap snapshot production nên
không quy kết một cache duy nhất là toàn bộ nguyên nhân.

- Giá vị thế đang mở vẫn ưu tiên exit, chu kỳ 1 giây. Token chưa mua chỉ đọc
  RPC cho tối đa 12 ứng viên / 10 giây, quay vòng. Không dùng giá RPC cũ làm
  giá mới; quote/simulation và số dư ngay trước ký vẫn xác minh độc lập.
- LIVE không lấy M1/receipt flow phụ khi DATASET_ENABLED chưa bật. Nếu bật
  dataset vẫn thu, nhưng M1 tối đa một lần / 5 giây, flow / 10 giây. Khi 429
  backoff toàn nguồn, không quay sang token khác để lặp cùng lỗi.
- Metadata SDK pool tối đa 128, TTL 5 phút; attempts tối đa 512; cache đọc
  provider tối đa 256; giá bỏ mint đã rời feed, tối đa 256. Hồ sơ holder
  scanner tối đa 128, bắt đầu full scan tối đa mỗi 10 giây. Signer vẫn đọc
  holder/dev lại trước lệnh. Không đụng ledger, pending signature hay receipt.
- Flow rolling tối đa 512 signature/pool và 16 cursor. Giao dịch lỗi -32015
  được giữ là **incomplete**, backoff 10 phút, không chứng nhận flow sạch.
  Vẫn yêu cầu maxSupportedTransactionVersion=0, không tự giải mã phiên bản
  chưa được SDK hỗ trợ.
- Bootstrap pool mới tối đa mỗi 5 giây; RPC_UNAVAILABLE hoãn ít nhất 30 giây
  hoặc theo retryAt. Các dữ liệu thiếu vẫn null/không đủ coverage.

Không cần tăng NODE_OPTIONS hay thêm key. Các thay đổi không hoàn lại Helius
credits đã tiêu và không đảm bảo một số credits/ngày cố định; số credit còn
phụ thuộc method, vị thế, nhà cung cấp và dataset đang bật hay tắt.
