import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectMp3Upload,defaultMp3Admission} from './mp3-inspect.ts';

const indexes={64:5,96:7,112:8,128:9,160:10,192:11,224:12,256:13,320:14};
function fakeMp3(rates,opts={}){
 const frames=rates.map(kbps=>{
  const bi=indexes[kbps];if(!bi)throw Error('Invalid test bitrate');
  const bytes=Buffer.alloc(Math.floor(144000*kbps/44100));
  bytes[0]=0xff;bytes[1]=0xfb;bytes[2]=bi<<4;bytes[3]=0;
  return bytes;
 });
 const id3=opts.metadata?Buffer.from([73,68,51,4,0,0,0,0,8,0,...Buffer.alloc(1024)]):Buffer.alloc(0);
 const id3v1=opts.tail?Buffer.concat([Buffer.from('TAG'),Buffer.alloc(125)]):Buffer.alloc(0);
 return new Uint8Array(Buffer.concat([id3,...frames,id3v1]));
}
function inspect(rates,policy=defaultMp3Admission,opts={}){
 return inspectMp3Upload(fakeMp3(rates,opts),policy);
}
test('default MP3 min bitrate is 128kbps and accepts CBR 128-320',()=>{
 assert.deepEqual(defaultMp3Admission,{enabled:true,minKbps:128,maxKbps:320,allowVbr:true});
 for(const kb of [128,160,192,224,256,320]){
  const a=inspect(Array(60).fill(kb));
  assert.equal(a.averageKbps,kb);assert.equal(a.mode,'CBR');
 }
});
test('accepts VBR whose duration-weighted average is exactly 128kbps',()=>{
 const a=inspect([...Array(30).fill(96),...Array(30).fill(160)]);
 assert.equal(a.averageKbps,128);assert.equal(a.mode,'VBR');
});
test('accepts variable 128kbps recording with ID3 artwork that does not count toward bitrate',()=>{
 const a=inspect([...Array(30).fill(96),...Array(30).fill(160)],defaultMp3Admission,{metadata:true,tail:true});
 assert.equal(a.averageKbps,128);
});
test('rejects CBR below configured min bitrate, and VBR average below configured min',()=>{
 assert.throws(()=>inspect(Array(60).fill(96)),/average bitrate/);
 assert.throws(()=>inspect([...Array(20).fill(96),...Array(40).fill(112)]),/average bitrate/);
});
test('saved policy takes effect when minimum, maximum, VBR flag or enabled changes',()=>{
 const strict={enabled:true,minKbps:192,maxKbps:256,allowVbr:false};
 assert.throws(()=>inspect(Array(60).fill(128),strict),/average bitrate/);
 assert.doesNotThrow(()=>inspect(Array(60).fill(192),strict));
 assert.doesNotThrow(()=>inspect(Array(60).fill(256),strict));
 assert.throws(()=>inspect(Array(60).fill(320),strict),/average bitrate/);
 assert.throws(()=>inspect([...Array(30).fill(160),...Array(30).fill(224)],strict),/Variable bitrate/);
 assert.throws(()=>inspect(Array(60).fill(192),{...strict,enabled:false}),/temporarily disabled/);
});
test('rejects fake headers, truncated audio and trailing garbage',()=>{
 assert.throws(()=>inspectMp3Upload(new Uint8Array(5000)),/Invalid MPEG/);
 const good=fakeMp3(Array(60).fill(192));
 assert.throws(()=>inspectMp3Upload(good.subarray(0,good.length-4)),/truncated/);
 const extra=Buffer.concat([Buffer.from(good),Buffer.from('garbage')]);
 assert.throws(()=>inspectMp3Upload(extra),/Invalid MPEG|duration or trailing/);
});
