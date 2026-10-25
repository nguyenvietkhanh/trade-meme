import {spawn} from 'node:child_process';
import {readdir} from 'node:fs/promises';
const offline=process.argv.includes('--offline'),httpFiles=new Set(['perps-transition-http.test.js','live-http.test.js','owner-http.test.js','paper-http.test.js','public.test.js','roundtrip.test.js','scanner.test.js','server.test.js']);
const all=(await readdir(new URL('../test/',import.meta.url))).filter(n=>n.endsWith('.test.js')).sort(),files=all.filter(n=>!offline||!httpFiles.has(n));
let failures=0;
for(const name of files){
 console.log('RUN '+name);
 await new Promise(resolve=>{
  const child=spawn(process.execPath,['test/'+name],{cwd:new URL('../',import.meta.url),stdio:'inherit'});let failed=false;
  const timer=setTimeout(()=>{failed=true;child.kill('SIGTERM');},120000);
  child.on('error',error=>{failed=true;console.error('Test process error',name,error.message);});
  child.on('exit',code=>{clearTimeout(timer);if(code!==0||failed){failures++;console.error('FAIL '+name);}else console.log('PASS '+name);resolve();});
 });
}
console.log(JSON.stringify({files:files.length,failedFiles:failures,notRun:offline?all.filter(n=>httpFiles.has(n)):[],offline}));if(failures)process.exitCode=1;
