// Execution metadata and real round-trip quotes only. No RugCheck/holder/LP calls.
export class LabExecutionFeed{
 constructor(market,{rankMarket,canInspectCandidate=()=>true}={}){this.market=market;this.rank=rankMarket;this.canInspectCandidate=canInspectCandidate;this.cache=new Map();this.jobs=new Map();}
 applyCached(markets){return markets.map(m=>{const cached=this.cache.get(m.mint+':'+m.pairAddress);return cached?{...m,...cached.value}:{...m};});}
 async enrichCached(markets,_held=[],now=Date.now()){
  const targets=markets.filter(m=>this.canInspectCandidate(m)&&this.rank(m,undefined,now).preQuoteEligible).sort((a,b)=>(this.cache.get(a.mint+':'+a.pairAddress)?.at??0)-(this.cache.get(b.mint+':'+b.pairAddress)?.at??0));
  for(const m of targets){if(this.jobs.size>=2)break;const key=m.mint+':'+m.pairAddress,c=this.cache.get(key),age=now-(c?.at??0),sameSize=c?.value.evidence?.probeSol===this.market.currentProbeSol;if(this.jobs.has(key)||c&&age>=0&&age<(c.value.verificationError?5000:8000)&&sameSize&&(c.value.verificationError||now-c.value.evidence.quoteCheckedAt<8000))continue;
   const job=Promise.resolve().then(()=>this.market.inspectLabExecution(m)).then(e=>{if(e.certificationMode!=='bypassed-paper'||e.mint!==m.mint||e.pairAddress!==m.pairAddress)throw Error('lab metadata mismatch');this.cache.set(key,{at:Date.now(),value:{evidence:e,verificationError:null}});}).catch(()=>this.cache.set(key,{at:Date.now(),value:{evidence:{certificationMode:'bypassed-paper'},verificationError:'LAB: chưa lấy được quote thật hoặc decimals; chưa khớp BUY.'}})).finally(()=>this.jobs.delete(key));this.jobs.set(key,job);
  }
  for(const [key,c] of this.cache)if(now-c.at>300000)this.cache.delete(key);return this.applyCached(markets);
 }
}
