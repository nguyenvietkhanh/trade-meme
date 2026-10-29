import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
test('patched TOML parser remains compatible with Anchor Buffer configuration reads',async()=>{
 assert.equal(require('toml/package.json').version,'5.0.1');const input=Buffer.from('[provider]\ncluster="mainnet"\n[programs.mainnet]\nexample="test"\n[[test.validator.account]]\naddress="a"\nfilename="a.json"\n');const result=require('toml').parse(input);assert.equal(result.provider.cluster,'mainnet');assert.equal(result.programs.mainnet.example,'test');assert.equal(result.test.validator.account[0].filename,'a.json');
 const lock=JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url),'utf8'));for(const [name,pkg]of Object.entries(lock.packages))if(name.endsWith('/toml'))assert.equal(pkg.version,'5.0.1');
});
