import bs58 from 'bs58';
export async function authenticate(post){
 const provider=window.solflare?.isSolflare?window.solflare:window.phantom?.solana??window.solana;
 if(!provider?.connect||!provider?.signMessage)throw Error('Mở trang trong ví Solflare/Phantom. Chỉ cần ký thông điệp.');
 await provider.connect();const address=provider.publicKey.toBase58(),challenge=await post('/api/auth/challenge',{address});
 const result=await provider.signMessage(new TextEncoder().encode(challenge.message),'utf8');
 return post('/api/auth/login',{nonce:challenge.nonce,signature:bs58.encode(result.signature??result)});
}
