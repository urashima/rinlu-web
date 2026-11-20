/** MP3 >=192kbps (CBR or VBR) creator UI overlay.
 * Applied only to checksum-verified canonical RINLU Site sources.
 * The separately hosted canonical Worker must be updated independently.
 */
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function applyPlatformMp3Policy(root){
 const file=join(root,'app/rinlu.tsx');
 let body=await readFile(file,'utf8');
 const once=(old,next,label)=>{
  const n=body.split(old).length-1;
  if(n!==1)throw Error('Canonical MP3 '+label+' changed: '+n+' matches');
  body=body.replace(old,next);
 };
 once(
  "import {compressArtwork} from '../lib/compress-artwork';",
  "import {compressArtwork} from '../lib/compress-artwork';\nimport {inspectMp3Upload} from '../lib/mp3-upload-policy';",
  'import'
 );
 once(
  "async function analyze(file:File){if(file.size>25*1024*1024)",
  "async function analyze(file:File){if(!/\\.mp3$/i.test(file.name))throw Error('Upload an MP3 file.');if(file.size>25*1024*1024)",
  'file extension'
 );
 once(
  "const context=new AudioContext();try{const buffer=await context.decodeAudioData(await file.arrayBuffer());",
  "const data=await file.arrayBuffer();const quality=inspectMp3Upload(new Uint8Array(data));const context=new AudioContext();try{const buffer=await context.decodeAudioData(data);",
  'codec validation before audio decoding'
 );
 once(
  "rms:Math.sqrt(sum/count)};",
  "rms:Math.sqrt(sum/count),bitrateKbps:quality.averageKbps,bitrateMode:quality.mode};",
  'display quality statistics'
 );
 once(
  "Try a 192 or 320 kbps MP3 file.",
  "Try an MP3 with an average audio bitrate of at least 192 kbps.",
  'decode advice'
 );
 once(
  'MP3 · 192 or 320 kbps · Up to 25 MB',
  'MP3 · 192 kbps or higher · CBR / VBR · Up to 25 MB',
  'creator upload hint'
 );
 once(
  '{tr(" dBFS")}</p>',
  '{tr(" dBFS")} · {meta.bitrateKbps} kbps {meta.bitrateMode}</p>',
  'bitrate metadata readout'
 );
 await copyFile('services/mp3-policy/mp3-upload-policy.ts',join(root,'lib/mp3-upload-policy.ts'));
 await writeFile(file,body);
 console.log('RINLU MP3 >=192kbps CBR/VBR creator UI overlay applied');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 await applyPlatformMp3Policy(process.argv[2]||'.platform-source/rinlu-player-source');
}
