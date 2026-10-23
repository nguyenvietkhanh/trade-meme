import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPaperAssets} from '../src/paper-assets.js';

test('HTML and every module dependency use one content generation; a changed stylesheet cannot mix with cached old JavaScript',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'paper-assets-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const fixtures={'paper.html':'<html lang="vi"><link href="/style.css"><link href="/desk.css"><script src="/paper.js"></script></html>','style.css':'body{margin:0}','desk.css':'.agent-card{padding:20px}','paper.js':"import {authenticate} from '/paper-wallet.js'; import {syncActivity} from '/activity.js'; const revision='__PAPER_UI_REVISION__';",'activity.js':'export const syncActivity=()=>{};','paper-wallet.js':'export const authenticate=()=>{};'};
 for(const [name,source]of Object.entries(fixtures))await writeFile(path.join(dir,name),source);
 const first=await createPaperAssets(pathToFileURL(dir+'/')),prefix='/ui/'+first.revision+'/';
 assert.match(first.get('/').content,new RegExp('data-ui-revision="'+first.revision+'"'));for(const file of ['style.css','desk.css','paper.js'])assert.ok(first.get('/').content.includes(prefix+file));
 assert.ok(first.get(prefix+'paper.js').content.includes(prefix+'paper-wallet.js'));assert.ok(first.get(prefix+'paper.js').content.includes(prefix+'activity.js'));assert.ok(!first.get(prefix+'paper.js').content.includes('__PAPER_UI_REVISION__'));assert.equal(first.get(prefix+'../paper.js'),null);
 await writeFile(path.join(dir,'desk.css'),'.agent-card{padding:28px}');const second=await createPaperAssets(pathToFileURL(dir+'/'));assert.notEqual(second.revision,first.revision);assert.equal(second.get(prefix+'paper.js'),null,'never serve new JS at the old content-addressed URL');assert.equal(first.get(prefix+'desk.css').content,fixtures['desk.css'],'old generation stays immutable in memory');assert.equal(first.get('/paper.js').revision,first.revision);
});
