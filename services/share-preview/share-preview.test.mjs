import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createSharePreview,socialHtml} from './share-preview.mjs';
const baseIndex='<!doctype html><head><meta property="og:image" content="old.jpg"></head><body>RINLU works</body>';
const origin='https://rinlu.com';
const image=Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000','hex');
function storage(){
 const m=new Map();
 return {async put(key,b,type){m.set(key,{body:Buffer.from(b),type});},async get(key){
  const v=m.get(key);return v?new Response(v.body,{headers:{'Content-Type':v.type}}):null;
 }};
}
test('empty by default, administrator authorization, upload, crawler metadata and removal',async()=>{
 const s3=storage(),handle=createSharePreview({s3,backendOrigin:'https://canonical.example',publicOrigin:origin,
  accountBearer:req=>req.headers.authorization||null,getIndex:async()=>baseIndex,
  transport:async(_url,opts)=>new Response(JSON.stringify({user:{role:opts.headers.authorization==='Bearer admin'?'admin':'fan',status:'active'}}))});
 const server=http.createServer(async(req,res)=>{if(!(await handle(req,res))){res.writeHead(404);res.end();}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const url='http://127.0.0.1:'+server.address().port;
 const get=(path,opts)=>fetch(url+path,opts);
 try{
  let r=await get('/music/admin/share-image',{redirect:'manual'});
  assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/music/admin/site-fonts');
  r=await get('/music/');assert.equal(r.status,200);assert.doesNotMatch(await r.text(),/og:image/);
  r=await get('/music/api/admin/share-image');assert.equal(r.status,401);
  r=await get('/music/api/admin/share-image',{headers:{Authorization:'Bearer fan'}});assert.equal(r.status,403);
  r=await get('/music/api/admin/share-image',{headers:{Authorization:'Bearer admin'}});
  assert.equal((await r.json()).enabled,false);
  r=await get('/music/api/admin/share-image',{method:'POST',headers:{Authorization:'Bearer admin',Origin:origin,'Content-Type':'image/png'},body:image});
  assert.equal(r.status,200);assert.equal((await r.json()).enabled,true);
  r=await get('/music/');const html=await r.text();
  assert.match(html,/property="og:image"/);assert.match(html,/name="twitter:image"/);
  const sha=html.match(/image\?v=([a-f0-9]{64})/)[1];
  r=await get('/music/share/image?v='+sha);assert.deepEqual(Buffer.from(await r.arrayBuffer()),image);
  r=await get('/music/api/admin/share-image',{method:'DELETE',headers:{Authorization:'Bearer admin',Origin:origin}});
  assert.equal(r.status,200);
  r=await get('/music/');assert.doesNotMatch(await r.text(),/og:image/);
  r=await get('/music/share/image?v='+sha);assert.equal(r.status,404);
 }finally{server.close();}
});
test('static tags do not fall back to a default image',()=>{
 assert.doesNotMatch(socialHtml(baseIndex,{image:null},origin),/og:image/);
});