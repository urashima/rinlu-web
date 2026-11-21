/** MP3 frame parser for browser-side preflight, independent of file size
 * and embedded ID3 artwork. Server always runs its own equivalent check.
 */
export type Mp3Admission={enabled:boolean;minKbps:number;maxKbps:number;allowVbr:boolean};
export const defaultMp3Admission:Mp3Admission={
 enabled:true,minKbps:128,maxKbps:320,allowVbr:true
};
export function inspectMp3Upload(bytes:Uint8Array,config:Mp3Admission=defaultMp3Admission){
 if(!config.enabled)throw Error('MP3 uploads are temporarily disabled.');
 if(!Number.isInteger(config.minKbps)||!Number.isInteger(config.maxKbps)||
    config.minKbps<32||config.maxKbps>320||config.minKbps>config.maxKbps)throw Error('Invalid MP3 admission settings.');
 if(!(bytes instanceof Uint8Array)||bytes.length<100)throw Error('Choose a valid MP3 file.');
 let offset=0;
 if(bytes[0]===0x49&&bytes[1]===0x44&&bytes[2]===0x33){
  if(bytes.length<10||(bytes[5]&0x10)||[bytes[6],bytes[7],bytes[8],bytes[9]].some(v=>v>127))throw Error('Unsupported MP3 ID3 header.');
  offset=10+((bytes[6]<<21)|(bytes[7]<<14)|(bytes[8]<<7)|bytes[9]);
 }
 let frames=0,duration=0,weighted=0,sampleRate=0,firstKbps=0,vbr=false;
 while(offset+4<=bytes.length){
  if(bytes.length-offset===128&&bytes[offset]===84&&bytes[offset+1]===65&&bytes[offset+2]===71){
   offset=bytes.length;break;
  }
  const b=bytes[offset+1],c=bytes[offset+2],version=(b>>3)&3,layer=(b>>1)&3,index=c>>4,si=(c>>2)&3;
  if(bytes[offset]!==255||(b&224)!==224||version===1||layer!==1||index===0||index===15||si===3)throw Error('Invalid MPEG Layer III frame.');
  const sr=[44100,48000,32000][si]/(version===3?1:version===2?2:4);
  const kb=(version===3?[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]:
   [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[index];
  const length=Math.floor((version===3?144000:72000)*kb/sr)+((c>>1)&1);
  if(length<24||offset+length>bytes.length)throw Error('MP3 frames are truncated.');
  if(sampleRate&&sampleRate!==sr)throw Error('MP3 sample rate changes mid-recording.');
  const frameDuration=(version===3?1152:576)/sr;
  duration+=frameDuration;weighted+=kb*frameDuration;
  if(firstKbps&&firstKbps!==kb)vbr=true;
  if(!firstKbps)firstKbps=kb;
  sampleRate=sr;frames++;offset+=length;
 }
 if(offset!==bytes.length||frames<3||duration<1||duration>3602)throw Error('Invalid MP3 duration or trailing bytes.');
 const average=weighted/duration;
 if(average+1e-7<config.minKbps||average-1e-7>config.maxKbps)throw Error('MP3 average bitrate must be '+config.minKbps+'–'+config.maxKbps+' kbps.');
 if(vbr&&!config.allowVbr)throw Error('Variable bitrate MP3 uploads are disabled by the administrator.');
 return {duration,sampleRate,frames,averageKbps:Math.round(average*100)/100,mode:vbr?'VBR':'CBR'};
}
