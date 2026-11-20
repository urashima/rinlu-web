import test from 'node:test';
import assert from 'node:assert/strict';
import {checkPrimaryReady,finalizePrimaryAsset,originalKey} from '../primary-media.mjs';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const staging='staging/'+owner+'/nonce.mp3',final=originalKey(owner,id);
const ticket={owner,assetId:id,kind:'audio',size:12345,key:staging,name:'song.mp3',nonce:'nonce'};
const cap={contract:'rinlu-s3-primary-v1',provider:'ovh-s3',bucket:'my-private-bucket',database:'ready',scanner:'ready',processing:'ready',quarantine:true,r2_dual_write:false};
function stub({capability=cap,commitStatus=201,stored=12345}={}){
 const state={entries:new Map([[staging,{size:stored}]]),copies:0,commits:[],deletes:[]};
 const s3={bucket:'my-private-bucket',
  head:async key=>state.entries.get(key)||null,
  copy:async(a,b)=>{state.copies++;state.entries.set(b,state.entries.get(a));return state.entries.get(b);},
  remove:async key=>{state.deletes.push(key);return state.entries.delete(key);}
 };
 const transport=async(url,options)=>{
  const path=new URL(url).pathname;
  if(path==='/api/storage/s3/capabilities')return Response.json(capability);
  if(path==='/api/storage/s3/commit'){
   const body=JSON.parse(options.body);state.commits.push(body);
   if(commitStatus!==201)return Response.json({error:'failed'},{status:commitStatus});
   return Response.json({id:body.asset_id,storage_provider:body.storage_provider,storage_key:body.storage_key,processing_state:'pending_scan',review_status:'pending'}, {status:201});
  }
  throw Error('Unexpected canonical path '+path);
 };
 return {state,s3,transport};
}
const opts=mock=>({s3:mock.s3,ticket,backendOrigin:'https://canonical.example',headers:{Authorization:'Bearer SESSION'},transport:mock.transport});
test('require exact D1/scan readiness before allowing S3-only upload',async()=>{
 for(const mode of [{...cap,scanner:'offline'},{...cap,r2_dual_write:true},{...cap,quarantine:false},{...cap,bucket:'some-other-bucket'}]){
  const mock=stub({capability:mode});
  await assert.rejects(checkPrimaryReady({backendOrigin:'https://canonical.example',headers:{},transport:mock.transport,expectedBucket:mock.s3.bucket}),/not ready/);
  await assert.rejects(finalizePrimaryAsset(opts(mock)),/not ready/);
  assert.equal(mock.state.copies,0);assert.equal(mock.state.commits.length,0);
 }
});
test('valid S3-only commit creates pending scan asset without uploading to R2',async()=>{
 const mock=stub(),res=await finalizePrimaryAsset(opts(mock));
 assert.equal(res.id,id);
 assert.equal(res.processing_state,'pending_scan');
 assert.equal(res.storage_key,final);
 assert.equal(mock.state.copies,1);
 assert.equal(mock.state.commits.length,1);
 assert.deepEqual(Object.keys(mock.state.commits[0]).sort(),[
  'asset_id','content_type','kind','original_name','processing_state','size','storage_key','storage_provider','upload_ticket_nonce'
 ].sort());
 assert.ok(!JSON.stringify(mock.state.commits[0]).includes('file'));
 assert.deepEqual(mock.state.deletes,[staging]);
});
test('canonical commit failure retains original and staging for retry, no R2 fallback',async()=>{
 const mock=stub({commitStatus:503});
 await assert.rejects(finalizePrimaryAsset(opts(mock)),/registration failed/);
 assert.ok(mock.state.entries.has(staging));
 assert.ok(mock.state.entries.has(final));
 assert.equal(mock.state.deletes.length,0);
 assert.equal(mock.state.copies,1);
});
test('retry is idempotent for an existing verified immutable final key',async()=>{
 const mock=stub();
 await assert.rejects(finalizePrimaryAsset({...opts(mock),transport:async(url,opts)=>{
  if(new URL(url).pathname.endsWith('/commit'))return Response.json({error:'retry'},{status:503});
  return mock.transport(url,opts);
 }}),/registration failed/);
 const res=await finalizePrimaryAsset(opts(mock));
 assert.equal(res.id,id);assert.equal(mock.state.copies,1);
});
test('source size mismatch refuses DB and copy',async()=>{
 const mock=stub({stored:10});
 await assert.rejects(finalizePrimaryAsset(opts(mock)),/size differs/);
 assert.equal(mock.state.copies,0);assert.equal(mock.state.commits.length,0);
});
test('owner and asset IDs cannot become arbitrary S3 keys',()=>{
 assert.throws(()=>originalKey('../outside',id),/Invalid/);
 assert.throws(()=>originalKey(owner,'../escape'),/Invalid/);
});
