import path from 'node:path';
import {mkdir,lstat,chown,chmod} from 'node:fs/promises';
// Provision only this experiment's subdirectory, then drop privileges. No LIVE path.
if(process.env.RAILWAY_VOLUME_MOUNT_PATH){const dir=path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH,'paper-week');await mkdir(dir,{recursive:true,mode:0o700});const s=await lstat(dir);if(!s.isDirectory()||s.isSymbolicLink())throw Error('PAPER_STORAGE_UNSAFE');if(process.getuid?.()===0){await chown(dir,1000,1000);await chmod(dir,0o700);process.setgroups([]);process.setgid(1000);process.setuid(1000);}}
await import('./server.js');
