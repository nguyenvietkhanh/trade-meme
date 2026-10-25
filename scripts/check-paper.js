import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
for(const name of (await readdir(new URL('../src/',import.meta.url))).filter(n=>(n.startsWith('paper-')||n.startsWith('live-')||n==='decision-capital.js'||n==='control-errors.js'||n.startsWith('wallet-')||n.startsWith('automatic-'))&&n.endsWith('.js'))){const result=spawnSync(process.execPath,['--check','src/'+name],{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);}
