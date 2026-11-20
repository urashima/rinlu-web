/** Production S3 probe. Uses the already configured GitHub Secrets, writes one
 * randomized object, verifies SHA-256 byte-for-byte, then deletes it.
 * Never prints endpoint credentials, key material, or object contents.
 */
import {randomBytes} from 'node:crypto';
import {createOvhS3} from '../services/ovh-s3/s3.mjs';
const config={
 RINLU_S3_ENDPOINT:process.env.OVH_S3_ENDPOINT,
 RINLU_S3_REGION:process.env.OVH_S3_REGION,
 RINLU_S3_BUCKET:process.env.OVH_S3_BUCKET,
 RINLU_S3_ACCESS_KEY_ID:process.env.OVH_S3_ACCESS_KEY_ID,
 RINLU_S3_SECRET_ACCESS_KEY:process.env.OVH_S3_SECRET_ACCESS_KEY,
};
const s3=createOvhS3(config);
if(!s3)throw Error('No S3 configuration');
const key='__rinlu-probe/'+randomBytes(16).toString('hex')+'.bin';
const bytes=randomBytes(4096);
try{
 const result=await s3.verifiedPut(key,bytes,'application/octet-stream');
 if(result.bytes!==bytes.length)throw Error('Unexpected S3 result size');
 console.log('OVH S3 real write/read/checksum verified in region '+s3.region);
}finally{
 await s3.remove(key);
}
