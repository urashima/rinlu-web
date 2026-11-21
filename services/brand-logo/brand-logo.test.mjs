import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrandLogo,defaults} from './brand-logo.mjs';
function request(path,method='GET',payload,headers={}){
 const body=payload==null?null:Buffer.from(JSON.stringify(payload));
 return {url:path,method,headers:{...headers,...(body?{'content-type':'application/json','content-length':String(body.length)}:{})},
  async *[Symbol.asyncIterator](){if(body)yield body;}};
}
function response(){return {status:null,headers:{},body:null,writeHead(status,headers={}){this.status=status;this.headers=headers;},end(value){this.body=value??null;},destroy(){this.status=599;}};}
const s3=()=>{const data=new Map();return {data,
 async get(k){return data.has(k)?new Response(data.get(k)):null;},
 async put(k,bytes){data.set(k,Buffer.from(bytes));}};};
const run=async(handler,req)=>{const res=response();const handled=await handler(req,res);assert.equal(handled,true);return res;};
function handler({store=s3(),role='admin'}={}){
 const transport=async()=>new Response(JSON.stringify({user:{role,status:'active'}}),{status:200,headers:{'content-type':'application/json'}});
 return {store,handle:createBrandLogo({s3:store,backendOrigin:'https://source.example',publicOrigin:'https://rinlu.com',
  accountBearer:()=> 'Bearer correct-cookie',transport,readSvg:async file=>Buffer.from('<svg data-name="'+file+'"></svg>')})};
}
test('public logo defaults are exact SVG variants, no store changes',async()=>{
 const {handle}=handler();const c=await run(handle,request('/music/api/brand/config'));
 assert.equal(c.status,200);assert.deepEqual(JSON.parse(c.body),defaults);
 const logo=await run(handle,request('/music/api/brand/logo?slot=full'));
 assert.equal(logo.status,200);assert.match(logo.headers['Content-Type'],/image\/svg\+xml/);
 assert.match(logo.body.toString(),/rinlu-full-vector.svg/);
 assert.equal(logo.headers['Cache-Control'],'no-store');
 const compact=await run(handle,request('/music/api/brand/logo?slot=compact'));
 assert.match(compact.body.toString(),/rinlu-icon-vector.svg/);
 const head=await run(handle,request('/music/api/brand/logo?slot=compact','HEAD'));
 assert.equal(head.status,200);assert.equal(head.body,null);
});
test('admin can switch exact originals without redeploy; invalid options fail',async()=>{
 const {handle,store}=handler();
 const body={full:'rinlu-full-cutout',compact:'rinlu-symbol-only'};
 const invalid=await run(handle,request('/music/api/admin/logo','POST',body,{origin:'https://not-rinlu.com'}));
 assert.equal(invalid.status,403);
 const saved=await run(handle,request('/music/api/admin/logo','POST',body,{origin:'https://rinlu.com'}));
 assert.equal(saved.status,200);assert.equal(JSON.parse(saved.body).compact,'rinlu-symbol-only');
 assert.equal(store.data.size,1);
 const logo=await run(handle,request('/music/api/brand/logo?slot=account'));
 assert.match(logo.body.toString(),/rinlu-full-cutout.svg/);
 const compact=await run(handle,request('/music/api/brand/logo?slot=compact'));
 assert.match(compact.body.toString(),/rinlu-symbol-only.svg/);
 const bad=await run(handle,request('/music/api/admin/logo','POST',{...body,full:'../evil'},{origin:'https://rinlu.com'}));
 assert.equal(bad.status,422);
 assert.equal(store.data.size,1);
});
test('non-admin blocked; missing S3 fails closed for settings, logo remains visible',async()=>{
 const {handle}=handler({role:'fan'});
 const denied=await run(handle,request('/music/api/admin/logo'));
 assert.equal(denied.status,403);
 const fallback=createBrandLogo({s3:null,publicOrigin:'https://rinlu.com',backendOrigin:'https://source.example',
  accountBearer:()=>null,readSvg:async f=>Buffer.from('<svg>'+f+'</svg>')});
 const pub=await run(fallback,request('/music/api/brand/logo?slot=full'));
 assert.equal(pub.status,200);
 const admin=await run(fallback,request('/music/api/admin/logo'));
 assert.equal(admin.status,401);
});
