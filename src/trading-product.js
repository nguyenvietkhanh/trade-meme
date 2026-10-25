// A selected product is not proof that its market, account or signer works.
// Solflare's extension route cannot serve as a Railway execution endpoint.
export function tradingProduct(env=process.env){
 const id=env.TRADING_PRODUCT??'solana-spot';
 if(!['solana-spot','solflare-perps','solana-perps'].includes(id))throw Object.assign(Error('UNSUPPORTED_TRADING_PRODUCT'),{code:'UNSUPPORTED_TRADING_PRODUCT'});
 if(id==='solana-spot')return {id,label:'Solana spot',spotEntriesAllowed:true,perpsEnabled:false,status:'spot-active'};
 if(id==='solana-perps')return {id,label:'Solana Perps · Drift',venue:'Drift',spotEntriesAllowed:false,perpsEnabled:false,status:'venue-verification-required',underlyingVenue:'Drift',signingVerified:false,collateralVerified:false,message:'Đã chọn perps trên Solana qua Drift. BUY meme mới đã khóa; vẫn quản lý các vị thế spot cũ. Chưa bật LONG/SHORT khi chưa xác minh tài khoản ký quỹ, quote, đòn bẩy và stop-loss của sàn.'};
 return {id,label:'Solflare Perps',spotEntriesAllowed:false,perpsEnabled:false,status:'api-verification-required',underlyingVenue:null,signingVerified:false,collateralVerified:false,message:'Đã chọn Solflare Perps. Chưa xác minh API, tài khoản ký quỹ và quyền ký LONG/SHORT. Không nhận BUY meme mới; vẫn quản lý các vị thế spot cũ.'};
}
