import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export async function createRulesAssets(dir,{product='solana-spot'}={}){
 const files=[['rules.html','text/html'],['rules.css','text/css'],['rules.js','text/javascript'],['paper-wallet.js','text/javascript']],sources=new Map();
 for(const [name]of files){try{sources.set(name,await readFile(new URL(name,dir),'utf8'));}catch(e){if(name!=='paper-wallet.js')throw e;throw Error('Run npm run build before serving wallet authentication');}}
 if(product!=='solana-spot')sources.set('rules.html',sources.get('rules.html').replace('<section class="hero"',`<p class="product-notice">${product==='solana-perps'?'SOLANA PERPS · DRIFT':'SOLFLARE PERPS'} · CHƯA BẬT LỆNH. Số dư này chưa phải tài khoản ký quỹ Perps. Đặt TRADING_PRODUCT=solana-spot để dùng quy tắc meme; các vị thế spot cũ vẫn được giữ.</p><section class="hero"`));
 const hash=createHash('sha256');for(const [name,s]of sources)hash.update(name+'\0'+s);const revision=hash.digest('hex').slice(0,20),prefix='/ui/'+revision+'/',assets=new Map();
 for(const [name,type]of files){let content=sources.get(name);for(const dep of ['rules.css','rules.js','paper-wallet.js'])content=content.replaceAll('/'+dep,prefix+dep);if(type==='text/html')content=content.replace('<html lang="vi">',`<html lang="vi" data-ui-revision="${revision}">`);const row={content,type,revision};assets.set(prefix+name,row);assets.set(name==='rules.html'?'/':'/'+name,row);}
 return {revision,get:p=>assets.get(p)??null,isVersioned:p=>p.startsWith(prefix)};
}
