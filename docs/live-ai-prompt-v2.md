# LIVE aiOnly — prompt v2, chưa bật mặc định

Phạm vi: chỉ prompt/selector và metadata log. Không deploy/push production,
không bật giao dịch,không đọc .env/key/ví hoặc gọi API thật. V1 vẫn là mặc định. Theo bổ sung sau đó của người dùng,RADAR LIVE lọc tuổi pool>=10giờ;v2 ưu tiên market cap>2k,<30kUSD và tránh mua đuổi m5Pct>100.

## Thay đổi và rollback

- src/prompts/live-ai-system.v2.txt: nguyên văn nội dung giữa <<< và >>> người dùng
  gửi,chuẩn hóa xuống dòng LF,không thêm schema hay sửa chỉ dẫn.
- src/prompts/live-ai-focus.v2.txt: phần ưu tiên mới được người dùng bổ sung;không sửa nguyên văn asset gốc.
- src/radar-policy.js,src/paper-server.js,public/paper.js và test/radar-policy.test.js:lọc hiển thị RADAR LIVE theo tuổi pool>=10giờ;pool chưa rõ tuổi/0/future không hiển thị. Không lọc universe AI hoặc loại vị thế đang giữ khỏi quản lý.
- src/live-ai-prompt.js: đọc asset public,công tắc LIVE_AI_PROMPT_VERSION và SHA256.
- src/paper-model-context.js: chỉ thêm early return cho liveAI+v2. V1 vẫn nguyên
  văn;nhánh paper,verification,legacy-live và modelMessages(BATCH MODE) giữ nguyên.
  Validator đơn/batch không đổi.
- src/paper-model-client.js: promptVersion/promptSha256 cho reply/error và dataset.
- src/paper-model-runtime.js: lưu metadata vào ai.lastDecision/history và JSONL
  decisions,bao gồm WAIT do lỗi model. Record không gắn được request có null,
  không gán nhầm phiên bản của quyết định trước.
- src/paper-supervisor.js và src/paper-bot-worker.js: chuyển metadata lỗi quaIPC.
- .env.example: selector v1 mặc định,không đổi biến LIVE hay các tham số khác.
- test/live-ai-prompt.test.js và test/fixtures/prompt-v1-baselines.json: kiểm tra
  v1 không thay đổi,v2 đúng byte,schema,offline replay và metadata.
- docs/live-ai-prompt-v2.md: báo cáo này.

**Không thay** executor,automatic treasury,stop monitor,giới hạn,circuit breaker,
bookkeeping,config temperature/maxTokens/timeout,hoặc bộ tạo dữ liệu context.

Khi sau này chủ động áp dụng vào một môi trường được phép:

```ini
LIVE_AI_PROMPT_VERSION=v2
```

Quay lại:

```ini
LIVE_AI_PROMPT_VERSION=v1
```

Không đặt biến hoặc đặt giá trị khác v2 cũng chọn v1. Biến này chỉ chọn prompt cho
LIVE aiOnly,không tự bật LIVE,không bypass xác thực và không mở giao dịch.
Hiện tại KHÔNG áp dụng biến vào Railway hoặc sửa .env thật.

promptVersion: v1/v2 cho LIVE aiOnly;paper-v1,verification-v1,live-legacy-v1 cho
nhánh tương ứng. SHA256 được tính trên toàn bộ SYSTEM gửi đi,sau khi nốiBATCH MODE.
Vì slot còn lại nằm trong câu BATCH MODE,hash có thể khác dù cùng v2.
Hash riêng asset gốc v2(chưa nối focus/BATCH):21d880467b8b8dee027f08325350352dc091b5d6e5ee29380751d728e656fce7.

## Kiểm tra dữ liệu mục5

