import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable,PassThrough} from 'node:stream';
import {createHash} from 'node:crypto';
import {createDirectStorage} from '../direct-storage.mjs';
const ID='11111111-1111-4111-8111-111111111111',TRACK='22222222-2222-4222-8222-222222222222',ASSET='33333333-3333-4333-8333-333333333333';
const opts={RINLU_S3_BUCKET:'rinlu-music-prod',RINLU_S3_REGION:'us-east-va',RINLU_S3_ENDPOINT:'https://s3.us-east-va.io.cloud.ovh.us',RINLU_S3_ACCESS_KEY_ID:'FAKE_ACCESS',RINLU_S3_SECRET_ACCESS_KEY:'FAKE_SECRET',RINLU_S3_DIRECT_UPLOAD:'1',RINLU_S3_DIRECT_PLAYBACK:'1'};
function incoming(body,path){
 const req=Readable.from([Buffer.from(JSON.stringify(body))]);
 req.headers={origin:'https://rinlu.com'};req.method='POST';req.url='/music'+path;
 return req;
}
function output(){
 const res=new PassThrough();res.headers={};res.statusCode=0;
 res.setHeader=(k,v)=>{res.headers[k.toLowerCase()]=v;};
 res.writeHead=(status,headers={})=>{res.statusCode=status;for(const [k,v] of Object.entries(headers))res.setHeader(k,v);};
 return res;
}
async function parse(res){let raw='';for await(const part of res)raw+=part;return JSON.parse(raw);}
function fakeStore(){
 const objects=new Map();
 return {
  objects,
  async head(key){return objects.has(key)?{size:objects.get(key).length}:null;},
  async get(key){return objects.has(key)?new Response(objects.get(key),{status:200}):null;},
  async verifiedPut(key,bytes){objects.set(key,Buffer.from(bytes));return {bytes:bytes.length};},
  async remove(key){return objects.delete(key);}
 };
}
test('browser signed POST requires owner session and exact content length; complete stores canonical object',async()=>{
 const store=fakeStore(),file=Buffer.alloc(120,7),hash=createHash('sha256').update(file).digest('hex');
 const transport=async(url,{method,body})=>{
  if(new URL(url).pathname==='/api/me')return Response.json({user:{id:ID,role:'artist',status:'active'}});
  if(new URL(url).pathname==='/api/upload'){
    assert.equal(method,'POST');
    assert.ok(body instanceof FormData);
    assert.equal(body.get('kind'),'audio');
    assert.equal((await body.get('file').arrayBuffer()).byteLength,file.length);
    return Response.json({id:ASSET,hash,size:file.length,mime:'audio/mpeg'},{status:201});
  }
  throw Error('Unexpected canonical request '+url);
 };
 const bridge=createDirectStorage({s3:store,backendOrigin:'https://old.example',publicOrigin:'https://rinlu.com',accountBearer:()=> 'Bearer TEST',env:opts,transport});
 const req=incoming({kind:'audio',size:100,name:'track.mp3'},'/api/storage/direct/init'),res=output();
 // Use file >100 bytes: policy requires min=100.
 const staged=file;
 const ticketReq=incoming({kind:'audio',size:staged.length,name:'track.mp3'},'/api/storage/direct/init'),ticketRes=output();
 assert.equal(await bridge.handle(ticketReq,ticketRes,'/api/storage/direct/init'),true);
 const grant=await parse(ticketRes);
 assert.equal(ticketRes.statusCode,200);
 const policy=JSON.parse(Buffer.from(grant.upload.fields.policy,'base64').toString('utf8'));
 assert.ok(policy.conditions.some(x=>Array.isArray(x)&&x[0]==='content-length-range'&&x[1]===staged.length&&x[2]===staged.length));
 store.objects.set(grant.upload.fields.key,staged);
 const completeReq=incoming({ticket:grant.ticket,kind:'audio'},'/api/storage/direct/complete'),completeRes=output();
 assert.equal(await bridge.handle(completeReq,completeRes,'/api/storage/direct/complete'),true);
 assert.equal(completeRes.statusCode,201);
 const finished=await parse(completeRes);
 assert.equal(finished.id,ASSET);
 assert.equal(finished.storage,'ovh-s3-direct-upload');
 assert.deepEqual(store.objects.get(ID+'/'+ASSET),staged);
 assert.equal(store.objects.has(grant.upload.fields.key),false);
});
test('signed S3 playback requires original authorization and preserves legacy probe URL',async()=>{
 const store=fakeStore();const key='playback/'+TRACK+'/v2-s1024.mp3';store.objects.set(key,Buffer.alloc(1024));
 const transport=async(url,{method})=>{
  const p=new URL(url).pathname;
  if(p==='/api/playback/authorize')return Response.json({url:'/api/media/'+TRACK+'?token=private',expires_at:Date.now()+300000});
  if(p==='/api/media/'+TRACK)return new Response(null,{status:200,headers:{'content-length':'1024','content-type':'audio/mpeg'}});
  if(p==='/api/track/'+TRACK)return Response.json({track:{version:2}});
  throw Error('Unexpected upstream '+url);
 };
 const bridge=createDirectStorage({s3:store,backendOrigin:'https://old.example',publicOrigin:'https://rinlu.com',accountBearer:()=> 'Bearer TEST',env:opts,transport});
 const req=incoming({track_id:TRACK},'/api/playback/authorize'),res=output();
 assert.equal(await bridge.handle(req,res,'/api/playback/authorize'),true);
 const result=await parse(res);
 assert.equal(res.statusCode,200);
 assert.equal(result.delivery,'ovh-s3-direct');
 assert.equal(result.probe_url,'/music/api/media/'+TRACK+'?token=private');
 assert.ok(result.url.startsWith(opts.RINLU_S3_ENDPOINT+'/'+opts.RINLU_S3_BUCKET+'/playback/'));
 assert.match(result.url,/X-Amz-Signature=/);
});
test('without S3 copy the player receives original same-origin playback URL',async()=>{
 const store=fakeStore();
 const transport=async(url)=>{
  const p=new URL(url).pathname;
  if(p==='/api/playback/authorize')return Response.json({url:'/api/media/'+TRACK+'?token=private'});
  if(p==='/api/media/'+TRACK)return new Response(null,{status:200,headers:{'content-length':'1024'}});
  if(p==='/api/track/'+TRACK)return Response.json({track:{version:2}});
  throw Error('Unexpected upstream');
 };
 const bridge=createDirectStorage({s3:store,backendOrigin:'https://old.example',publicOrigin:'https://rinlu.com',accountBearer:()=> 'Bearer TEST',env:opts,transport});
 const res=output();
 await bridge.handle(incoming({track_id:TRACK},'/api/playback/authorize'),res,'/api/playback/authorize');
 const result=await parse(res);
 assert.equal(result.url,'/music/api/media/'+TRACK+'?token=private');
 assert.equal(result.delivery,undefined);
});
test('wrong origin cannot mint direct-upload POST policy',async()=>{
 const bridge=createDirectStorage({s3:fakeStore(),backendOrigin:'https://old.example',publicOrigin:'https://rinlu.com',accountBearer:()=> 'Bearer TEST',env:opts,transport:async()=>Response.json({user:{id:ID}})});
 const req=incoming({kind:'audio',size:1000},'/api/storage/direct/init');req.headers.origin='https://evil.test';
 const res=output();
 await bridge.handle(req,res,'/api/storage/direct/init');
 assert.equal(res.statusCode,403);
 assert.match((await parse(res)).error,/Cross-origin/);
});
