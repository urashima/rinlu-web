import test from 'node:test';
import assert from 'node:assert/strict';
import {createOvhS3} from '../s3.mjs';
import {createHash} from 'node:crypto';
const config={
  RINLU_S3_BUCKET:'rinlu-music-prod',
  RINLU_S3_REGION:'us-east-va',
  RINLU_S3_ENDPOINT:'https://s3.us-east-va.io.cloud.ovh.us',
  RINLU_S3_ACCESS_KEY_ID:'TESTACCESS',
  RINLU_S3_SECRET_ACCESS_KEY:'TESTSECRET',
};
function mock(){
 const objects=new Map();
 const requests=[];
 const transport=async(url,{method,headers,body})=>{
  const h=new Headers(headers);
  requests.push({method,url,headers:h});
  assert.ok(url.startsWith('https://s3.us-east-va.io.cloud.ovh.us/rinlu-music-prod/'));
  assert.match(h.get('authorization'),/^AWS4-HMAC-SHA256 Credential=TESTACCESS\/[0-9]{8}\/us-east-va\/s3\/aws4_request,/);
  const key=decodeURIComponent(url.slice(url.indexOf('/rinlu-music-prod/')+'/rinlu-music-prod/'.length));
  if(method==='PUT'&&h.has('x-amz-copy-source')){
   const source=decodeURIComponent(h.get('x-amz-copy-source').split('/').slice(2).join('/'));
   const origin=objects.get(source);
   if(!origin)return new Response(null,{status:404});
   objects.set(key,{content:Buffer.from(origin.content),mime:h.get('content-type')});
   return new Response('<CopyObjectResult/>',{status:200,headers:{'content-type':'application/xml'}});
  }
  if(method==='PUT'){
   assert.equal(h.get('x-amz-content-sha256'),createHash('sha256').update(body).digest('hex'));
   objects.set(key,{content:Buffer.from(body),mime:h.get('content-type')});
   return new Response(null,{status:200});
  }
  const value=objects.get(key);
  if(!value)return new Response(null,{status:404});
  const base={'content-type':value.mime,'accept-ranges':'bytes'};
  if(method==='HEAD')return new Response(null,{status:200,headers:{...base,'content-length':String(value.content.length)}});
  if(method==='GET'){
   const range=h.get('range');
   if(range){
    const m=/^bytes=(\d+)-(\d+)$/.exec(range);
    assert.ok(m);
    const start=Number(m[1]),end=Number(m[2]);
    return new Response(value.content.subarray(start,end+1),{status:206,headers:{...base,'content-length':String(end-start+1),'content-range':'bytes '+start+'-'+end+'/'+value.content.length}});
   }
   return new Response(value.content,{status:200,headers:{...base,'content-length':String(value.content.length)}});
  }
  throw Error('Unexpected method');
 };
 return {objects,requests,transport};
}
test('missing configuration disables S3 without errors',()=>{
 assert.equal(createOvhS3({}),null);
 assert.throws(()=>createOvhS3({...config,RINLU_S3_SECRET_ACCESS_KEY:''}),/Incomplete/);
});
test('region and hostname must match',()=>{
 assert.throws(()=>createOvhS3({...config,RINLU_S3_ENDPOINT:'https://example.org/'}),/Unexpected S3 endpoint/);
 assert.throws(()=>createOvhS3({...config,RINLU_S3_REGION:'us-west-or'}),/Unexpected S3 endpoint/);
});
test('verifiedPut stores bytes, validates SHA-256 and avoids duplicate write',async()=>{
 const fake=mock(),s3=createOvhS3(config,fake.transport);
 const key='playback/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/v1-s8.mp3';
 const bytes=Buffer.from('TESTMP3!');
 const first=await s3.verifiedPut(key,bytes,'audio/mpeg');
 assert.equal(first.sha256,createHash('sha256').update(bytes).digest('hex'));
 assert.equal(first.unchanged,false);
 assert.equal((await s3.head(key)).size,8);
 assert.deepEqual(Buffer.from(await (await s3.get(key)).arrayBuffer()),bytes);
 const second=await s3.verifiedPut(key,bytes,'audio/mpeg');
 assert.equal(second.unchanged,true);
 assert.equal(fake.requests.filter(x=>x.method==='PUT').length,1);
 const ranged=await s3.get(key,'bytes=1-3');
 assert.equal(ranged.status,206);
 assert.equal(Buffer.from(await ranged.arrayBuffer()).toString(),'EST');
});
test('S3-side original promotion never streams bytes through the gateway',async()=>{
 const fake=mock(),s3=createOvhS3(config,fake.transport);
 const a='staging/11111111-1111-4111-8111-111111111111/upload.mp3';
 const b='originals/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222';
 const bytes=Buffer.from('TESTMP3FULLBYTES');
 await s3.put(a,bytes,'audio/mpeg');
 const result=await s3.copy(a,b,'audio/mpeg');
 assert.equal(result.size,bytes.length);
 assert.deepEqual(Buffer.from(await (await s3.get(b)).arrayBuffer()),bytes);
 const copies=fake.requests.filter(x=>x.method==='PUT'&&x.headers.has('x-amz-copy-source'));
 assert.equal(copies.length,1);
 assert.equal(copies[0].headers.get('x-amz-copy-source'),'/rinlu-music-prod/'+a);
});
test('invalid object key and token-like endpoint are rejected',async()=>{
 const s3=createOvhS3(config,mock().transport);
 await assert.rejects(s3.put('../secret',Buffer.from('x')),/Invalid object key/);
 assert.throws(()=>createOvhS3({...config,RINLU_S3_ENDPOINT:'https://evil.example/rinlu-music-prod'}),/Unexpected S3 endpoint/);
});
