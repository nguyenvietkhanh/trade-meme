# Gói trích xuất AI PumpSwap — dữ liệu có giới hạn

Thời điểm xuất: 2026-10-28T21:39:45.042043+07:00 (Việt Nam). Commit nguồn: `14af1247411bee67654faa4a6367e7b52d24636b`.
Không sửa source, không deploy, không gọi model hoặc giao dịch. Chỉ tạo gói báo cáo.
Không đọc .env/private key/API key/vault/Telegram secrets. Không xuất địa chỉ ví chủ hoặc nhận lãi.

## A. Thống kê tổng quan

**Chưa lấy được log LIVE production.** Railway CLI báo Unauthorized; truy cập API health/state từ môi trường này gặp URLError. Không tìm thấy live-ledger.json trong các thư mục dự án/báo cáo local đã kiểm tra. Không dùng dữ liệu paper cũ hoặc log test để thay dữ liệu thật.

| Chỉ tiêu | Kết quả |
|---|---|
| Khoảng thời gian log / số vòng / BUY, SELL, HOLD | Chưa lấy được, không ghi là 0 |
| Số lệnh khớp / lỗi theo loại | Chưa lấy được |
| PnL ròng, win rate, PnL trung bình, lỗ lớn nhất | Chưa tính được |
| Drawdown lớn nhất, thời gian giữ trung bình | Chưa tính được |
| Model mặc định | deepseek-ai/DeepSeek-V4.1-Flash qua River |
| Temperature | 0.2 |
| Chu kỳ mặc định | 5 giây/lượt khi có slot/dữ liệu, không phải cam kết mỗi5s có request |
| Timeout / rate budget mặc định | 15s /30 request mỗi phút |
| Output tokens | single mặc định500; batch tối thiểu2048 |
| Độ trễ gọi AI trung bình thực tế | Chưa có log bền vững để tính |
| Prompt mới nhất trong source |14af124; chưa xác nhận production đang chạy SHA này |

`A_chat_excerpt.json` chỉ ghi đoạn lỗi người dùng đã dán:3 dòng RPC,2 dòng STOP_REQUIRED,1 dòng trạng thái ví; KHÔNG phải thống kê toàn phiên hoặc số lệnh lỗi duy nhất.

## B. Log quyết định

`B_decisions.jsonl` rỗng,0 dòng vì không có dữ liệu thật truy cập được; không tạo200-300 dòng giả. `B_schema.json` ghi các trường yêu cầu và lý do thiếu. Hệ thống lưu quyết định tóm tắt; context đầy đủ và output JSON thô không được lưu bền vững theo từng lần gọi. Nhiều dòng quyết định có thể phát sinh từ một batch/model call và từ polling, không đếm dòng thành số vòng inference.

## C. Kết quả khớp

`C_fills.csv` chỉ có header,không có bản ghi. Receipt lưu được SOL vào/ra,network fee,slot,lý do và PnL; quote/intent ở orders có thể nối bằng order ID nếu trích xuất production. Không mặc định có đủ giá khớp đơn vị hoặc decimals cho các vị thế đã đóng. Không trừ network fee lần hai nếu net SOL delta đã bao gồm phí. Pool fee không thấy bảng tách riêng; rent phải phân biệt với chi phí mất đi. MFE/MAE và latency khớp không có trường hoàn chỉnh trong fill archive. Drawdown LIVE đang trả null,không phải0.

Win rate nên tính theo vị thế đóng có PnL xác minh,không theo từng partial SELL. Lỗ/PnL trung bình cần nói rõ theo fill hay theo vị thế. PnL code không gồm chi phí API AI; disposal ngoài ví thiếu bằng chứng có thể làm tổng PnL không xác định.

## D. Ứng viên bỏ qua

Chưa có bộ nhãn horizon1/3/5/10/15/30 phút. CSV chỉ là khung dữ liệu. Research snapshot có giá lấy mẫu30s nhưng không bảo đảm phủ đủ thời gian/token; không phải ground truth mọi decision. Không tự bịa nhãn từ giá hiện tại.

## E. Dữ liệu và cách chọn ứng viên

Danh mục field: `E_fields.csv`. Sơ đồ lưu: `E_storage.json`; dung lượng production chưa đo được.

Discovery lấy DexScreener search(pumpswap,pump,solana),Solana profiles và GeckoTerminal new_pools; nhớ tối đa600mint,revisit30mint/vòng. Search discovery cache khoảng30s; token refresh mục tiêu5s; giá pool RPC mục tiêu1s. Đây là interval cộng thời gian tác vụ,backoff có thể làm chậm hơn.

