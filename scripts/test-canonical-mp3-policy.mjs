/** Test the ACTUAL patched canonical Site inspectMp3() logic in isolation.
 * Does not require Site auth, D1, Cloudflare Worker, or real music files.
 */
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=process.argv[2]||'.platform-source/rinlu-player-source';
const source=await readFile(root+'/lib/media-service.ts','utf8');
const start=source.indexOf('export function inspectMp3('),end=source.indexOf('\nasync function leased(',start);
if(start<0||end<0||end<=start)throw Error('Canonical inspectMp3 source anchor changed');
const actual=source.slice(start,end).replace('a:Uint8Array','a');
if(actual.includes(':Uint8Array'))throw Error('Unexpected TypeScript inspectMp3 signature');
const {inspectMp3}=await import('data:text/javascript;base64,'+Buffer.from(actual).toString('base64'));
const index={128:9,160:10,192:11,224:12,256:13,320:14};
function make(tracks){
 const frames=tracks.map(kbps=>{
  const n=index[kbps];
  if(!n)throw Error('Invalid test input');
  const bytes=Buffer.alloc(Math.floor(144000*kbps/44100));
  bytes[0]=255;bytes[1]=251;bytes[2]=n<<4;bytes[3]=0;
  return bytes;
 });
 return new Uint8Array(Buffer.concat(frames));
}
for(const rate of [192,224,256,320])assert.doesNotThrow(()=>inspectMp3(make(Array(60).fill(rate)),true));
assert.doesNotThrow(()=>inspectMp3(make(Array(60).fill(0).map((_,i)=>i%2===0?160:224)),true));
assert.doesNotThrow(()=>inspectMp3(make([...Array(20).fill(128),...Array(40).fill(256)]),true));
for(const rates of [Array(60).fill(128),Array(60).fill(160),[...Array(30).fill(160),...Array(30).fill(192)]]){
 assert.throws(()=>inspectMp3(make(rates),true),/bitrate/);
}
assert.doesNotThrow(()=>inspectMp3(make(Array(60).fill(128)),false),'output processor may validate lower-bitrate renditions');
console.log('Verified canonical MP3 input policy: 192/224/256/320 CBR + >=192 avg VBR; lower rates rejected');
