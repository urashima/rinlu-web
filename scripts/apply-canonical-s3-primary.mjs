/** Offline, deterministic canonical Site backend S3-only patch.
 * Run against the exact published corresponding-source tree. Does not publish
 * to the independent Cloudflare Worker / D1 Site by itself.
 */
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {applyCanonicalMp3Policy} from './apply-canonical-mp3-policy.mjs';
const root=process.argv[2]||'.platform-source/rinlu-player-source';
async function replaceFile(rel,patch){
 const file=join(root,rel);let source=await readFile(file,'utf8');
 const original=source;source=patch(source);
 if(source===original)throw Error('No canonical changes were applied to '+rel);
 await writeFile(file,source);
 console.log('Canonical S3 primary prepared:',rel);
}
function once(source,needle,replacement,label){
 const count=source.split(needle).length-1;
 if(count!==1)throw Error('Canonical source anchor changed: '+label+' (matches='+count+')');
 return source.replace(needle,replacement);
}
await copyFile('canonical-patch/lib/s3-primary.ts',join(root,'lib/s3-primary.ts'));
await copyFile('canonical-patch/lib/s3-primary-service.ts',join(root,'lib/s3-primary-service.ts'));
await copyFile('canonical-patch/lib/media-storage.ts',join(root,'lib/media-storage.ts'));
await replaceFile('lib/server.ts',source=>{
 source=once(source,"import {mediaStorage} from './media-storage';",
   "import {mediaStorage} from './media-storage';\nimport {s3PrimaryRoute} from './s3-primary';",'S3 metadata route import');
 const handler="const u=await user(req);const method=req.method;const url=new URL(req.url);const resource=p[0]||'';";
 source=once(source,handler,handler+"const result=await s3PrimaryRoute(req,p,u);if(result)return result;",'canonical route dispatch');
 const upload="if(resource==='upload'&&method==='POST'){";
 source=once(source,upload,upload+
   "    if((env as any).RINLU_S3_ONLY==='1')fail(426,'Legacy R2 uploads are disabled. Upload directly to OVH S3.');\n",
   'disable R2 upload entry');
 const processed="if(processed)asset={...asset,storage_key:processed.output_key,size:processed.output_size,mime:'audio/mpeg'};";
 source=once(source,processed,processed+
   "else if(asset?.storage_key?.startsWith('originals/'))fail(503,'S3 recording is awaiting a clean malware scan.');",
   'require clean scanned S3 playback');
 const art="const variant=JSON.parse(a!.metadata).normalized_jpeg?null:await mediaStorage.get(artworkJpegKey(a!.id));";
 source=once(source,art,[
   "    if(a!.storage_key.startsWith('originals/')){",
   "     const processed=await one(\"SELECT output_key FROM media_jobs WHERE asset_id=? AND status='complete' AND scan='clean'\",a!.id);",
   "     if(!processed?.output_key)fail(404,'S3 artwork is still being scanned.');",
   "     const image=await mediaStorage.get(processed.output_key);if(!image)fail(404,'Processed artwork is unavailable.');",
   "     return new Response(image.body,{headers:{'Content-Type':'image/jpeg','Content-Length':String(image.size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});",
   "    }",
   art
 ].join('\n'),'scanned private/public JPEG route');
 const original="const a=await one('SELECT * FROM assets WHERE id=? AND owner_id=?',p[1],account.id);if(!a)fail(404,'File not found.');const o=await mediaStorage.get(a!.storage_key);";
 source=once(source,original,"const a=await one('SELECT * FROM assets WHERE id=? AND owner_id=?',p[1],account.id);if(!a)fail(404,'File not found.');if(a!.storage_key.startsWith('originals/')&&!await one(\"SELECT id FROM media_jobs WHERE asset_id=? AND status='complete' AND scan='clean'\",a!.id))fail(403,'The S3 original is awaiting a clean scan.');const o=await mediaStorage.get(a!.storage_key);",'block S3 unscanned original download');
 const manual="if(b.action==='approve'&&!t.is_demo){const asset=await validatedAsset(t.asset_id);if(!asset){";
 source=once(source,manual,manual+
   "if((await one('SELECT storage_key FROM assets WHERE id=?',t.asset_id))?.storage_key?.startsWith('originals/'))fail(409,'S3 recordings require a completed clean scan before approval.');",
   'prevent private beta manual S3 malware scan bypass');
 return source;
});
await replaceFile('lib/media-service.ts',source=>{
 const start="import {mediaStorage} from './media-storage';";
 source=once(source,start,start+"\nimport {s3Complete,s3JobClaim,s3AnalysisClaim} from './s3-primary-service';",'import S3 leased media service');
 const analysisQuery="SELECT id,output_hash FROM media_jobs WHERE status='complete'";
 source=once(source,analysisQuery,"SELECT id,output_hash,output_key FROM media_jobs WHERE status='complete'",'analysis queue provider keys');
 const claim="return json({job:job?{id:job.id,hash:job.output_hash,input:'/api/service/analysis-input/'+job.id+'?hash='+encodeURIComponent(job.output_hash),complete:'/api/service/analysis-complete/'+job.id}:null});";
 source=once(source,claim,"return json({job:job?{id:job.id,hash:job.output_hash,input:'/api/service/analysis-input/'+job.id+'?hash='+encodeURIComponent(job.output_hash),complete:'/api/service/analysis-complete/'+job.id,...(s3AnalysisClaim(job)||{})}:null});",'S3 direct audio analysis');
 const leaseClaim="return json({job:{id:j.id,lease,input:'/api/service/input/'+j.id,complete:'/api/service/complete/'+j.id,fail:'/api/service/fail/'+j.id}});";
 source=once(source,leaseClaim,"const asset=await one('SELECT * FROM assets WHERE id=?',j.asset_id);const s3=asset?s3JobClaim(j,asset):null;return json({job:{id:j.id,lease,input:'/api/service/input/'+j.id,complete:'/api/service/complete/'+j.id,fail:'/api/service/fail/'+j.id,...(s3||{})}});",'S3 original/processed job claim');
 const heartbeat="scanner:z.literal('ready'),version:z.string().max(100)";
 source=once(source,heartbeat,"scanner:z.literal('ready'),version:z.string().max(100),s3_primary:z.literal('ready').optional()", 'private S3 scanner heartbeat capability');
 const complete="const j=await leased(req,p[2]);if(Number(req.headers.get('content-length')||0)>35*1024*1024)";
 source=once(source,complete,"const j=await leased(req,p[2]);if(j.storage_key?.startsWith('originals/'))return await s3Complete(req,j,inspectMp3);if(Number(req.headers.get('content-length')||0)>35*1024*1024)",'S3 metadata-only scanned job completion');
 return source;
});
await applyCanonicalMp3Policy(root);
console.log('Canonical S3-only D1 routes and R2 read-only legacy compatibility ready for independent Site deployment');
