/** Canonical RINLU Site / Cloudflare Worker S3-only asset registration.
 * Publish to the *original* Site backend (not merely the OVH Docker mirror).
 * Reuses the current D1 assets, media_jobs, consents, rate limits and audit schema.
 */
import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {one,db,q,log,fail,json,parse,now, type Row} from './backend';
import {mediaStorage,mediaDigest} from './media-storage';
import {inspectMp3} from './media-service';
import {isArtworkJpeg,artworkJpegMaxBytes} from './artwork-jpeg';
import {capacity} from './capacity';
import {publicConfig,POLICY_VERSION} from './operations';

const id=z.string().uuid();
const bodySchema=z.object({
 asset_id:id,
 kind:z.enum(['audio','artwork']),
 size:z.number().int().min(100).max(25*1024*1024),
 content_type:z.enum(['audio/mpeg','image/jpeg']),
 original_name:z.string().min(1).max(180),
 storage_provider:z.literal('ovh-s3'),
 storage_key:z.string().min(1).max(250),
 upload_ticket_nonce:z.string().regex(/^[a-f0-9]{48}$/),
 processing_state:z.literal('pending_scan')
}).strict();

export function s3PrimaryKey(owner:string,asset:string){
 if(!z.string().uuid().safeParse(owner).success||!z.string().uuid().safeParse(asset).success)fail(400,'Invalid media identity.');
 return 'originals/'+owner+'/'+asset;
}
function s3Configuration(){
 const e=env as unknown as Record<string,string|undefined>;
 const region=e.OVH_S3_REGION||'';
 const host='https://s3.'+region+'.io.cloud.ovh.'+(region.startsWith('us-')?'us':'net');
 const enabled=e.OVH_S3_ENABLED==='1'&&e.RINLU_S3_ONLY==='1';
 const good=enabled&&e.OVH_S3_ENDPOINT?.replace(/\/$/,'')===host&&
   /^[a-z0-9][a-z0-9.-]{2,63}$/.test(e.OVH_S3_BUCKET||'')&&
   !!e.OVH_S3_ACCESS_KEY_ID&&!!e.OVH_S3_SECRET_ACCESS_KEY;
 return good?{bucket:e.OVH_S3_BUCKET!}:null;
}
async function scannerReady(){
 const r=await one("SELECT value FROM settings WHERE key='processor_heartbeat'");
 if(!r?.value)return false;
 let heartbeat:any;
 try{heartbeat=JSON.parse(r.value)}catch{return false}
 const age=Date.now()-Date.parse(heartbeat.time||'');
 return heartbeat.scanner==='ready'&&heartbeat.s3_primary==='ready'&&
        Number.isFinite(age)&&age>=0&&age<5*60000;
}
async function readiness(){
 const config=s3Configuration();
 if(!config||!await scannerReady())fail(503,'The private S3 database and scanner are not ready.');
 const pendingLegacy=await one("SELECT COUNT(*) n FROM media_jobs j JOIN assets a ON a.id=j.asset_id WHERE j.status IN ('pending','processing') AND a.storage_key NOT LIKE 'originals/%'");
 if(Number(pendingLegacy?.n||0)>0)fail(503,'Existing R2 processing jobs must finish before new primary writes.');
 return {contract:'rinlu-s3-primary-v1',provider:'ovh-s3',bucket:config.bucket,
   database:'ready',scanner:'ready',processing:'ready',quarantine:true,r2_dual_write:false};
}

