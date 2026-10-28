# LIVE Rules V5.0 — không gọi AI

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
   thời hạn. Bộ ký cha đọc lại evidence, kiểm lại vốn hiện tại, vị thế, thời gian
   UTC, holder/dev on-chain và chấm lại điểm từ giá trị holder/dev thật. Sau
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
- STANDARD = 2% equity, ADAPTIVE = min viable theo công thức, tối đa 15% equity
  theo F8. F4 được tính lại, tối đa 5 vị thế. Pending BUY cũng chiếm slot/vốn.
- Luôn giữ >=0.05 SOL gas và đệm 0.005 SOL. Cơ chế đặt chỗ vốn, phí/rent và
  các guard signer/slippage/simulation cũ tiếp tục áp dụng. Guard 90% cũ là
  hàng rào ngoài, không phải sizing mới; F2/F8 chặt hơn.
- ADAPTIVE phải bấm xác nhận SIZE_DEVIATION cho số tiền/tỷ lệ/friction đang
  hiển thị. Xác nhận có hiệu lực 30 giây và mất hiệu lực sau một lần ký hoặc
  thay đổi thiết lập/số liệu. Không có nút chấp thuận mọi mức cỡ lệnh vô hạn.
  Đó là xác nhận rủi ro sizing, không phải ví ký từng transaction.
- R6 dùng current_utc_hour: chỉ nhận BUY trong các giờ UTC 03–17. Theo cách
  hiểu nguyên văn các khoảng giờ trong prompt, giờ 02 cũng bị chặn toàn giờ.
  Tương đương giờ Việt Nam 10:00–00:59. SELL bảo vệ và đối soát luôn chạy.

## Các mâu thuẫn trong prompt được xử lý công khai

Nguồn nguyên văn ở prompt-v5.txt. Công thức và hard rules có ưu tiên hơn ví dụ:

- Tổng điểm dương tối đa là 8.5, không phải 9.0 như ví dụ STANDARD.
- ADAPTIVE trừ 0.5, nên tối đa 8.0; nếu friction >6% còn bị trừ 2.0.
  Ví dụ 0.5 SOL / priority 0.0005 / slip 3% mỗi phía có friction 10%, điểm tối
  đa 6.0, phải SKIP theo R8. Không ép thành VALID_SETUP như ví dụ.
- Ví dụ STANDARD 3.33 SOL / priority 0.0005 / slip 1.5% mỗi phía có friction
  khoảng 6.5015%; điểm tối đa 6.5 sau phạt, cũng không đạt R8.
- R8 là hard rule score >=8.0; vì thế WATCH 7.x không thể xuất hiện cùng
  “không có rule fail”. Bộ máy không tự nới R8 để tạo WATCH.
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
hay số holder để tự tạo narrative heat. Nếu các trường hard-rule thiếu, bot
SKIP và liệt kê chính xác; cổng này không phải hạn chế credit AI.

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
