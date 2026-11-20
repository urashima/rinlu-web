import {createHash} from 'node:crypto';
import {cp, mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';

const releaseDir = '.platform-source';
const source = releaseDir + '/rinlu-player-source';
const runtime = 'platform-runtime';
const releasePath = releaseDir + '/release.json';
const archivePath = releaseDir + '/release.tar.gz';
const release = JSON.parse(await readFile(releasePath, 'utf8'));
const sourceIndex = JSON.parse(await readFile(source + '/SOURCE-MANIFEST.json', 'utf8'));
const {size} = await stat(archivePath);

await rm(runtime, {recursive: true, force: true});
await mkdir(runtime, {recursive: true});
for (const file of ['server.mjs', 'Dockerfile']) {
  await cp(source + '/deployment/platform/' + file, runtime + '/' + file);
}
await cp(source + '/platform-dist', runtime + '/public', {recursive: true});

// OVH-only read-only mobile API: the canonical Sites/D1 source remains untouched.
// The gateway's additional corresponding source is published separately.
const brandSource=await readFile('scripts/apply-platform-brand.mjs','utf8');
const siteOverlaySource=await readFile('scripts/apply-platform-site.mjs','utf8');
const siteSettingsComponent=await readFile('scripts/site-console/site-share-admin.tsx','utf8');
const siteOverlayHash=createHash('sha256').update(siteOverlaySource).digest('hex');
const directOverlaySource=await readFile('scripts/apply-platform-direct.mjs','utf8');
const mp3OverlaySource=await readFile('scripts/apply-platform-mp3-upload.mjs','utf8');
const mp3PolicySource=await readFile('services/mp3-policy/mp3-upload-policy.ts','utf8');
const mp3OverlayHash=createHash('sha256').update(mp3OverlaySource+mp3PolicySource).digest('hex');
const directOverlayHash=createHash('sha256').update(directOverlaySource).digest('hex');
const brandOverlayHash=createHash('sha256').update(brandSource).digest('hex');
const mobileSource=await readFile('services/mobile-gateway/mobile-api.mjs','utf8');
const s3Source=await readFile('services/ovh-s3/s3.mjs','utf8');
const bridgeSource=await readFile('services/ovh-s3/storage-gateway.mjs','utf8');
const directSource=await readFile('services/ovh-s3/direct-storage.mjs','utf8');
const signingSource=await readFile('services/ovh-s3/signing.mjs','utf8');
const cdnSignerSource=await readFile('services/ovh-s3/cdn-signer.mjs','utf8');
const cdnWorkerSource=await readFile('services/ovh-s3/cdn-worker.mjs','utf8');
const gatewayPath=runtime+'/server.mjs', gatewayOriginal=await readFile(gatewayPath,'utf8');
const gatewayImport="import {pathToFileURL} from 'node:url';";
const gatewayServer=" return http.createServer(async(req,res)=>";
const gatewayProxy="  if(local.startsWith('/api/'))return await proxy(req,res,local+url.search);";
const gatewayMediaHeaders="for(const name of ['content-type','content-range','accept-ranges','etag','last-modified','content-disposition'])if(response.headers.has(name))res.setHeader(name,response.headers.get(name));";
if(!gatewayOriginal.includes(gatewayImport)||!gatewayOriginal.includes(gatewayServer)||
   !gatewayOriginal.includes(gatewayProxy)||!gatewayOriginal.includes(gatewayMediaHeaders)||gatewayOriginal.includes('createMobileApiHandler')) {
  throw Error('Canonical gateway changed; abort production packaging and reconcile overlay');
}
const gatewayPatched=gatewayOriginal
  .replace(gatewayImport,gatewayImport+"\nimport {createMobileApiHandler} from './mobile-api.mjs';\nimport {createOvhS3} from './ovh-s3.mjs';\nimport {createStorageGateway} from './storage-gateway.mjs';")
  .replace(gatewayServer," const mobileApi=createMobileApiHandler({backendOrigin});\n const s3Bridge=createStorageGateway({s3:createOvhS3(process.env),backendOrigin,publicOrigin,accountBearer});\n"+gatewayServer)
  .replace(gatewayProxy,
    "  if(local.startsWith('/api/mobile/v1/'))return await mobileApi(req,res,url,accountBearer(req),send);\n  if(local.startsWith('/api/')){if(s3Bridge&&await s3Bridge.handle(req,res,local,url))return;return await proxy(req,res,local+url.search);}" )
  .replace(gatewayMediaHeaders,gatewayMediaHeaders+"\n   if(path.startsWith('/api/media/')&&response.headers.has('content-length'))res.setHeader('Content-Length',response.headers.get('content-length'));");
// The sharing extension is independent of the canonical platform archive.
const shareStart=/ return http\.createServer\(async\(req,res\)=>\s*\{/;
if(!shareStart.test(gatewayPatched))throw Error('Canonical request handler changed; share extension not applied');
const shareGateway=gatewayPatched
 .replace(gatewayImport,gatewayImport+"\nimport {createSharePreview} from './share-preview.mjs';")
 .replace(gatewayServer," const shareHandler=createSharePreview({s3:createOvhS3(process.env),backendOrigin,publicOrigin,accountBearer});\n"+gatewayServer)
 .replace(shareStart,match=>match+"\n  if(await shareHandler(req,res))return;");
await writeFile(gatewayPath,shareGateway);
await cp('services/share-preview/share-preview.mjs',runtime+'/share-preview.mjs');
await writeFile(runtime+'/mobile-api.mjs',mobileSource);
await writeFile(runtime+'/ovh-s3.mjs',s3Source);
await writeFile(runtime+'/storage-gateway.mjs',bridgeSource);
await writeFile(runtime+'/direct-storage.mjs',directSource);
await writeFile(runtime+'/signing.mjs',signingSource);
await writeFile(runtime+'/cdn-signer.mjs',cdnSignerSource);
const dockerPath=runtime+'/Dockerfile',dockerOriginal=await readFile(dockerPath,'utf8');
const dockerAnchor='COPY --chown=node:node server.mjs ./server.mjs';
if(!dockerOriginal.includes(dockerAnchor)||dockerOriginal.includes('mobile-api.mjs')||dockerOriginal.includes('ovh-s3.mjs')) {
  throw Error('Canonical Dockerfile changed; abort production packaging');
}
await writeFile(dockerPath,dockerOriginal.replace(dockerAnchor,
  dockerAnchor+'\nCOPY --chown=node:node share-preview.mjs ./share-preview.mjs\nCOPY --chown=node:node mobile-api.mjs ./mobile-api.mjs\nCOPY --chown=node:node ovh-s3.mjs ./ovh-s3.mjs\nCOPY --chown=node:node storage-gateway.mjs ./storage-gateway.mjs\nCOPY --chown=node:node direct-storage.mjs ./direct-storage.mjs\nCOPY --chown=node:node signing.mjs ./signing.mjs\nCOPY --chown=node:node cdn-signer.mjs ./cdn-signer.mjs'));
const gatewayOverlayHash=createHash('sha256').update(shareGateway).digest('hex');
const enrichedRelease={...release,gateway_overlay_sha256:gatewayOverlayHash,
  gateway_overlay:'rinlu-mobile-api-v1-ovh-s3-v2',
  direct_overlay_sha256:directOverlayHash,
  direct_overlay:'s3-browser-direct-v1',
  mp3_upload_policy:'mp3-average-192kbps-cbr-vbr',
  mp3_upload_overlay_sha256:mp3OverlayHash,
  brand_overlay_sha256:brandOverlayHash,
  brand_overlay:'madimi-one-wordmark-v1',
  site_overlay_sha256:siteOverlayHash,
  site_overlay:'console-site-share-v1'};
await writeFile(runtime+'/public/_release.json',JSON.stringify(enrichedRelease)+'\n');


// Preserve the canonical platform build while adding the public legal footer link
// to the OVH-hosted client. Source manifest verification remains unchanged.
const indexPath = runtime + '/public/index.html';
const indexHtml = await readFile(indexPath, 'utf8');
if (!indexHtml.includes('</body>')) throw new Error('Built platform HTML has no closing body tag');
if (indexHtml.includes('privacy-footer.js')) throw new Error('Duplicate privacy footer injection');
await cp('scripts/privacy-footer.js', runtime + '/public/privacy-footer.js');
await writeFile(indexPath, indexHtml.replace('</body>', '<script defer src="/music/privacy-footer.js"></script>\n</body>'));


const destination = runtime + '/public/source';
await mkdir(destination, {recursive: true});
await cp(archivePath, destination + '/rinlu-player-source.tar.gz');
await cp('services/share-preview/share-preview.mjs',destination+'/share-preview.mjs');
await writeFile(destination+'/site-console-overlay.mjs',siteOverlaySource);
await writeFile(destination+'/site-console-overlay.sha256',siteOverlayHash+'  site-console-overlay.mjs\n');
await writeFile(destination+'/site-share-admin.tsx',siteSettingsComponent);
await writeFile(destination+'/brand-wordmark-overlay.mjs',brandSource);
await writeFile(destination+'/brand-wordmark-overlay.sha256',brandOverlayHash+'  brand-wordmark-overlay.mjs\n');
await writeFile(destination+'/mobile-api-gateway.mjs',mobileSource);
await writeFile(destination+'/mobile-api-gateway.sha256',
  createHash('sha256').update(mobileSource).digest('hex')+'  mobile-api-gateway.mjs\n');
await writeFile(destination+'/ovh-s3.mjs',s3Source);
await writeFile(destination+'/storage-gateway.mjs',bridgeSource);
await writeFile(destination+'/direct-storage.mjs',directSource);
await writeFile(destination+'/signing.mjs',signingSource);
await writeFile(destination+'/cdn-signer.mjs',cdnSignerSource);
await writeFile(destination+'/cdn-worker.mjs',cdnWorkerSource);
await writeFile(destination+'/browser-direct-overlay.mjs',directOverlaySource);
await writeFile(destination+'/mp3-upload-overlay.mjs',mp3OverlaySource);
await writeFile(destination+'/mp3-upload-policy.ts',mp3PolicySource);
await writeFile(destination+'/mp3-upload-policy.sha256',mp3OverlayHash+'  mp3-upload-policy-overlay\n');
await writeFile(destination+'/browser-direct-overlay.sha256',directOverlayHash+'  browser-direct-overlay.mjs\n');
await writeFile(destination+'/ovh-s3.sha256',createHash('sha256').update(s3Source).digest('hex')+'  ovh-s3.mjs\n');
await writeFile(destination+'/storage-gateway.sha256',createHash('sha256').update(bridgeSource).digest('hex')+'  storage-gateway.mjs\n');
await writeFile(destination+'/direct-storage.sha256',createHash('sha256').update(directSource).digest('hex')+'  direct-storage.mjs\n');
await writeFile(destination+'/signing.sha256',createHash('sha256').update(signingSource).digest('hex')+'  signing.mjs\n');
await writeFile(destination+'/cdn-signer.sha256',createHash('sha256').update(cdnSignerSource).digest('hex')+'  cdn-signer.mjs\n');
await writeFile(destination+'/cdn-worker.sha256',createHash('sha256').update(cdnWorkerSource).digest('hex')+'  cdn-worker.mjs\n');
await writeFile(destination + '/manifest.json', JSON.stringify({
  release: release.release,
  sha256: release.source_sha256,
  bytes: size,
  files: Object.keys(sourceIndex.files).length,
  url: '/source/rinlu-player-source.tar.gz',
}, null, 2) + '\n');

console.log('Packaged Docker platform', release.source_sha256);
