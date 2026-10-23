import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Publish HTML, CSS and module dependencies as one content-addressed generation.
// Old hashed paths never fall back to a different generation's bytes.
export async function createPaperAssets(publicDir){
 const files=[['paper.html','text/html'],['style.css','text/css'],['desk.css','text/css'],['paper.js','text/javascript'],['activity.js','text/javascript'],['paper-wallet.js','text/javascript']];
 const sources=new Map();for(const [name]of files){try{sources.set(name,await readFile(new URL(name,publicDir),'utf8'));}catch(e){if(name!=='paper-wallet.js'||e.code!=='ENOENT')throw e;sources.set(name,null);}}
 const digest=createHash('sha256');for(const [name,source]of sources)digest.update(name+'\0'+(source??'BUILD_REQUIRED')+'\0');
 const revision=digest.digest('hex').slice(0,20),prefix='/ui/'+revision+'/',assets=new Map();
 for(const [name,type]of files){let source=sources.get(name);if(source===null)continue;
  if(type==='text/javascript')source=source.replaceAll("from '/paper-wallet.js'",`from '${prefix}paper-wallet.js'`).replaceAll("from '/activity.js'",`from '${prefix}activity.js'`).replaceAll('__PAPER_UI_REVISION__',revision);
  if(type==='text/html'){source=source.replace('<html lang="vi">',`<html lang="vi" data-ui-revision="${revision}">`);for(const file of ['style.css','desk.css','paper.js'])source=source.replaceAll('"/'+file+'"','"'+prefix+file+'"');}
  const asset={type,content:source,revision};assets.set(prefix+name,asset);assets.set(name==='paper.html'?'/':'/'+name,asset);
 }
 return {revision,get:pathname=>assets.get(pathname)??null,isVersioned:pathname=>pathname.startsWith(prefix)};
}
