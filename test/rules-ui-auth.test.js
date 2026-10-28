import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {OwnerAuth} from '../src/security.js';

test('rules UI mutations supply the authentication headers required by the server',async()=>{
 const source=await readFile(new URL('../public/rules.js',import.meta.url),'utf8');
 const helper=source.slice(source.indexOf('async function post('),source.indexOf('async function action('));
 const origin='https://desk.example',auth=new OwnerAuth({origin}),requests=[];
 const post=runInNewContext(helper+';post',{
  fetch:async(url,options)=>{
   requests.push({url,...options});
   const headers=Object.fromEntries(Object.entries(options.headers).map(([k,v])=>[k.toLowerCase(),v]));
   assert.equal(auth.sameOrigin({headers:{...headers,origin}}),true);
   assert.equal(auth.sameOrigin({headers:{...headers,origin:'https://attacker.invalid'}}),false);
   return {ok:true,json:async()=>({ok:true})};
  },
 });
 for(const [url,data] of [['/api/auth/challenge',{address:'fixture'}],['/api/auth/login',{nonce:'fixture'}],['/api/live/pause',{paused:true}],['/api/rules/ack',{fingerprint:'fixture'}],['/api/paper/telegram-test',{}]])await post(url,data);
 assert.equal(requests.length,5);
 for(const request of requests){assert.equal(request.method,'POST');assert.equal(request.credentials,'same-origin');assert.doesNotThrow(()=>JSON.parse(request.body));}
});
