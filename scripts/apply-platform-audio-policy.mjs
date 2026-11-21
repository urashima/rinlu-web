/** Extend the EXISTING Platform Console / Site settings without new route.
 * Client upload constraints read live canonical D1 /api/upload-policy per file.
 */
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function applyPlatformAudioPolicy(root){
 const admin=join(root,'app/site-font-admin.tsx');
 let settings=await readFile(admin,'utf8');
 function one(text,search,replacement,label){
  const n=text.split(search).length-1;
  if(n!==1)throw Error('Canonical audio policy '+label+' changed ('+n+' matches)');
  return text.replace(search,replacement);
 }
 if(!settings.includes('<AudioUploadPolicyAdmin/>')){
 settings=one(settings,
  "import {SiteShareAdmin} from './site-share-admin';",
  "import {SiteShareAdmin} from './site-share-admin';\nimport {AudioUploadPolicyAdmin} from './audio-upload-policy-admin';",
  'console import');
 settings=one(settings,
  '<SiteShareAdmin/>',
  '<SiteShareAdmin/>\n  <AudioUploadPolicyAdmin/>',
  'Platform Console settings section');
 await writeFile(admin,settings);
 await copyFile('scripts/site-console/audio-upload-policy-admin.tsx',join(root,'app/audio-upload-policy-admin.tsx'));

 }

 const file=join(root,'app/rinlu.tsx');
 let source=await readFile(file,'utf8');
 if(source.includes('const quality=inspectMp3Upload(')){
  await readFile(join(root,'lib/mp3-upload-admission.ts'));
  return;
 }
 source=one(source,
  "import {compressArtwork} from '../lib/compress-artwork';",
  "import {compressArtwork} from '../lib/compress-artwork';\nimport {inspectMp3Upload} from '../lib/mp3-upload-admission';",
  'creator import');
 source=one(source,
  "async function analyze(file:File){if(file.size>25*1024*1024)",
  "async function analyze(file:File){if(!/\\.mp3$/i.test(file.name))throw Error('Only MP3 uploads are enabled.');if(file.size>25*1024*1024)",
  'MP3-only input');
 source=one(source,
  "const context=new AudioContext();try{const buffer=await context.decodeAudioData(await file.arrayBuffer());",
  "const policyResponse=await fetch(platformUrl('/api/upload-policy'),{credentials:'same-origin',cache:'no-store'});if(!policyResponse.ok)throw Error('The audio upload policy is unavailable. Please retry.');const policy=await policyResponse.json();const mp3=policy?.formats?.mp3;if(!mp3?.enabled)throw Error('MP3 uploads are disabled by the platform administrator.');const inputBytes=await file.arrayBuffer();const quality=inspectMp3Upload(new Uint8Array(inputBytes),mp3);const context=new AudioContext();try{const buffer=await context.decodeAudioData(inputBytes);",
  'live policy and upload preflight');
 source=one(source,
  "rms:Math.sqrt(sum/count)};",
  "rms:Math.sqrt(sum/count),bitrateKbps:quality.averageKbps,bitrateMode:quality.mode};",
  'show audio quality');
 source=one(source,
  "Try a 192 or 320 kbps MP3 file.",
  "Try an MP3 file accepted by the current upload bitrate policy.",
  'decoder hint');
 source=one(source,
  'MP3 · 192 or 320 kbps · Up to 25 MB',
  'MP3 · Current bitrate policy applies · Up to 25 MB',
  'upload hint');
 source=one(source,
  '{tr(" dBFS")}</p>',
  '{tr(" dBFS")} · {meta.bitrateKbps} kbps {meta.bitrateMode}</p>',
  'audio bitrate visual feedback');
 await writeFile(file,source);
 await copyFile('services/audio-policy/mp3-inspect.ts',join(root,'lib/mp3-upload-admission.ts'));
 console.log('RINLU Platform Console live audio admission + browser MP3 preflight applied');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 await applyPlatformAudioPolicy(process.argv[2]||'.platform-source/rinlu-player-source');
}
