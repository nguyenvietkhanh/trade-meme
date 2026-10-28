import {createHash} from 'node:crypto';
const forbidden=/private.?key|secret|api.?key|authorization|signed.?tx|transaction|ciphertext|seed.?phrase|rawAccount|unsignedTransaction/i;
export function redactor(salt='',addresses=[]){
 const blocked=new Set(addresses.filter(Boolean));
 const hash=value=>'sha256:'+createHash('sha256').update(salt+'\0'+String(value)).digest('hex');
 return function clean(value,knownMints=[]){
  const publicIds=new Set(knownMints);
  const text=s=>{
   s=s.replace(/(?<!sha256:)\b(?:0x)?(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{64})\b/g,'[REDACTED_HEX_SECRET]');
   s=s.replace(/[A-Za-z0-9+/]{120,}={0,2}/g,'[REDACTED_ENCODED_BYTES]');
   s=s.replace(/(?:Bearer\s+)[^\s"\\]+/gi,'[REDACTED_AUTH]');
   for(const address of blocked)s=s.split(address).join(hash(address));
   s=s.replace(/\b[1-9A-HJ-NP-Za-km-z]{80,90}\b/g,hash);
   s=s.replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g,x=>publicIds.has(x)||x.startsWith('sha256')?x:hash(x));
   s=s.replace(/((?:private[_ -]?key|api[_ -]?key|secret|seed[_ -]?phrase)["']?\s*[:=]\s*)[^,}\n]+/gi,'$1"[REDACTED]"');
   return s;
  };
  const walk=(v,key='',depth=0)=>{
   if(depth>30)return null;if(forbidden.test(key))return '[REDACTED]';
   if(typeof v==='string'){
    if(/signature|owner|recipient|walletAddress/i.test(key))return /^sha256:[a-f0-9]{64}$/.test(v)?v:hash(v);
    if(/(?:^mint$|Mint$|^pool$|^pairAddress$)/.test(key)&&!blocked.has(v))publicIds.add(v);
    if(/(?:Sha256|Hash)$/.test(key)&&/^[a-f0-9]{64}$/.test(v))return v;
    return text(v);
   }
   if(Array.isArray(v))return v.map(x=>walk(x,'',depth+1));
   if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,walk(x,k,depth+1)]));
   return typeof v==='bigint'?v.toString():v;
  };
  return walk(value);
 };
}
export function errorCategory(e={},provider=''){
 const code=String(e.code??''),s=provider+' '+code+' '+String(e.message??'');
 if(code==='LIVE_AI_STOP_REQUIRED')return 'STOP_REQUIRED';
 if(code==='LIVE_WALLET_NOT_CONNECTED')return 'WALLET_NOT_CONNECTED';
 if(/SIGNER/.test(code))return 'SIGNER_UNAVAILABLE';
 if(/MODEL.*429/.test(s))return 'MODEL_429';
 if(/Jupiter/i.test(s)&&/429/.test(s))return 'JUPITER_429';
 if(/RPC|HTTP_429/.test(s))return 'RPC';
 if(/revert|REVERT|RECEIPT_FAILED/i.test(s))return 'REVERT';
 if(/MARKET_STALE/.test(s))return 'MARKET_STALE';
 if(/stale|STALE|quote.*cũ/i.test(s))return 'QUOTE_STALE';
 if(/quote|Jupiter|PREPARE_FAILED/i.test(s))return 'QUOTE_ERROR';
 return 'OTHER';
}
