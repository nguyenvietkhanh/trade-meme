import {open,rename} from 'node:fs/promises';
import path from 'node:path';
export async function writeDurable(file,data,{exclusive=false}={}){
 const temp=file+'.tmp',handle=await open(temp,exclusive?'wx':'w',0o600);
 try{await handle.writeFile(typeof data==='string'?data:JSON.stringify(data,null,2));await handle.sync();}finally{await handle.close();}
 await rename(temp,file);
 const directory=await open(path.dirname(file),'r');try{await directory.sync();}finally{await directory.close();}
}
