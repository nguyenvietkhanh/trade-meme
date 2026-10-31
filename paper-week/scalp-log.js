import {gzipSync} from 'node:zlib';
import {open,readdir,lstat,unlink} from 'node:fs/promises';
import path from 'node:path';
export const SCALP_LOG_NAME=/^scalp-\d{4}-\d{2}-\d{2}-\d{2}\.jsonl\.gz$/;
export class ScalpLog{
 constructor(dir,c){this.dir=dir;this.c=c;this.chain=Promise.resolve();this.used=0;this.blocked=false;this.files=new Set();}
 async init(){this.used=0;this.files=new Set();let files=[];for(const name of await readdir(this.dir))if(SCALP_LOG_NAME.test(name)){const stat=await lstat(path.join(this.dir,name));if(stat.isFile()&&!stat.isSymbolicLink())files.push({name,...stat});}for(const f of files){if(Date.now()-f.mtimeMs>this.c.logRetentionDays*86400000)await unlink(path.join(this.dir,f.name));else{this.used+=f.size;this.files.add(f.name);}}this.blocked=this.used>=this.c.logQuotaMiB*1048576;}
 append(rows){if(!rows.length)return Promise.resolve(true);const work=this.chain.then(async()=>{const data=gzipSync(Buffer.from(rows.map(r=>JSON.stringify({simulation:true,...r},(_key,value)=>value===undefined?null:value)).join('\n')+'\n'));if(this.used+data.length>this.c.logQuotaMiB*1048576){this.blocked=true;return false;}const stamp=new Date(rows[0].ts).toISOString().slice(0,13).replace('T','-'),file=path.join(this.dir,'scalp-'+stamp+'.jsonl.gz');const h=await open(file,'a',0o600);try{await h.writeFile(data);await h.sync();}finally{await h.close();}this.used+=data.length;this.files.add(path.basename(file));return true;});this.chain=work.catch(()=>{this.blocked=true;return false;});return this.chain;}
 status(){return {compressedJsonl:true,usedBytes:this.used,quotaBytes:this.c.logQuotaMiB*1048576,entryBlocked:this.blocked,files:[...this.files].sort()};}
}
