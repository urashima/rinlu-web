/** Regression-check the EXACT canonical MP3 validator after applying D1 patch.
 * No storage or network access; verifies that no hard-coded 192/320 remains.
 */
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=process.argv[2]||'.platform-source/rinlu-player-source';
const media=await readFile(root+'/lib/media-service.ts','utf8');
const start=media.indexOf('export function inspectMp3('),end=media.indexOf('\nasync function leased(',start);
if(start<0||end<=start)throw Error('Canonical inspectMp3 source changed');
const extracted=media.slice(start,end);
const js=extracted.replace(/^export function inspectMp3\([^\n]*\)\{/,'export function inspectMp3(a,upload=false,policy){');
if(js===extracted||js.includes(':Uint8Array'))throw Error('Cannot isolate canonical MP3 inspector');
const {inspectMp3}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const bi={64:5,96:7,112:8,128:9,160:10,192:11,224:12,256:13,320:14};
function mp3(rates){
 const frames=rates.map(k=>{
  const b=Buffer.alloc(Math.floor(144000*k/44100));
  b[0]=255;b[1]=251;b[2]=bi[k]<<4;b[3]=0;return b;
 });
 return new Uint8Array(Buffer.concat(frames));
}
const policy={minKbps:128,maxKbps:320,allowVbr:true};
for(const rate of [128,160,192,224,256,320]){
 const result=inspectMp3(mp3(Array(60).fill(rate)),true,policy);
 assert.equal(result.average_kbps,rate);
}
const vbr=inspectMp3(mp3([...Array(30).fill(96),...Array(30).fill(160)]),true,policy);
assert.equal(vbr.average_kbps,128);assert.equal(vbr.vbr,true);
assert.throws(()=>inspectMp3(mp3(Array(60).fill(96)),true,policy),/bitrate/);
assert.throws(()=>inspectMp3(mp3([...Array(30).fill(96),...Array(30).fill(160)]),true,{...policy,allowVbr:false}),/VBR/);
assert.throws(()=>inspectMp3(mp3(Array(60).fill(128)),true,{...policy,minKbps:192}),/bitrate/);
assert.doesNotThrow(()=>inspectMp3(mp3(Array(60).fill(96)),false),'processed rendition check should remain structural, not enforce upload policy');
const server=await readFile(root+'/lib/server.ts','utf8');
for(const needle of ['audioUploadPolicyAdmin(req,admin(await user(req)))',"p[0]==='upload-policy'&&req.method==='GET'","inspectMp3(a,true,accepted.formats.mp3)"]){
 assert.ok(server.includes(needle),'Missing live D1 policy route or upload check: '+needle);
}
const adm=await readFile(root+'/app/site-font-admin.tsx','utf8');
assert.ok(adm.includes('<AudioUploadPolicyAdmin/>'));
const editor=await readFile(root+'/app/audio-upload-policy-admin.tsx','utf8');
assert.ok(editor.includes('expected_revision')&&editor.includes("method:'PUT'"));
console.log('Real canonical D1 upload accepts default MP3 >=128 CBR/VBR and rejects changed rules.');