export async function s3PrimaryRoute(req:Request,p:string[],u:Row|null):Promise<Response|null>{
 if(p[0]!=='storage'||p[1]!=='s3')return null;
 if(p[2]==='capabilities'&&req.method==='GET')return json(await readiness());
 if(p[2]!=='commit'||req.method!=='POST')fail(404,'S3 storage endpoint not found.');
 if(!u||u.status!=='active')fail(401,'Sign in before uploading.');
 await readiness();
 const policy=await one('SELECT version FROM consents WHERE user_id=? AND version=?',u.id,POLICY_VERSION);
 if(!policy)fail(428,'Accept the current contributor agreement before uploading.');
 const conf=await publicConfig();
 if(!conf.uploads_open||conf.maintenance_mode)fail(503,'Uploads are paused.');
 const limits=(await capacity()).limits;
 const b=await parse(req,bodySchema);
 if(b.content_type!==(b.kind==='audio'?'audio/mpeg':'image/jpeg'))fail(415,'Invalid media content type.');
 const max=b.kind==='audio'?limits.audio_bytes:Math.min(limits.artwork_bytes,artworkJpegMaxBytes);
 if(b.size>max)fail(413,'File exceeds the current media allowance.');
 const key=s3PrimaryKey(u.id,b.asset_id);
 if(b.storage_key!==key)fail(403,'Storage key must belong to the authenticated uploader.');
 const old=await one('SELECT * FROM assets WHERE id=?',b.asset_id);
 if(old){
   let meta:any={};try{meta=JSON.parse(old.metadata||'{}')}catch{}
   if(old.owner_id!==u.id||old.storage_key!==key||old.size!==b.size||old.kind!==b.kind||meta.upload_ticket_nonce!==b.upload_ticket_nonce){
     fail(409,'An asset with this ID already belongs to another upload.');
   }
   return json({id:b.asset_id,hash:old.hash,mime:old.mime,size:old.size,
     storage_provider:'ovh-s3',storage_key:key,processing_state:'pending_scan',review_status:'pending'});
 }
 const usage=await one('SELECT COALESCE(SUM(size),0) n FROM assets WHERE owner_id=?',u.id);
 if(Number(usage?.n||0)+b.size>limits.storage_bytes)fail(413,'Your storage allowance is full.');
 const head=await mediaStorage.head(key);
 if(!head||head.size!==b.size)fail(409,'The S3 original has not been verified.');
 // Read once for canonical format validation and actual SHA-256. No R2 PUT.
 const object=await mediaStorage.get(key);
 if(!object)fail(404,'S3 original cannot be read.');
 const bytes=new Uint8Array(await object.arrayBuffer());
 if(bytes.byteLength!==b.size)fail(409,'S3 file size changed during registration.');
 if(b.kind==='audio'){
   try{inspectMp3(bytes,true)}catch{fail(415,'Upload an MP3 encoded at 192 kbps or 320 kbps.');}
 }else if(!isArtworkJpeg(bytes))fail(415,'Choose a supported JPG cover.');
 const digest=await mediaDigest(bytes);
 const time=now();
 const metadata=JSON.stringify({storage_provider:'ovh-s3',scan:'pending',
   upload_ticket_nonce:b.upload_ticket_nonce,normalized_jpeg:false,uploaded_via:'s3-primary-v1'});
 // D1 batch ensures the asset row, pending scan job and audit entry agree.
 const inserted=await db().batch([
   q('INSERT OR IGNORE INTO assets VALUES (?,?,?,?,?,?,?,?,?,?)',b.asset_id,u.id,b.kind,
     b.content_type,b.size,digest,key,b.original_name,metadata,time),
   q("INSERT OR IGNORE INTO media_jobs (id,asset_id,status,created_at,updated_at) SELECT ?,?,'pending',?,? WHERE EXISTS (SELECT 1 FROM assets WHERE id=? AND owner_id=? AND storage_key=?)",
     crypto.randomUUID(),b.asset_id,time,time,b.asset_id,u.id,key),
   log(u.id,'asset.s3_primary_registered',b.asset_id,{kind:b.kind,size:b.size,sha256:digest,storage_key:key})
 ]);
 if(!inserted[0].meta.changes){
   const concurrent=await one('SELECT * FROM assets WHERE id=?',b.asset_id);
   if(!concurrent||concurrent.storage_key!==key||concurrent.owner_id!==u.id)fail(409,'Concurrent asset registration conflict.');
 }
 return json({id:b.asset_id,hash:digest,mime:b.content_type,size:b.size,
   storage_provider:'ovh-s3',storage_key:key,processing_state:'pending_scan',review_status:'pending'},201);
}
