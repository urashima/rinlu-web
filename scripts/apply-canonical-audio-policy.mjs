/** Patch the REAL canonical Site Worker to enforce D1 audio format policy.
 * Must be published inside the original ChatGPT Site / Cloudflare Worker,
 * independently of the OVH Docker mirror.
 */
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.argv[2]||'.platform-source/rinlu-player-source';
function once(text,old,update,label){
 const n=text.split(old).length-1;
 if(n!==1)throw Error('Canonical audio policy '+label+' changed ('+n+' matches)');
 return text.replace(old,update);
}
const file=join(root,'lib/media-service.ts');
let media=await readFile(file,'utf8');
media=once(media,
 'export function inspectMp3(a:Uint8Array,upload=false){',
 'export function inspectMp3(a:Uint8Array,upload=false,policy?:{minKbps:number;maxKbps:number;allowVbr:boolean}){',
 'inspector signature');
media=once(media,
 'let offset=0,frames=0,seconds=0,rate=0,channels=0,bitrate=0;',
 'let offset=0,frames=0,seconds=0,rate=0,channels=0,firstKbps=0,weightedKbps=0,vbr=false;',
 'bitrate counters');
media=once(media,
 'if(upload&&(version!==3||(kb!==192&&kb!==320)||(bitrate!==0&&bitrate!==kb)))throw Error("Unsupported upload bitrate");\n  bitrate=kb;',
 "if(firstKbps&&firstKbps!==kb)vbr=true;\n  if(!firstKbps)firstKbps=kb;",
 'remove CBR-only policy');
media=once(media,
 'rate=sr;channels=(a[offset+3]>>6)===3?1:2;seconds+=(version===3?1152:576)/sr;frames++;offset+=length;',
 'rate=sr;channels=(a[offset+3]>>6)===3?1:2;const frameSeconds=(version===3?1152:576)/sr;seconds+=frameSeconds;weightedKbps+=kb*frameSeconds;frames++;offset+=length;',
 'frame-weighted audio bitrate');
media=once(media,
 "if(offset!==a.length||frames<3||seconds<1||seconds>3602)throw Error('Invalid MP3 duration or trailing data');\n return {duration:seconds,sample_rate:rate,channels,frames};",
 "if(offset!==a.length||frames<3||seconds<1||seconds>3602)throw Error('Invalid MP3 duration or trailing data');\n const averageKbps=weightedKbps/seconds;\n if(upload){\n  const p=policy||{minKbps:128,maxKbps:320,allowVbr:true};\n  if(averageKbps+1e-7<p.minKbps||averageKbps-1e-7>p.maxKbps)throw Error('MP3 average audio bitrate is outside the permitted range.');\n  if(vbr&&!p.allowVbr)throw Error('VBR MP3 is not enabled.');\n }\n return {duration:seconds,sample_rate:rate,channels,frames,average_kbps:Math.round(averageKbps*100)/100,vbr};",
 'policy enforcement on completed stream');
await writeFile(file,media);
await copyFile('canonical-patch/lib/audio-upload-policy.ts',join(root,'lib/audio-upload-policy.ts'));

const server=join(root,'lib/server.ts');
let source=await readFile(server,'utf8');
source=once(source,
 "import {mediaService, createMediaJob, validatedAsset, inspectMp3} from './media-service';",
 "import {mediaService, createMediaJob, validatedAsset, inspectMp3} from './media-service';\nimport {audioUploadPolicy,audioUploadPolicyAdmin,publicAudioUploadPolicy} from './audio-upload-policy';",
 'policy import');
source=once(source,
 "const resource=p[0]||'';",
 "const resource=p[0]||'';\n   if(resource==='upload-policy'&&method==='GET')return json(await publicAudioUploadPolicy());\n   if(resource==='admin'&&p[1]==='audio-upload-policy')return audioUploadPolicyAdmin(req,admin(u));",
 'public/admin policy endpoint');
source=once(source,
 "try{inspectMp3(a,true);}catch{fail(415,'Upload an MP3 encoded at 192 kbps or 320 kbps.');}",
 "const accepted=await audioUploadPolicy();if(!accepted.formats.mp3.enabled)fail(415,'MP3 uploads are currently disabled.');\n     if(!/\\.mp3$/i.test(f.name))fail(415,'Only MP3 files are enabled.');\n     try{inspectMp3(a,true,accepted.formats.mp3);}catch{fail(415,'MP3 average bitrate must be within '+accepted.formats.mp3.minKbps+'–'+accepted.formats.mp3.maxKbps+' kbps'+(accepted.formats.mp3.allowVbr?' (CBR/VBR).':' (CBR only).'));}",
 'live upload acceptance');
await writeFile(server,source);
console.log('Canonical D1 live audio upload policy, admin and public endpoints patched and role-checked');