| Trường | Có trong context? | Dạng và điều kiện |
|---|---|---|
| closedM1 | Có,hoặc null | Tối đa16nến đóng,thứ tự thời gian tăng dần |
| closedM1[i] | Có đủ6cột khi hợp lệ | [ts_seconds,open,high,low,close,volume] |
| ts | Có | Unix giây,không phải milliseconds;căn phút |
| open/high/low/close | Có | Giá từ GeckoTerminal OHLCV,yêu cầu currency=usd,token=base |
| volume từng nến | Có | Cột5;giá trị numeric>=0 lấy nguyên từ provider,không tự tạo volume |
| solUsd cấp context | KHÔNG | Không được gửi riêng;feed bên ngoài có solUsd |
| priceUsd,priceSol | Có key | Số hữu hạn hoặc null qua num();không bảo đảm mọi market/holding luôn có cả hai giá hợp lệ |
| wallet.equitySol | Có | Live treasury view hiện đặt null;không phải tổng NAV đã mark |
| wallet.cashSol | Có | Native SOL balance quan sát được;fallback được nhưng không cộng giá trị token đang giữ và vẫn bị maxOrderSol chặn |
| flow.lastTenBuys | Có trong flow | Số BUY trong10giao dịch nếu lastTenComplete=true;ngược lại null |
| flow.complete | Có trong flow | Boolean,từ windowComplete,cửa sổ5phút |
| flow.lastTenComplete | Có trong flow | Boolean,độc lập với complete5m |
| flow.walletsComplete | Có trong flow | Boolean cho độ phủ danh tính ví |
| flow.uniqueBuyers/uniqueSellers | Có trong flow | Numeric khi walletsComplete=true,ngược lại null |
| flow.largestBuySharePct | Có trong flow | Numeric khi windowComplete=true,ngược lại null;đây là tỷ trọng BUY lớn nhất,không phải holder concentration |
| mintSafety.facts.mintRevoked/freezeRevoked | Có khi facts verified | true từ RPC checkedMintFacts;authority còn tồn tại sẽ bị check từ chối;unknown có facts=null,không được coi true |
| mintSafety.facts.tokenProgram/extensionsSafe | Có khi verified | spl-token/spl-token-2022 và boolean;không phải mọi extension đều hỗ trợ |
| ageMs | Có key | now-pairCreatedAt khi số hữu hạn;pairCreatedAt=0 có thể tạo tuổi rất lớn thay vì null,không chứng minh tuổi thật |
| high30m/low30m | Có key | Có giá khi>=30nến hợp lệ;ngược lại null;đơn vị như OHLC USD |
| positions[].stopLossPct | Có | p.aiStopLossPct hoặc null |
| positions[].entryRiskAssessment | Có | {approved,reason,risks,unknowns} lúc vào lệnh hoặc null;không phải bộ feature entry đầy đủ |

Nếu flow chưa có thì flow=null. Nếu candle thiếu/sai/đứt phút hoặc nến đóng mới
nhất không khớp ranh phút hiện tại thì closedM1=null,cùng high/low có thể null.
Volume có cột thật khi candle hợp lệ;không có chuyện tự thêm volume vào mảng5cột.
Code không kiểm chứng độc lập đơn vị volume ngoài cấu hình currency=usd của
provider;không gọi API production để xác minh trong nhiệm vụ này.

### Các giả định v2 chưa được hợp đồng hiện tại đáp ứng đầy đủ

1. **Stop/trailing/breakeven khác nghĩa executor.** Stop hiện kích hoạt khi
   quantity*priceSol <= remainingCostSol*(1-stop_loss_pct/100). Đó là tỷ lệ dưới
   giá vốn còn lại,không phải khoảng cách tính từ giá hiện tại. 0 bị validator từ
   chối;stop trên giá vốn cần phần trăm âm,cũng bị từ chối. Vì vậy chỉ dẫn hòa vốn
   sau+10% hoặc trailing khóa lãi không biểu diễn trọn vẹn bằng schema đang có.
   RATCHET không được executor cưỡng chế một chiều;validator chỉ kiểm0<pct<100.
   Không sửa để tránh thay đổi hợp đồng/logic mà user cấm.
2. **Entry liquidity/exit cost thiếu.** Không có trường entry-time liquidity và
   quote round-trip hiện tại trong positions/candidates context. EntryRiskAssessment
   chỉ là nhận xét/unknowns,không thay được mốc thanh khoản lúc mua. Prompt phải
   để unknown,không suy đoán mức giảm20% hoặc phí3%. Dataset quoteVsMid không tự
   đưa vào context. Check6% của builder tồn tại nhưng không cung cấp số đo3% choAI.
3. **Tên high30m không bảo đảm đúng30nến.** Implementation kiểm>=30nhưng lấy max/min
   toàn bộ nến hợp lệ nhận về(khoảng30–35),không slice(-30). Không sửa thuật toán.
4. **Đơn vị.** Nến/high30m/low30m dùng USD;priceSol dùng SOL. So sánh cấu trúc bằng
   priceUsd tương ứng,không so trực tiếp high30m USD với priceSol. priceUsd/priceSol
   chỉ ước lượng SOL/USD khi cả hai dương,hữu hạn và cùng thời điểm đủ mới;
   không có bảo đảm tỷ giá oracle riêng.
