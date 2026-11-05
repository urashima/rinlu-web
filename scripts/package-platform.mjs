import {cp,mkdir,rm,readFile} from 'node:fs/promises';
const source='.platform-source/rinlu-player-source';await rm('platform-runtime',{recursive:true,force:true});await mkdir('platform-runtime',{recursive:true});
for(const file of ['server.mjs','Dockerfile'])await cp(source+'/deployment/platform/'+file,'platform-runtime/'+file);
await cp(source+'/platform-dist','platform-runtime/public',{recursive:true});await cp('.platform-source/release.json','platform-runtime/public/_release.json');
console.log('Packaged Docker platform',JSON.parse(await readFile('.platform-source/release.json','utf8')).source_sha256);
