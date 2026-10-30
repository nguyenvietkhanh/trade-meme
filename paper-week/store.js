import path from 'node:path';
import {mkdir,open,readdir,lstat,unlink,readFile} from 'node:fs/promises';
import {writePaperFile as writeDurable} from './persistence.js';
import {paperReportEnd,nextPaperReportEnd} from '../src/paper-schedule.js';
export const dayFor=at=>new Date(nextPaperReportEnd(paperReportEnd(at))+7*3600000).toISOString().slice(0,10);
const NAME=/^(training|report)-\d{4}-\d{2}-\d{2}\.txt$/;
export class PaperStore{
 constructor(dir,{maxBytes=32*1048576,maxFileBytes=2*1048576,retentionDays=9,clock=Date.now}={}){Object.assign(this,{dir,maxBytes,maxFileBytes,retentionDays,clock});this.chain=Promise.resolve();this.dropped=0;this.error=null;this.usedBytes=0;}
 async load(){await mkdir(this.dir,{recursive:true,mode:0o700});const s=await lstat(this.dir);if(!s.isDirectory()||s.isSymbolicLink())throw Error('PAPER_STORAGE_UNSAFE');await this.clean();try{const file=path.join(this.dir,'paper-week-state.json'),s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>2*1048576)throw Error('PAPER_STATE_TOO_LARGE');return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 save(state){return writeDurable(path.join(this.dir,'paper-week-state.json'),state);}
 async clean(){const files=[];for(const name of await readdir(this.dir)){if(!NAME.test(name))continue;const file=path.join(this.dir,name),s=await lstat(file);if(s.isFile()&&!s.isSymbolicLink())files.push({file,size:s.size,at:s.mtimeMs});}files.sort((a,b)=>a.at-b.at);let used=files.reduce((n,f)=>n+f.size,0);for(const f of files)if(used>this.maxBytes||f.at<this.clock()-this.retentionDays*86400000){await unlink(f.file);used-=f.size;}this.usedBytes=used;}
 record(row){const task=this.chain.then(async()=>{const line=JSON.stringify({schemaVersion:1,simulation:true,...row})+'\n';const file=path.join(this.dir,'training-'+dayFor(row.at??this.clock())+'.txt');let size=0;try{const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink())throw Error('PAPER_LOG_UNSAFE');size=s.size;}catch(e){if(e.code!=='ENOENT')throw e;}const bytes=Buffer.byteLength(line);if(size+bytes>this.maxFileBytes||this.usedBytes+bytes>this.maxBytes){this.dropped++;return false;}const h=await open(file,'a',0o600);try{await h.writeFile(line);await h.sync();}finally{await h.close();}this.usedBytes+=bytes;return true;}).catch(()=>{this.dropped++;this.error='TRAINING_STORAGE_UNAVAILABLE';return false;});this.chain=task;return task;}
 async training(day){if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('INVALID_DAY');await this.chain;const file=path.join(this.dir,'training-'+day+'.txt');try{const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>this.maxFileBytes)throw Error('PAPER_EXPORT_UNSAFE');return await readFile(file,'utf8');}catch(e){if(e.code==='ENOENT')return '';throw e;}}
 async document(name){if(!NAME.test(name))throw Error('INVALID_DOCUMENT');const file=path.join(this.dir,name),s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>8*1048576)throw Error('PAPER_EXPORT_UNSAFE');return readFile(file);}
 async report(day,text){if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||Buffer.byteLength(text)>6*1048576)throw Error('REPORT_TOO_LARGE');await writeDurable(path.join(this.dir,'report-'+day+'.txt'),text);await this.clean();}
 status(){return {usedBytes:this.usedBytes,maxBytes:this.maxBytes,dropped:this.dropped,error:this.error,retentionDays:this.retentionDays};}
}