Universe ưu tiên PumpSwap và giữ pool của vị thế đang mở. Bỏ SOL/stablecoin và dữ liệu giá không hợp lệ. Chọn tối đa60token mới có M5>0,xếp M5 giảm dần,rồi volume5m giảm dần,rồi mint; thêm token đang giữ để theo dõi. Đây VẪN là bộ lọc kỹ thuật trước AI,không phải AI được xem mọi token Solana. Radar giữ tối đa100token riêng.

Context chỉ nhận PumpSwap có giá>0,updatedAt/marketObservedAt không quá5s; xếp M5/volume; số candidates theo MODEL_MAX_CANDIDATES(default60,range1..100). Mặc định .env.example gợi ý8 nếu được copy vào runtime,không có bằng chứng Railway override. Batch bỏ mint đã có lệnh chờ,vốn còn lại trừ intent local; giới hạn decisions theo slot còn trống tối đa5.

M1 từ GeckoTerminal request35bars; context last16nến đóng,đỉnh/đáy30m chỉ khi đủ30nến hợp lệ. Enrich loop1s nhưng tối đa một candle job,một flow job; candle spacing2s,flow perpool>=3s. Mint facts từ RPC cache theo process. GMGN không phải nguồn đang dùng; holders/LP/RugCheck trong context hiện để null,không được coi đã kiểm chứng.

Research có pruning3ngày/32MiB mỗi root,giữ64MiB trống; quyết định/fill/error archive không thấy cơ chế xoay vòng cùng kiểu. Vì vậy không kết luận toàn bộ Volume đã bounded.

## F. Giới hạn hiện tại

Chi tiết `F_constraints.json`: số dư và maxOrderSol thực tế chưa đọc được. Công thức dùng số dư on-chain,trừ gas0.05SOL,đệm0.005SOL,lệnh chờ và lãi đã giữ chỗ; mỗi BUY<=90% số dư. Tối thiểu0.0025SOL/lệnh,tối đa5transaction intents đang xử lý và context tối đa100vị thế(có trừ số BUY chờ khi xét slot).

Không có khóa lỗ ngày/drawdown/chuỗi thua trong live aiOnly. Có API/RPC rate-limit/backoff. Circuit-breaker bookkeeping của worker không tương đương một daily-loss kill switch. Stop-loss do AI chọn; không dùng timer/TP chiến lược cũ. Chưa có shadow counterfactual chạy song song LIVE; có paper mode riêng,PaperResearch cũ đã disabled.

**Phát hiện ràng buộc đáng chú ý:** PumpSwap builder VẪN kiểm tra round-trip cost<=6%,giới hạn tỷ lệ reserve bình thường2%/emergency10%,và quyền mint/freeze. maxRoundTripLossPct=null trong context không xóa check6% ở executor. Slippage code builder bình thường bắt đầu150bps(1.5%);4%BUY/3%SELL/10%emergency là các cap/context,không phải luôn mức thực dùng hoặc slippage thực tế. Các giới hạn này được báo lại nguyên trạng,không sửa theo yêu cầu chỉ trích xuất.

## G. Prompt

`G_SYSTEM_current.txt` là prompt thật render từ hàm source cho live aiOnly,batch5slot. `G_prompts/` gồm các phiên bản lấy từ Git; `G_prompt_versions.json` có commit,time UTC/VN và hash. Thời điểm commit KHÔNG phải thời điểm bật production. Khả năng batch giảm số slot được nội suy bằng limits.maxBatchOrders. `G_API_verification_prompt.txt` là prompt kiểm tra kết nối,không phải giao dịch. USER message thật là JSON context động; không có context production để xuất nguyên văn.

## Thiếu gì và cách bổ sung

Xem `MISSING.txt`. Để tính A/C và lấy phần B còn giữ,cần bản xuất LIVE đã khử thông tin nhạy cảm từ Volume,giữ nguyên ID tham chiếu nội bộ hoặc giả danh nhất quán. Không gửi .env,key,vault,Telegram config,raw transaction,địa chỉ ví chủ/nhận lãi. Không gửi nguyên live-ledger chưa redaction vì có owner và signed transaction. Kể cả có sổ,full-context/raw-output lịch sử và nhãn chưa thu thập không thể khôi phục chính xác; cần instrument sau này,nằm ngoài phạm vi lần trích xuất này.
