/** S3-only media processing completion: no multipart/R2 object write.
 * The leased ClamAV worker performs private S3 GET, scan, ffprobe, rendition
 * processing and S3 PUT, then submits hashes and immutable object locators.
 */
import {z} from 'zod';
import {db,q,one,now,fail,log,type Row} from './backend';
import {mediaStorage,mediaDigest} from './media-storage';
import {isArtworkJpeg} from './artwork-jpeg';

const digest=z.string().regex(/^[a-f0-9]{64}$/);
const completed=z.discriminatedUnion('kind',[
 z.object({
  kind:z.literal('audio').optional().default('audio'),storage_provider:z.literal('ovh-s3'),
  input_storage_key:z.string().min(1).max(250),output_storage_key:z.string().min(1).max(250),
  original_sha256:digest,rendition_sha256:digest,rendition_size:z.number().int().min(1).max(32*1024*1024),
  scan:z.literal('clean'),processor_version:z.string().min(1).max(80)
 }).strict(),
 z.object({
  kind:z.literal('artwork'),storage_provider:z.literal('ovh-s3'),
  input_storage_key:z.string().min(1).max(250),output_storage_key:z.string().min(1).max(250),
  original_sha256:digest,normalized_sha256:digest,normalized_size:z.number().int().min(1).max(5*1024*1024),
  width:z.number().int().min(500).max(1600),height:z.number().int().min(500).max(1600),
  scan:z.literal('clean'),processor_version:z.string().min(1).max(80)
 }).strict()
]);
const MAX_ORIGINAL=25*1024*1024;
async function validatedBytes(key:string,sizeLimit:number){
 const obj=await mediaStorage.get(key);
 if(!obj)fail(404,'Scanned media object is missing.');
 const bytes=new Uint8Array(await obj.arrayBuffer());
 if(!bytes.length||bytes.length>sizeLimit)fail(413,'Scanned media object exceeds the allowed size.');
 return bytes;
}
export function s3JobClaim(j:Row,a:Row){
 if(!a.storage_key?.startsWith('originals/'+a.owner_id+'/'+a.id))return null;
 const attempt=Math.max(1,Number(j.attempts)+1);
 return {storage_provider:'ovh-s3',kind:a.kind,
   input_storage_key:a.storage_key,
   output_storage_key:a.kind==='artwork'?'artwork/'+a.id+'/normalized.jpg':'renditions/'+a.id+'/v'+attempt+'.mp3'};
}
export function s3AnalysisClaim(job:Row){
 const key=String(job.output_key||'');
 if(!/^renditions\/[0-9a-f-]{36}\/v[1-9][0-9]*\.mp3$/i.test(key))return null;
 return {storage_provider:'ovh-s3',input_storage_key:key};
}
export async function s3Complete(req:Request,j:Row,inspectMp3:(bytes:Uint8Array,upload?:boolean)=>any){
 let payload:unknown;
 try{payload=await req.json()}catch{fail(400,'Expected S3 processing completion JSON.');}
 const b=completed.parse(payload);
 const asset=await one('SELECT * FROM assets WHERE id=?',j.asset_id);
 if(!asset||!asset.storage_key?.startsWith('originals/'+asset.owner_id+'/'+asset.id))fail(409,'Job is not an S3 primary asset.');
 if(b.input_storage_key!==asset.storage_key)fail(403,'The S3 original does not belong to this job.');
 const original=await validatedBytes(asset.storage_key,MAX_ORIGINAL);
 const originalHash=await mediaDigest(original);
 if(originalHash!==b.original_sha256||originalHash!==asset.hash||original.length!==asset.size)fail(409,'The S3 original changed after upload.');
 const expected=asset.kind==='artwork'?'artwork/'+asset.id+'/normalized.jpg':'renditions/'+asset.id+'/v'+j.attempts+'.mp3';
 if(b.output_storage_key!==expected||b.kind!==asset.kind)fail(403,'This media output key does not belong to the leased job.');
 const output=await validatedBytes(expected,asset.kind==='artwork'?5*1024*1024:32*1024*1024);
 const outputHash=await mediaDigest(output);
 const outputExpected=b.kind==='artwork'?b.normalized_sha256:b.rendition_sha256;
 const outputLength=b.kind==='artwork'?b.normalized_size:b.rendition_size;
 if(outputHash!==outputExpected||output.byteLength!==outputLength)fail(409,'The processed S3 object failed checksum verification.');
 let processing:any;
 if(b.kind==='audio'){
  try{processing=inspectMp3(output)}catch{fail(415,'The scanned S3 output is not a valid MP3.');}
 }else{
  if(!isArtworkJpeg(output))fail(415,'Scanned artwork is not a valid JPEG.');
  processing={width:b.width,height:b.height,normalized_jpeg:true};
 }
 let metadata:any={};
 try{metadata=JSON.parse(asset.metadata||'{}')}catch{}
 metadata={...metadata,storage_provider:'ovh-s3',scan:'clean',normalized_jpeg:b.kind==='artwork',processed_key:expected,processor_version:b.processor_version};
 const stamp=now(),nowMs=Date.now();
 const steps=[
  q("UPDATE media_jobs SET status='complete',scan='clean',output_key=?,output_size=?,output_hash=?,metadata=?,lease=NULL,lease_until=NULL,updated_at=? WHERE id=? AND asset_id=? AND lease=? AND status='processing' AND lease_until>=?",
    expected,outputLength,outputHash,JSON.stringify(processing),stamp,j.id,j.asset_id,j.lease,nowMs),
  q("UPDATE assets SET metadata=? WHERE id=? AND storage_key=? AND EXISTS (SELECT 1 FROM media_jobs WHERE asset_id=assets.id AND status='complete' AND scan='clean' AND output_key=?)",
    JSON.stringify(metadata),j.asset_id,asset.storage_key,expected)
 ];
 if(b.kind==='audio'){
  steps.push(q("UPDATE tracks SET duration=?,updated_at=? WHERE asset_id=? AND EXISTS (SELECT 1 FROM media_jobs WHERE asset_id=tracks.asset_id AND status='complete' AND scan='clean' AND output_key=?)",processing.duration,stamp,j.asset_id,expected));
 }
 steps.push(log('processor','media.s3_processed',j.asset_id,{source_hash:originalHash,output_hash:outputHash,output_key:expected,kind:b.kind}));
 const r=await db().batch(steps);
 if(!r[0].meta.changes)fail(409,'The job lease expired or was replaced before completion.');
 return Response.json({ok:true,storage_provider:'ovh-s3',output_key:expected,...processing},{headers:{'Cache-Control':'no-store'}});
}
