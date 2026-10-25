import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Publish HTML, CSS and module dependencies as one content-addressed generation.
// Old hashed paths never fall back to a different generation's bytes.
export async function createPaperAssets(publicDir,{mode='paper'}={}){
 const files=[['paper.html','text/html'],['style.css','text/css'],['desk.css','text/css'],['paper.js','text/javascript'],['activity.js','text/javascript'],['paper-wallet.js','text/javascript']];
 const sources=new Map();for(const [name]of files){try{sources.set(name,await readFile(new URL(name,publicDir),'utf8'));}catch(e){if(name!=='paper-wallet.js'||e.code!=='ENOENT')throw e;sources.set(name,null);}}
 if(mode==='live'){
  let html=sources.get('paper.html');
  for(const [from,to]of [
   ['KADE · NYX · SAGE / 3 BOT AI / PAPER','KADE · NYX · SAGE / AI / SOL THẬT'],['PAPER · 3 BOT','LIVE · SOL THẬT'],['Tổng 3 ví mô phỏng','Số dư ví on-chain · AI dùng chung vốn'],['2,5% vốn · dự phòng 0,1 SOL','AI tự chọn số tiền · giữ 0,1 SOL gas'],['● PAPER ONLY','● LIVE · SOL THẬT'],['Tải sổ paper','Tải sổ LIVE'],['· khớp giả định','· xác nhận on-chain'],['SOL · phiên mô phỏng','SOL · ví thật'],['mô phỏng','tiền thật'],['Telegram paper','Telegram']
  ])html=html.replaceAll(from,to);
  html=html.replace(/<p id="wallet-help">.*?<\/p>/,'<p id="wallet-help">Kết nối Phantom/Solflare để ký thông điệp xác thực, sau đó mở két ký hiện có bằng mật khẩu. Khi mở két, 3 AI được tự động mua/bán bằng SOL thật. Khóa két để dừng ký; mỗi restart cần mở lại.</p>');
  html=html.replace(/<p class="panel-caption">Mỗi bot có ví riêng 2 SOL ban đầu\..*?<\/p>/,'<p class="panel-caption">KADE, NYX, SAGE dùng chung ví SOL thật, mỗi bot giữ ngữ cảnh và vị thế riêng. PnL dùng receipt và phí thực. MAX DD từng bot để trống vì không có vốn riêng cố định. Dưới 100 vị thế chưa xếp hạng hiệu quả.</p>');
  html=html.replace(/<section class="agent-team"([\s\S]*?)<p class="panel-caption">.*?<\/p>/,match=>match.replace(/<p class="panel-caption">.*?<\/p>/,'<p class="panel-caption">3 tiến trình AI độc lập, dùng chung nguồn thị trường và ví SOL. AI tự chọn BUY/SELL/HOLD và cỡ lệnh; bộ điều phối giữ chỗ vốn cho lệnh đang gửi.</p>'));
  const begin=html.indexOf('<dialog id="strategy-dialog"'),end=html.indexOf('<dialog id="source-dialog"',begin);
  html=html.slice(0,begin)+'<dialog id="strategy-dialog" class="dashboard-dialog"><div class="dialog-heading"><h2>KADE / NYX / SAGE · AI · SOL thật</h2><button data-close>✕</button></div><p>Mỗi bot có ngữ cảnh AI riêng. AI chọn BUY/SELL/HOLD, token, số SOL mua và tỷ lệ bán. Đọc số dư ví on-chain, không có vốn ảo 20 SOL, ví riêng 2 SOL hay cỡ lệnh cố định. Tối đa một vị thế/bot. KADE ưu tiên scalp M1; NYX ưu tiên hồi phục; SAGE ưu tiên chọn lọc.</p><p>Giữ 0,1 SOL gas và đệm phí/rent 0,005 SOL. Quote đúng cỡ lệnh và mới; slippage mua 4%, bán 3%, khẩn 10%; khứ hồi ≤6%, impact ≤2%. Stop bảo vệ KADE −7%, NYX −10%, SAGE −7% và giới hạn thời gian giữ vẫn chạy. Stop không đảm bảo mức lỗ tối đa khi giá sập hoặc không có thanh khoản.</p><p>Chỉ ghi nhận khớp khi xác nhận on-chain; không dùng haircut/fee mô phỏng. Tiền nạp/rút được hạch toán thành dòng vốn, không tính là lãi. Giới hạn lỗ ngày/chuỗi thua/drawdown vẫn tắt.</p><p>Đăng nhập ví chủ, mở két ký hiện có để chạy; mỗi restart bắt đầu khóa. Cần Volume lưu két và sổ lệnh. Telegram tổng kết từng bot lúc 23:59 Việt Nam. API lỗi sẽ WAIT, không tự đổi sang luật cũ. Không dùng khóa ví hoặc khóa API trong ngữ cảnh AI.</p></dialog>\n'+html.slice(end);
  sources.set('paper.html',html);
 }
 const digest=createHash('sha256');for(const [name,source]of sources)digest.update(name+'\0'+(source??'BUILD_REQUIRED')+'\0');
 const revision=digest.digest('hex').slice(0,20),prefix='/ui/'+revision+'/',assets=new Map();
 for(const [name,type]of files){let source=sources.get(name);if(source===null)continue;
  if(type==='text/javascript')source=source.replaceAll("from '/paper-wallet.js'",`from '${prefix}paper-wallet.js'`).replaceAll("from '/activity.js'",`from '${prefix}activity.js'`).replaceAll('__PAPER_UI_REVISION__',revision);
  if(type==='text/html'){source=source.replace('<html lang="vi">',`<html lang="vi" data-ui-revision="${revision}">`);for(const file of ['style.css','desk.css','paper.js'])source=source.replaceAll('"/'+file+'"','"'+prefix+file+'"');}
  const asset={type,content:source,revision};assets.set(prefix+name,asset);assets.set(name==='paper.html'?'/':'/'+name,asset);
 }
 return {revision,get:pathname=>assets.get(pathname)??null,isVersioned:pathname=>pathname.startsWith(prefix)};
}
