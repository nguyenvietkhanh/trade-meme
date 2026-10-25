import bs58 from 'bs58';
import {VersionedTransaction} from '@solana/web3.js';
import {connectedWalletAddress} from './wallet-provider.js';
function provider(){const p=window.solflare?.isSolflare?window.solflare:window.phantom?.solana??window.solana;if(!p?.connect||!p.signMessage)throw Error('Mở trang trong ví Solflare/Phantom để kết nối và ký thông điệp xác thực.');return p;}
export async function authenticate(post){const p=provider(),result=await p.connect(),address=connectedWalletAddress(p,result),challenge=await post('/api/auth/challenge',{address});const signed=await p.signMessage(new TextEncoder().encode(challenge.message),'utf8');return post('/api/auth/login',{nonce:challenge.nonce,signature:bs58.encode(signed.signature??signed)});}
export async function signWalletOrder(post,order,owner){
 const p=provider(),result=await p.connect(),address=connectedWalletAddress(p,result);if(address!==owner||order.owner!==owner)throw Error('Ví đang kết nối không phải ví chủ của lệnh AI.');if(!p.signTransaction)throw Error('Ví chưa hỗ trợ ký giao dịch Solana.');
 const bytes=Uint8Array.from(atob(order.transaction),c=>c.charCodeAt(0)),tx=VersionedTransaction.deserialize(bytes),message=tx.message.serialize();if(tx.message.header.numRequiredSignatures!==1||tx.message.staticAccountKeys[0].toBase58()!==owner)throw Error('Giao dịch không khớp ví chủ.');
 // signTransaction only signs. Broadcasting happens once through the treasury's
 // durable intent journal after server verification of the exact same message.
 const signed=await p.signTransaction(tx),after=signed.message.serialize();if(message.length!==after.length||message.some((v,i)=>v!==after[i]))throw Error('Ví trả về nội dung giao dịch khác lệnh AI.');
 const transaction=btoa(String.fromCharCode(...signed.serialize()));return post('/api/live/wallet-submit',{id:order.id,transaction});
}
