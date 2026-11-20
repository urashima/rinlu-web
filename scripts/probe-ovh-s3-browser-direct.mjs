/** Reversible, real OVH S3 browser POST + signed GET + CORS smoke test.
 * Run on GitHub Actions using existing secrets; no secret or URL signatures logged.
 */
import {randomBytes,createHash} from 'node:crypto';
import {createOvhS3} from '../services/ovh-s3/s3.mjs';
import {createS3Signer} from '../services/ovh-s3/signing.mjs';
const env={
 RINLU_S3_ENDPOINT:process.env.OVH_S3_ENDPOINT,
 RINLU_S3_REGION:process.env.OVH_S3_REGION,
 RINLU_S3_BUCKET:process.env.OVH_S3_BUCKET,
 RINLU_S3_ACCESS_KEY_ID:process.env.OVH_S3_ACCESS_KEY_ID,
 RINLU_S3_SECRET_ACCESS_KEY:process.env.OVH_S3_SECRET_ACCESS_KEY
};
const signer=createS3Signer(env),s3=createOvhS3(env);
const key='__rinlu-browser-direct-probe/'+randomBytes(16).toString('hex')+'.bin';
const bytes=randomBytes(4096);
const grant=signer.postPolicy(key,'application/octet-stream',bytes.length);
const origin='https://rinlu.com';
try{
 const options=await fetch(grant.url,{
  method:'OPTIONS',
  headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'},
  signal:AbortSignal.timeout(15000),
 });
 if(!options.ok||options.headers.get('access-control-allow-origin')!==origin){
  throw Error('S3 browser POST CORS preflight not enabled');
 }
 const fields=new FormData();
 for(const [k,v] of Object.entries(grant.fields))fields.append(k,v);
 fields.append('file',new Blob([bytes],{type:'application/octet-stream'}),'probe.bin');
 const upload=await fetch(grant.url,{method:'POST',body:fields,headers:{Origin:origin},redirect:'error',signal:AbortSignal.timeout(45000)});
 if(![200,201,204].includes(upload.status)){await upload.body?.cancel();throw Error('S3 signed browser POST rejected, HTTP '+upload.status);}
 await upload.body?.cancel();
 const info=await s3.head(key);
 if(info?.size!==bytes.length)throw Error('S3 browser POST content length incorrect');
 const direct=await fetch(signer.signedGet(key,60),{headers:{Origin:origin,Range:'bytes=0-31'},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(direct.status!==206){await direct.body?.cancel();throw Error('S3 signed GET Range failed, HTTP '+direct.status);}
 if(direct.headers.get('access-control-allow-origin')!==origin){await direct.body?.cancel();throw Error('S3 direct GET CORS missing');}
 const part=Buffer.from(await direct.arrayBuffer());
 if(!part.equals(bytes.subarray(0,32)))throw Error('Signed GET byte range differed');
 const copy=await s3.get(key);
 if(!copy||!Buffer.from(await copy.arrayBuffer()).equals(bytes))throw Error('S3 POST upload checksum differed');
 console.log('REAL OVH S3 BROWSER POST + CORS + SIGNED GET RANGE + CHECKSUM VERIFIED');
}finally{
 await s3.remove(key);
}
