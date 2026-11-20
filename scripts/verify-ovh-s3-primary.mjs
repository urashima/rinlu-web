/** Real OVH US S3 same-bucket CopyObject probe. Creates and removes only
 * random temporary files, never reads production songs or logs credentials.
 */
import {randomBytes,createHash} from 'node:crypto';
import {createOvhS3} from '../services/ovh-s3/s3.mjs';
const env={
 RINLU_S3_ENDPOINT:process.env.OVH_S3_ENDPOINT,
 RINLU_S3_REGION:process.env.OVH_S3_REGION,
 RINLU_S3_BUCKET:process.env.OVH_S3_BUCKET,
 RINLU_S3_ACCESS_KEY_ID:process.env.OVH_S3_ACCESS_KEY_ID,
 RINLU_S3_SECRET_ACCESS_KEY:process.env.OVH_S3_SECRET_ACCESS_KEY
};
const s3=createOvhS3(env);
if(!s3)throw Error('OVH S3 unavailable');
const nonce=randomBytes(16).toString('hex'),source='__rinlu-probe/primary-'+nonce+'.bin',target='__rinlu-probe/promoted-'+nonce+'.bin';
const bytes=randomBytes(4096),want=createHash('sha256').update(bytes).digest('hex');
try {
 await s3.verifiedPut(source,bytes,'application/octet-stream');
 const result=await s3.copy(source,target,'application/octet-stream');
 if(result?.size!==bytes.length)throw Error('S3 CopyObject failed size verification');
 const read=await s3.get(target);
 if(!read||createHash('sha256').update(Buffer.from(await read.arrayBuffer())).digest('hex')!==want)throw Error('S3 CopyObject content mismatch');
 console.log('REAL OVH S3 PRIMARY CopyObject + private checksum PASS');
}finally {
 await Promise.allSettled([s3.remove(source),s3.remove(target)]);
}
