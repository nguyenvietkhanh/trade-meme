import {PublicKey} from '@solana/web3.js';

// Phantom returns {publicKey}; Solflare may return void/boolean and set its own publicKey.
export function connectedWalletAddress(wallet,result){
 const key=result?.publicKey??wallet?.publicKey;
 try{
  if(key==null)throw Error('missing key');
  const address=typeof key==='string'?key:typeof key.toBase58==='function'?key.toBase58():typeof key.toString==='function'?key.toString():null;
  if(typeof address!=='string')throw Error('invalid key');
  return new PublicKey(address).toBase58();
 }catch{throw Error('Ví chưa trả về địa chỉ Solana hợp lệ. Mở khóa ví rồi kết nối lại.');}
}
