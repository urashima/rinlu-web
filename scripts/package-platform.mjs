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
const mobileSource=await readFile('services/mobile-gateway/mobile-api.mjs','utf8');
const gatewayPath=runtime+'/server.mjs', gatewayOriginal=await readFile(gatewayPath,'utf8');
const gatewayImport="import {pathToFileURL} from 'node:url';";
const gatewayServer=" return http.createServer(async(req,res)=>";
const gatewayProxy="  if(local.startsWith('/api/'))return await proxy(req,res,local+url.search);";
if(!gatewayOriginal.includes(gatewayImport)||!gatewayOriginal.includes(gatewayServer)||
   !gatewayOriginal.includes(gatewayProxy)||gatewayOriginal.includes('createMobileApiHandler')) {
  throw Error('Canonical gateway changed; abort production packaging and reconcile overlay');
}
const gatewayPatched=gatewayOriginal
  .replace(gatewayImport,gatewayImport+"\nimport {createMobileApiHandler} from './mobile-api.mjs';")
  .replace(gatewayServer," const mobileApi=createMobileApiHandler({backendOrigin});\n"+gatewayServer)
  .replace(gatewayProxy,
    "  if(local.startsWith('/api/mobile/v1/'))return await mobileApi(req,res,url,accountBearer(req),send);\n"+gatewayProxy);
await writeFile(gatewayPath,gatewayPatched);
await writeFile(runtime+'/mobile-api.mjs',mobileSource);
const dockerPath=runtime+'/Dockerfile',dockerOriginal=await readFile(dockerPath,'utf8');
const dockerAnchor='COPY --chown=node:node server.mjs ./server.mjs';
if(!dockerOriginal.includes(dockerAnchor)||dockerOriginal.includes('mobile-api.mjs')) {
  throw Error('Canonical Dockerfile changed; abort production packaging');
}
await writeFile(dockerPath,dockerOriginal.replace(dockerAnchor,
  dockerAnchor+'\nCOPY --chown=node:node mobile-api.mjs ./mobile-api.mjs'));
const gatewayOverlayHash=createHash('sha256').update(gatewayPatched).digest('hex');
const enrichedRelease={...release,gateway_overlay_sha256:gatewayOverlayHash,
  gateway_overlay:'rinlu-mobile-api-v1'};
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
await writeFile(destination+'/mobile-api-gateway.mjs',mobileSource);
await writeFile(destination+'/mobile-api-gateway.sha256',
  createHash('sha256').update(mobileSource).digest('hex')+'  mobile-api-gateway.mjs\n');
await writeFile(destination + '/manifest.json', JSON.stringify({
  release: release.release,
  sha256: release.source_sha256,
  bytes: size,
  files: Object.keys(sourceIndex.files).length,
  url: '/source/rinlu-player-source.tar.gz',
}, null, 2) + '\n');

console.log('Packaged Docker platform', release.source_sha256);
