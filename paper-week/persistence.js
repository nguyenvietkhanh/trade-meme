import {open,rename} from 'node:fs/promises';
import path from 'node:path';

// Sync the file on every platform before atomic replacement. Windows does not
// support opening/fsyncing a directory through Node; only that last step differs.
export async function writePaperFile(file,data,{platform=process.platform,io={open,rename}}={}){
 const temp=file+'.tmp',handle=await io.open(temp,'w',0o600);
 try{await handle.writeFile(typeof data==='string'?data:JSON.stringify(data,null,2));await handle.sync();}finally{await handle.close();}
 await io.rename(temp,file);
 if(platform==='win32')return;
 const directory=await io.open(path.dirname(file),'r');
 try{await directory.sync();}finally{await directory.close();}
}
