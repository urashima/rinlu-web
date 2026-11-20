/** Verify a production recording uses private signed S3 GET with Range. Do not log signatures. */
const origin='https://rinlu.com';
const catalog=await fetch(origin+'/music/api/catalog',{signal:AbortSignal.timeout(15000)});
if(!catalog.ok)throw Error('Production catalog unavailable');
const songs=(await catalog.json()).tracks;
if(!Array.isArray(songs)||!songs.length)throw Error('No public recordings available');
let direct=0,fallBack=0,denied=0;
for(const t of songs.slice(0,6)){
 if(!/^[0-9a-f-]{36}$/.test(t.id))continue;
 const response=await fetch(origin+'/music/api/playback/authorize',{method:'POST',
  headers:{Origin:origin,'Content-Type':'application/json'},
  body:JSON.stringify({track_id:t.id}),signal:AbortSignal.timeout(25000)});
 if(!response.ok){denied++;await response.body?.cancel();continue;}
 const payload=await response.json();
 if(payload.delivery!=='ovh-s3-direct'){fallBack++;continue;}
 const media=new URL(payload.url);
 if(!media.hostname.endsWith('.io.cloud.ovh.us')||!media.searchParams.has('X-Amz-Signature'))throw Error('Unexpected S3 signed URL host');
 if(!payload.probe_url?.startsWith('/music/api/media/'))throw Error('Missing same-origin playback probe');
 const bytes=await fetch(payload.url,{headers:{Origin:origin,Range:'bytes=0-15'},redirect:'error',signal:AbortSignal.timeout(25000)});
 if(bytes.status!==206){await bytes.body?.cancel();throw Error('S3 Range not available, HTTP '+bytes.status);}
 if(bytes.headers.get('access-control-allow-origin')!==origin){await bytes.body?.cancel();throw Error('S3 browser CORS missing');}
 if((await bytes.arrayBuffer()).byteLength!==16)throw Error('S3 Range byte count wrong');
 direct++;
 if(direct>=2)break;
}
console.log(JSON.stringify({catalog_count:songs.length,direct_s3_playbacks:direct,fallback:fallBack,authorization_failures:denied}));
if(direct<1)throw Error('No verified live S3 direct playback');
