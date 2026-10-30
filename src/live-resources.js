import path from 'node:path';
import {lstat,readdir,unlink} from 'node:fs/promises';

// Optional observation is separate from the evidence required to authorize trades.
export function liveResources(live,env=process.env){
 const research=!live||env.LIVE_RESEARCH_ENABLED==='true';
 return {mode:research?'research':'lean',research,observer:live&&research,dataset:live&&research};
}

// Only known disposable files in fixed subdirectories are eligible. No recursive
// rm, financial files, configurable external paths or symlinks are followed.
export async function cleanDisabledResearch(roots){
 const result={files:0,bytes:0,errors:0};
 async function regularDir(dir){try{const s=await lstat(dir);return s.isDirectory()&&!s.isSymbolicLink();}catch(e){if(e.code!=='ENOENT')result.errors++;return false;}}
 async function remove(file){try{const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink())return;await unlink(file);result.files++;result.bytes+=s.size;}catch(e){if(e.code!=='ENOENT')result.errors++;}}
 async function archives(root,pattern){if(!await regularDir(root))return;for(const day of await readdir(root)){if(!/^\d{4}-\d{2}-\d{2}$/.test(day))continue;const dir=path.join(root,day);if(!await regularDir(dir))continue;for(const name of await readdir(dir))if(pattern.test(name))await remove(path.join(dir,name));}}
 for(const root of new Set(roots))try{
  if(!await regularDir(root))continue;
  const research=path.join(root,'research');if(await regularDir(research))await archives(path.join(research,'journal'),/^\d{2}-[a-f0-9]{16}\.jsonl\.gz$/);
  await archives(path.join(root,'dataset'),/^(model_calls|candidate_snapshots|forward_labels|fills_enriched|executor_results|errors)-[a-f0-9]{16}-\d+\.jsonl\.gz$/);
  const candidates=path.join(root,'candidate-observer');if(await regularDir(candidates))for(const name of ['candidates.sqlite','candidates.sqlite-journal','candidates.sqlite-wal','candidates.sqlite-shm'])await remove(path.join(candidates,name));
  for(const name of ['dormant-state.json','dormant-state.json.tmp'])await remove(path.join(root,name));
 }catch{result.errors++;}
 return result;
}
