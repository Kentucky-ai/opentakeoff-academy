import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const script=await readFile(new URL('../site/app.js',import.meta.url),'utf8');
async function openCertificate(path){
 const location=new URL(path,'https://union.kentucky-ai.com');
 const root={innerHTML:''},requests=[];
 const document={readyState:'complete',body:{getAttribute:()=> 'cert'},querySelector:()=>null,getElementById:id=>id==='cert-root'?root:null};
 const fetch=async path=>{requests.push(new URL(path,location.origin+'/').pathname);return path.includes('leaderboard')?{ok:true,json:async()=>({rows:[]})}:{ok:false};};
 vm.runInNewContext(script,{document,location,fetch,URL,window:{}});
 await new Promise(resolve=>setImmediate(resolve));
 return {html:root.innerHTML,requests};
}
test('old query links and shareable paths load the same credential record',async()=>{
 for(const path of ['/cert.html?id=OTA-D9A-0047','/cert/OTA-D9A-0047','/cert/OTA-D9A-0047/']){
  const r=await openCertificate(path);
  assert.deepEqual(r.requests,['/leaderboard.json','/certs/OTA-D9A-0047.json']);
  assert.match(r.html,/No credential with this id is on file/);
  assert.match(r.html,/OTA-D9A-0047/);
 }
});
test('malformed and traversal IDs stay invalid without credential requests',async()=>{
 for(const path of ['/cert.html?id=%E0%A4%A','/cert/%2E%2E%2Fprivate','/cert.html?id=%3Cscript%3E']){
  const r=await openCertificate(path);
  assert.deepEqual(r.requests,['/leaderboard.json']);
  assert.match(r.html,/not a valid OpenTakeoff Academy id/);
  assert.doesNotMatch(r.html,/<script>/);
 }
});
test('opening the verifier without an ID does not invent a record',async()=>{
 const r=await openCertificate('/cert.html');
 assert.equal(r.html,'');assert.deepEqual(r.requests,['/leaderboard.json']);
});
