import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable,PassThrough} from 'node:stream';
import {createHash} from 'node:crypto';
import {createStorageGateway} from '../storage-gateway.mjs';

const OWNER='11111111-1111-4111-8111-111111111111';
const ASSET='22222222-2222-4222-8222-222222222222';
const TRACK='33333333-3333-4333-8333-333333333333';
function incoming(body,method,headers={}){
 const req=Readable.from(body?[body]:[]);
 req.method=method;req.headers=headers;return req;
}
function outgoing(){
 const res=new PassThrough();
 res.statusCode=200;
 res.headers={};
 res.setHeader=(key,value)=>{res.headers[key.toLowerCase()]=value;};
 res.writeHead=(code,headers={})=>{res.statusCode=code;for(const [key,value] of Object.entries(headers))res.setHeader(key,value);};
 return res;
}
const collect=async res=>{let output='';for await(const chunk of res)output+=chunk.toString();return output;};
test('upload mirrors verified source bytes to owner/asset S3 key',async()=>{
 const bytes=Buffer.from('TEST_AUDIO_BYTES');
 const form=new FormData();
 form.set('kind','audio');form.set('file',new File([bytes],'test.mp3',{type:'audio/mpeg'}));
 const incomingBody=new Request('https://rinlu.com/music/api/upload',{method:'POST',body:form});
 const body=Buffer.from(await incomingBody.arrayBuffer()),contentType=incomingBody.headers.get('content-type');
 const uploads=[];
 const s3={verifiedPut:async(key,data,mime)=>{uploads.push({key,bytes:Buffer.from(data),mime})}};
 const transport=async(url,opts)=>{
  const pathname=new URL(url).pathname;
  if(pathname==='/api/upload'){
   assert.equal(opts.headers.get('authorization'),'Bearer TEST');
   return Response.json({id:ASSET,hash:createHash('sha256').update(bytes).digest('hex'),size:bytes.length,mime:'audio/mpeg'},{status:201});
  }
  if(pathname==='/api/me')return Response.json({user:{id:OWNER}});
  throw Error('Unexpected upstream path '+pathname);
 };
 const bridge=createStorageGateway({s3,backendOrigin:'https://original.example',publicOrigin:'https://rinlu.com',accountBearer:()=> 'Bearer TEST',env:{RINLU_S3_UPLOAD_MIRROR:'1'},transport});
 const req=incoming(body,'POST',{origin:'https://rinlu.com','content-type':contentType,'content-length':String(body.length)}),res=outgoing();
 const handled=await bridge.handle(req,res,'/api/upload',new URL('https://rinlu.com/music/api/upload'));
 assert.equal(handled,true);assert.equal(res.statusCode,201);
 assert.equal(JSON.parse(await collect(res)).id,ASSET);
 assert.deepEqual(uploads,[{key:OWNER+'/'+ASSET,bytes,mime:'audio/mpeg'}]);
 assert.equal(res.headers['x-rinlu-storage'],'ovh-s3-mirrored');
});
test('disabled flags leave canonical API proxy unchanged',async()=>{
 const bridge=createStorageGateway({s3:{},backendOrigin:'https://original.example',publicOrigin:'https://rinlu.com',accountBearer:()=>'',env:{}});
 const req=incoming(null,'GET'),res=outgoing();
 assert.equal(await bridge.handle(req,res,'/api/media/'+TRACK,new URL('https://rinlu.com/music/api/media/'+TRACK)),false);
});
test('S3 playback only after canonical HEAD validates signed token and track version',async()=>{
 const s3={head:async()=>({size:4}),get:async()=>new Response('song',{status:200,headers:{'content-length':'4'}})};
 const calls=[];
 const transport=async(url,options)=>{
  const u=new URL(url);calls.push([u.pathname,options.method||'GET']);
  if(u.pathname==='/api/media/'+TRACK)return new Response(null,{status:200,headers:{'content-length':'4','content-type':'audio/mpeg','accept-ranges':'bytes'}});
  if(u.pathname==='/api/track/'+TRACK)return Response.json({track:{version:3}});
  throw Error('Unexpected source');
 };
 const bridge=createStorageGateway({s3,backendOrigin:'https://original.example',publicOrigin:'https://rinlu.com',accountBearer:()=> 'Bearer TEST',env:{RINLU_S3_PLAYBACK_CACHE:'1'},transport});
 const req=incoming(null,'GET'),res=outgoing();
 const url=new URL('https://rinlu.com/music/api/media/'+TRACK+'?token=signed');
 assert.equal(await bridge.handle(req,res,'/api/media/'+TRACK,url),true);
 assert.equal(res.statusCode,200);assert.equal(await collect(res),'song');
 assert.equal(res.headers['x-rinlu-storage'],'ovh-s3');
 assert.deepEqual(calls,[['/api/media/'+TRACK,'HEAD'],['/api/track/'+TRACK,'GET']]);
});
test('unauthorized audio is never served from S3',async()=>{
 let reads=0;
 const s3={head:async()=>{reads++;return {size:4}}};
 const transport=async()=>new Response(null,{status:403});
 const bridge=createStorageGateway({s3,backendOrigin:'https://original.example',publicOrigin:'https://rinlu.com',accountBearer:()=>'',env:{RINLU_S3_PLAYBACK_CACHE:'1'},transport});
 const req=incoming(null,'GET'),res=outgoing();
 assert.equal(await bridge.handle(req,res,'/api/media/'+TRACK,new URL('https://rinlu.com/music/api/media/'+TRACK+'?token=invalid')),false);
 assert.equal(reads,0);
});
