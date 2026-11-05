/** Retrieve the exact public, AGPL corresponding-source release. No credentials. */
import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile,rm,cp} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const origin='https://sonora-independent-music.kai-ma.chatgpt.site';
const manifest=await fetch(origin+'/source/manifest.json?release='+Date.now()).then(r=>{if(!r.ok)throw Error('Release manifest unavailable');return r.json()});
if(!/^[a-f0-9]{64}$/.test(manifest.sha256)||manifest.url!=='/source/rinlu-player-source.tar.gz')throw Error('Invalid release manifest');
let current;try{current=await fetch('https://rinlu.com/music/_release.json',{signal:AbortSignal.timeout(10000)}).then(r=>r.ok?r.json():null)}catch{}
if(process.env.GITHUB_EVENT_NAME==='schedule'&&current?.source_sha256===manifest.sha256){await writeFile(process.env.GITHUB_OUTPUT,'changed=false\n',{flag:'a'});console.log('Both sites already share release',manifest.sha256);process.exit(0)}
await mkdir('.platform-source',{recursive:true});const archive=Buffer.from(await fetch(origin+manifest.url+'?sha='+manifest.sha256).then(r=>{if(!r.ok)throw Error('Source unavailable');return r.arrayBuffer()}));
if(archive.length!==manifest.bytes||createHash('sha256').update(archive).digest('hex')!==manifest.sha256)throw Error('Archive checksum mismatch');
await writeFile('.platform-source/release.tar.gz',archive);
execFileSync('python3',['-c',`import tarfile
with tarfile.open('.platform-source/release.tar.gz') as t:
 for m in t.getmembers():
  if not (m.name == 'rinlu-player-source' and m.isdir() or m.name.startswith('rinlu-player-source/')) or m.issym() or m.islnk() or m.isdev() or '..' in m.name.split('/'): raise ValueError('Unsafe source archive')
 t.extractall('.platform-source',filter='data')`]);
const source='.platform-source/rinlu-player-source',index=JSON.parse(await readFile(source+'/SOURCE-MANIFEST.json','utf8'));
for(const [path,sha]of Object.entries(index.files)){if(path.startsWith('/')||path.split('/').includes('..'))throw Error('Unsafe manifest path');if(createHash('sha256').update(await readFile(source+'/'+path)).digest('hex')!==sha)throw Error('Source file checksum mismatch: '+path)}
await writeFile('.platform-source/release.json',JSON.stringify({release:manifest.release,source_sha256:manifest.sha256,published_at:new Date().toISOString(),backend:origin})+'\n');
if(process.env.GITHUB_OUTPUT)await writeFile(process.env.GITHUB_OUTPUT,'changed=true\n',{flag:'a'});
console.log('Verified canonical platform source',manifest.sha256,'files',Object.keys(index.files).length);
