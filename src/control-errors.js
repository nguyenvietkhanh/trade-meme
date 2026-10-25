// Only public, allowlisted reasons may cross the HTTP boundary. Never echo RPC,
// filesystem paths, request bodies, passwords or arbitrary exception messages.
const reasons=Object.freeze({
 LIVE_SIGNER_LOCKED:[409,'Kết nối và xác thực ví chủ trước khi tiếp tục giao dịch. Không cần mật khẩu.','connect-wallet'],
 LIVE_WALLET_NOT_CONNECTED:[409,'Kết nối và ký thông điệp xác thực ví chủ trước khi tiếp tục; ví chủ ký từng giao dịch. Không cần mật khẩu.','connect-wallet'],
 LIVE_WALLET_SIGNATURE_INVALID:[400,'Chữ ký giao dịch không hợp lệ hoặc không thuộc ví chủ. Không gửi giao dịch.'],
 LIVE_CAPITAL_CHANGED:[409,'Số dư ví thay đổi, không còn đủ số SOL khả dụng cho lệnh này. Bot sẽ đánh giá lại cỡ lệnh.'],
 LIVE_LEGACY_PENDING_REQUIRES_RECONCILIATION:[409,'Còn giao dịch thật cũ chưa đối soát; cần xác định kết quả trước khi nhận lệnh mới.'],
 LIVE_WALLET_ORDER_NOT_FOUND:[404,'Lệnh AI không còn tồn tại; tải lại danh sách lệnh chờ ký.'],
 LIVE_WALLET_ORDER_EXPIRED:[409,'Quote hoặc lệnh AI đã hết hạn. Bot sẽ đánh giá lại với dữ liệu mới.'],
 LIVE_WALLET_TRANSACTION_CHANGED:[409,'Giao dịch ví ký không khớp đúng lệnh AI đã chuẩn bị; không gửi lên mạng.'],
 LIVE_WALLET_ALREADY_SUBMITTED:[409,'Lệnh đã gửi lên Solana; không thể hủy bằng nút này. Đang đối soát chữ ký cũ.'],
 LIVE_BUY_NOT_ADMITTED:[409,'BUY đã dừng hoặc trạng thái vốn thay đổi. Không gửi lệnh mua này.'],
 LIVE_PERSISTENT_VOLUME_REQUIRED:[409,'Cần gắn Railway Volume để lưu sổ lệnh SOL thật qua restart; không cần mật khẩu.','open-wallet'],
 MODEL_NOT_CONFIGURED:[503,'Chưa có cấu hình AI hợp lệ trên máy chủ; kiểm tra MODEL_API_KEY trong Railway Variables.'],
 INVALID_PAUSE_REQUEST:[400,'Dữ liệu điều khiển không hợp lệ: paused phải là true (dừng BUY) hoặc false (tiếp tục BUY).'],
 RATE_LIMITED:[429,'Bạn thao tác quá nhanh. Chờ hết thời gian giới hạn rồi thử lại.'],
 EACCES:[503,'Máy chủ không ghi được sổ điều khiển. Kiểm tra quyền ghi của Volume.'],
 EROFS:[503,'Volume đang chỉ đọc; chưa lưu được trạng thái điều khiển.'],
 ENOSPC:[503,'Ổ lưu trữ đã đầy; chưa lưu được trạng thái điều khiển.']
});
export function controlError(error){
 const known=Object.hasOwn(reasons,error?.code);
 const [status,message,nextAction]=(known?reasons[error.code]:null)??[503,'Máy chủ chưa xử lý được thao tác điều khiển. Thử lại và kiểm tra nhật ký dịch vụ.'];
 const code=known?error.code:'CONTROL_FAILED';
 const retryAfterSeconds=code==='RATE_LIMITED'&&Number.isFinite(error.retryAfterSeconds)?Math.max(1,Math.min(60,Math.ceil(error.retryAfterSeconds))):undefined;
 return {status,body:{error:message,code,...(nextAction?{nextAction}:{}),...(retryAfterSeconds?{retryAfterSeconds}:{})}};
}
export function pausedValue(input){if(!input||typeof input.paused!=='boolean')throw Object.assign(Error('INVALID_PAUSE_REQUEST'),{code:'INVALID_PAUSE_REQUEST'});return input.paused;}
