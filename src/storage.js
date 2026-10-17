import path from 'node:path';
import {mkdir,readdir,lstat,chown,chmod} from 'node:fs/promises';
export async function initializeStorage(root){
 const volume=process.env.RAILWAY_VOLUME_MOUNT_PATH;
 const dir=volume?path.join(volume,'meme-pilot'):process.env.DATA_DIR??path.join(root,'.data');
 await mkdir(dir,{recursive:true,mode:0o700});
 // Docker starts only this bootstrap as root to provision the mounted volume.
 // The HTTP server and wallet signer then run as the unprivileged node user.
 if(process.env.DROP_TO_NODE==='true'&&process.getuid?.()===0){
  await chown(dir,1000,1000);await chmod(dir,0o700);
  for(const name of await readdir(dir)){const file=path.join(dir,name),stat=await lstat(file);if(stat.isSymbolicLink())throw Error('Refusing symlink in wallet storage');if(stat.isFile()){await chown(file,1000,1000);await chmod(file,0o600);}}
  process.setgroups([]);process.setgid(1000);process.setuid(1000);
 }
 return dir;
}
