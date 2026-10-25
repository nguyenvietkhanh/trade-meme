import {readFile} from 'node:fs/promises';
const doc=JSON.parse(await readFile(process.argv[2],'utf8')),duration=doc.to-doc.from;
const valid=doc.mode==='paper'&&Array.isArray(doc.pairs)&&doc.pairs.length===45,knownPairs=valid?doc.pairs.filter(p=>p.jaccard!==null):[],jupiter=doc.provider?.jupiter;
console.log(JSON.stringify({valid,durationHours:duration/3600000,complete48Hours:duration>=48*3600000,jaccardTargetMet:knownPairs.length===45?knownPairs.every(p=>p.jaccard<=.25):null,http429TargetMet:jupiter?.requests>0?jupiter.http429/jupiter.requests<.01:null,insufficientPairs:45-knownPairs.length,caution:'A 24h daily report is not a 48h soak. Rates cover only the documented provider/process interval; unknown metrics never pass acceptance.'},null,2));
