import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectMp3Upload} from './mp3-upload-policy.ts';
const rates={32:1,40:2,48:3,56:4,64:5,80:6,96:7,112:8,128:9,160:10,192:11,224:12,256:13,320:14};
function mp3(ratesPerFrame,{metadata=false,id3v1=false}={}){
 const frames=ratesPerFrame.map(kbps=>{
  const bi=rates[kbps];if(!bi)throw Error('Invalid test bitrate');
  const hz=44100,length=Math.floor(144000*kbps/hz);
  const frame=Buffer.alloc(length,0x00);
  frame[0]=0xff;frame[1]=0xfb;frame[2]=bi<<4;frame[3]=0;
  return frame;
 });
 const head=metadata?Buffer.from([73,68,51,4,0,0,0,0,4,0,...Buffer.alloc(512)]):Buffer.alloc(0);
 const tail=id3v1?Buffer.concat([Buffer.from('TAG'),Buffer.alloc(125)]):Buffer.alloc(0);
 return Buffer.concat([head,...frames,tail]);
}
const of=(rates,other)=>inspectMp3Upload(mp3(rates,other));
test('accepts MPEG-1 Layer III CBR 192, 224, 256 and 320kbps',()=>{
 for(const rate of [192,224,256,320]){
  const a=of(Array(60).fill(rate));
  assert.equal(a.averageKbps,rate);
  assert.equal(a.mode,'CBR');
  assert.equal(a.frames,60);
 }
});
test('accepts VBR whose actual duration-weighted average is 192kbps',()=>{
 const v=of(Array(60).fill(0).map((_,i)=>i%2?224:160));
 assert.equal(v.averageKbps,192);
 assert.equal(v.mode,'VBR');
});
test('accepts VBR >=192 even when its individual frames are below 192',()=>{
 const v=of([...Array(20).fill(128),...Array(40).fill(256)]);
 assert.equal(v.averageKbps,213.33);
 assert.equal(v.mode,'VBR');
});
test('rejects 128kbps CBR and 190kbps class VBR',()=>{
 assert.throws(()=>of(Array(60).fill(128)),/at least 192/);
 assert.throws(()=>of([...Array(25).fill(160),...Array(35).fill(192)]),/at least 192/);
});
test('does not count large ID3 artwork as audio bitrate',()=>{
 assert.throws(()=>of(Array(60).fill(128),{metadata:true,id3v1:true}),/at least 192/);
 const a=of(Array(60).fill(256),{metadata:true,id3v1:true});
 assert.equal(a.averageKbps,256);
});
test('rejects fake MP3, missing frame, truncated frame, and format confusion',()=>{
 assert.throws(()=>inspectMp3Upload(new Uint8Array(2048)),/supported MPEG-1/);
 const good=mp3(Array(60).fill(256));
 assert.throws(()=>inspectMp3Upload(good.subarray(0,good.length-2)),/incomplete/);
 const bad=Buffer.from(good);bad[1]=0xf3;
 assert.throws(()=>inspectMp3Upload(bad),/supported MPEG-1/);
});
