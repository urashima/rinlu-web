/** Backfill public, approved RINLU playbacks into OVH S3.
 * Reads only the same playback URLs available to anonymous listeners.
 * No account bypass, R2 deletion, DB mutation, or public bucket ACL changes.
 * Idempotent: objects are keyed by (track ID, track version, byte length).
 */
import {createOvhS3} from '../services/ovh-s3/s3.mjs';
const origin='https://rinlu.com';
const base=origin+'/music/api';
const config={
 RINLU_S3_ENDPOINT:process.env.OVH_S3_ENDPOINT,
 RINLU_S3_REGION:process.env.OVH_S3_REGION,
 RINLU_S3_BUCKET:process.env.OVH_S3_BUCKET,
 RINLU_S3_ACCESS_KEY_ID:process.env.OVH_S3_ACCESS_KEY_ID,
 RINLU_S3_SECRET_ACCESS_KEY:process.env.OVH_S3_SECRET_ACCESS_KEY,
};
const s3=createOvhS3(config);
if(!s3)throw Error('OVH S3 settings missing; abort migration');
const max=Number(process.env.RINLU_S3_IMPORT_MAX||200);
if(!Number.isSafeInteger(max)||max<1||max>1000)throw Error('Invalid import maximum');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const response=await fetch(base+'/catalog',{signal:AbortSignal.timeout(20000)});
if(!response.ok)throw Error('Canonical catalog unavailable, HTTP '+response.status);
const tracks=(await response.json()).tracks;
if(!Array.isArray(tracks))throw Error('Canonical catalog does not include tracks');
const ids=new Set(),errors=[],unavailableStatus={};
let copied=0,skipped=0,unavailable=0,attempted=0;
for(const track of tracks){
 if(attempted>=max)break;
 if(typeof track?.id!=='string'||!/^[a-f0-9-]{36}$/.test(track.id)||!Number.isSafeInteger(track.version)||track.version<1||ids.has(track.id))continue;
 ids.add(track.id);attempted++;
 try{
  let authorization;
  for(let retry=0;retry<3;retry++){
   authorization=await fetch(base+'/playback/authorize',{
    method:'POST',headers:{'content-type':'application/json','origin':origin},
    body:JSON.stringify({track_id:track.id}),signal:AbortSignal.timeout(20000)});
   if(authorization.status!==429)break;
   await sleep((retry+1)*5000);
  }
  if(!authorization.ok){
   await authorization.body?.cancel();
   if([401,403,404,409,429,503].includes(authorization.status)){unavailable++;unavailableStatus[authorization.status]=(unavailableStatus[authorization.status]||0)+1;continue;}
   throw Error('Authorization returned HTTP '+authorization.status);
  }
  const info=await authorization.json();
  const mediaUrl=new URL(info.url||'',origin);
  if(mediaUrl.origin!==origin||mediaUrl.pathname!=='/music/api/media/'+track.id||!mediaUrl.searchParams.has('token'))throw Error('Unsafe authorized playback path');
  const metadata=await fetch(mediaUrl,{method:'HEAD',signal:AbortSignal.timeout(20000)});
  if(!metadata.ok){unavailableStatus['head_'+metadata.status]=(unavailableStatus['head_'+metadata.status]||0)+1;await metadata.body?.cancel();unavailable++;continue;}
  const size=Number(metadata.headers.get('content-length'));
  if(!Number.isSafeInteger(size)||size<1||size>32*1024*1024)throw Error('Playback size outside permitted limits');
  const key='playback/'+track.id+'/v'+track.version+'-s'+size+'.mp3';
  const exists=await s3.head(key);
  if(exists?.size===size){skipped++;continue;}
  const audio=await fetch(mediaUrl,{signal:AbortSignal.timeout(90000)});
  if(!audio.ok){await audio.body?.cancel();throw Error('Playback download failed, HTTP '+audio.status);}
  const bytes=Buffer.from(await audio.arrayBuffer());
  if(bytes.length!==size)throw Error('Downloaded audio length changed');
  await s3.verifiedPut(key,bytes,'audio/mpeg');
  copied++;
  console.log('Public track copied and verified: '+copied+'/'+attempted);
 }catch(error){
  errors.push({id:track.id,type:error?.message?.slice(0,120)||'Unknown'});
  console.error('Public S3 import could not finish item '+attempted+': '+(error?.name||'Error'));
 }
 await sleep(350);
}
console.log(JSON.stringify({catalog_tracks:tracks.length,attempted,copied,existing:skipped,unavailable,unavailable_status:unavailableStatus,failed:errors.length}));
if(errors.length||(attempted>0&&copied+skipped===0))process.exitCode=1;