5. **Missing data có thể khiến HOLD nhiều hơn.** Context holders/LP/RugCheck hiện
   null;holder concentration chưa có. Flow/candle nhiều pool có thể missing vì
   ngân sách API. Score>=70,trừ điểm unknown và yêu cầu chi phí<=3% có thể khiến
   đa số token không được mua. Đây là hành vi prompt được yêu cầu,không được sửa
   bằng nới validator,gánunknown=an toàn hoặc giảmngưỡng trongcode.

## Token/latency sizing

Đây là ước lượng trên **context giả lập**,không đọc context ví/log thật,không dùng
River tokenizer hoặc gọi API thật. Không thêm dependency tokenizer.

- Asset SYSTEM gốc:6,508 ký tự ASCII,1,026từ;heuristic khoảng1,300–2,170tokens.
- SYSTEM sau bổ sung market focus:7,462ký tự;hash52b5dd4be13223688add94ff02f461b9f14ab47052ab526da8b756cbae13184e.
- SYSTEM có BATCH MODE5slot:7,981ký tự;khoảng1,596–2,661tokens.
- Context8candidates có đủ16nến/flow/mintSafety:19,560ký tự;SYSTEM+context ước lượng
  6,487–12,441input tokens.
- Context60candidates cùng mật độ:144,596ký tự;tổngước lượng37,746–74,959input tokens.
- Output ví dụ ngắn:HOLD305UTF8bytes(~61–153tokens),BUY388bytes(~78–194tokens),
  batch5BUY1,960bytes(~392–980tokens). Đây là mẫu ngắn,không phải upper bound.

Input dùng char/5..3(SYSTEM) và char/4..2(JSON);output dùng byte/5..2. Tokenizer
DeepSeek/River có thể khác;không dùng các số này để khẳng định context limit thực.

`max_tokens` là ngân sách OUTPUT,không phải tổng input+output. Giữ nguyên500single,
>=2048batch;maxTokens,temperature0.2,timeout15s mặc định không đổi. Một BUY/HOLD ngắn
thường có thể vừa500,nhưng nhiều risks/unknowns,lý do dài/tiếngViệt,hoặc batch5lệnh
vẫn có thể vượt2048và bị finish_reason=length. Parse/validate vẫn từ chối như cũ.
Context lớn và quá trình suy luận có thể vượt timeout15s;không đo được latency
River thật hoặc xác minh context capacity trong nhiệm vụ offline này.

## Kiểm thử / trạng thái

- Unit mới:5test bao phủ v1-byte-baseline,v2đúng nguyên văn,không lặp schema,
  BUY/SELL/stop-HOLD/portfolio-HOLD/batch,giới hạn cũ và metadata success/error.
- Offline replay đi qua PaperModelClient với HTTP response giả lập,HOLD vào
  runtime logger;execute stub ném lỗi nếu bị gọi. Không gửi bất kỳ lệnh thật nào.
- npm run check:pass. npm run build:pass.
- npm run test:offline:92file,0filelỗi;565test được harness báo pass.
-8fileHTTP/integration bị runner offline loại khỏi danh sách;không báo là đã chạy.
- Không đổi code executor/stop/circuit breaker/bookkeeping hay các giới hạn.
- Không deploy,không bật v2 ngoài test process,không sửa .env thật.

## Bổ sung RADAR và market focus theo yêu cầu sau

RADAR5M LIVE chỉ hiển thị pool có pairCreatedAt xác định và tuổi>=10giờ,tính từ
thời điểm snapshot. RADAR vẫn chỉ hiện token tăngM5 trong bảng;tuổi thiếu/0/future
không tự coi là đủ10giờ. Đây là lọc hiển thị,không thay bộ chọn ứng viên choAI hay
chặn SELL/stop vị thế cũ. Paper radar không đổi.

V2 giữ nguyên asset người dùng gửi rồi nối asset focus:ưu tiên marketCapUsd>2000
và<30000USD,không lấyFDV thaymarketcap;strongly deprioritize ngoài vùng/unknown.
M5>100% thì normallyHOLD,tránhBUYđuổi. Đây là yêu cầu ưu tiên củaAI,không phải giới
hạn cứng mới ởvalidator/executor. Không áp dụng giới hạn cap/M5 này choSELL hoặc
cập nhậtstop.V1 mặc định giữ nguyênbyte,vì vậy chưa tự có ưu tiên mới trước khi
chủ động chọnv2.
