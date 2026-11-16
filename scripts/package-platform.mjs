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
await cp(releasePath, runtime + '/public/_release.json');

const destination = runtime + '/public/source';
await mkdir(destination, {recursive: true});
await cp(archivePath, destination + '/rinlu-player-source.tar.gz');
await writeFile(destination + '/manifest.json', JSON.stringify({
  release: release.release,
  sha256: release.source_sha256,
  bytes: size,
  files: Object.keys(sourceIndex.files).length,
  url: '/source/rinlu-player-source.tar.gz',
}, null, 2) + '\n');

console.log('Packaged Docker platform', release.source_sha256);
