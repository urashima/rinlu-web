/** Patch the independently hosted RINLU Site backend's MP3 upload policy.
 * This changes ONLY bitrate admission: MPEG-1 Layer III MP3 whose real
 * duration-weighted average audio bitrate >=192kbps, CBR or VBR.
 * Existing limits, malware scanning, role checks and moderation remain.
 * This script cannot publish the independent Site backend by itself.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function applyCanonicalMp3Policy(root){
 const mpath=join(root,'lib/media-service.ts');
 const spath=join(root,'lib/server.ts');
 const current=await readFile(mpath,'utf8');
 let media=current;
 const once=(old,next,label)=>{
  const count=media.split(old).length-1;
  if(count!==1)throw Error('MP3 backend '+label+' changed, found '+count+' matches');
  media=media.replace(old,next);
 };
 once(
  'let offset=0,frames=0,seconds=0,rate=0,channels=0,bitrate=0;',
  'let offset=0,frames=0,seconds=0,rate=0,channels=0,weightedBitrate=0;',
  'frame counter'
 );
 once(
  'if(upload&&(version!==3||(kb!==192&&kb!==320)||(bitrate!==0&&bitrate!==kb)))throw Error("Unsupported upload bitrate");',
  "if(upload&&version!==3)throw Error('MPEG-1 Layer III MP3 is required for high-bitrate uploads.');",
  'remove hard-coded CBR-only 192/320 restriction'
 );
 once('  bitrate=kb;\n','', 'obsolete per-frame CBR comparison');
 once(
  'rate=sr;channels=(a[offset+3]>>6)===3?1:2;seconds+=(version===3?1152:576)/sr;frames++;offset+=length;',
  'rate=sr;channels=(a[offset+3]>>6)===3?1:2;const frameDuration=(version===3?1152:576)/sr;seconds+=frameDuration;weightedBitrate+=kb*frameDuration;frames++;offset+=length;',
  'average actual MPEG bitrate'
 );
 once(
  "if(offset!==a.length||frames<3||seconds<1||seconds>3602)throw Error('Invalid MP3 duration or trailing data');",
  "if(offset!==a.length||frames<3||seconds<1||seconds>3602)throw Error('Invalid MP3 duration or trailing data');\n  if(upload&&weightedBitrate/seconds+1e-7<192)throw Error('MP3 average bitrate must be >= 192 kbps');",
  'enforce 192kbps minimum without rejecting VBR'
 );
 let server=await readFile(spath,'utf8');
 const oldHint="Upload an MP3 encoded at 192 kbps or 320 kbps.";
 if(server.split(oldHint).length-1!==1)throw Error('Canonical MP3 upload error text changed');
 server=server.replace(oldHint,'Upload an MP3 with an average audio bitrate of at least 192 kbps (CBR or VBR).');
 await writeFile(mpath,media);
 await writeFile(spath,server);
 console.log('Canonical RINLU MP3 >=192kbps CBR/VBR policy ready for independent Site publication');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 await applyCanonicalMp3Policy(process.argv[2]||'.platform-source/rinlu-player-source');
}
