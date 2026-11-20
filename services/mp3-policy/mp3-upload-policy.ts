/** Strict MP3 input-policy parser shared by RINLU's creator UI.
 * The actual upload rule is the duration-weighted *audio frame* bitrate:
 * average >=192kbps, not a hard-coded 192/320 CBR or a file-size estimate.
 * A VBR MP3 may contain individual frames below 192kbps while meeting the
 * actual overall quality threshold. Never count ID3 artwork/metadata bytes.
 * Decoding and malware scanning remain independent requirements.
 */
export function inspectMp3Upload(bytes:Uint8Array){
 if(!(bytes instanceof Uint8Array)||bytes.length<1024)throw Error('Choose a valid MP3 recording.');
 let offset=0;
 if(bytes[0]===0x49&&bytes[1]===0x44&&bytes[2]===0x33){
  if(bytes.length<10||bytes[3]<2||bytes[3]>4||
    (bytes[5]&0x10&&bytes[3]!==4)||
    [bytes[6],bytes[7],bytes[8],bytes[9]].some(n=>n>127)){
   throw Error('Invalid MP3 ID3 metadata.');
  }
  offset=10+((bytes[6]<<21)|(bytes[7]<<14)|(bytes[8]<<7)|bytes[9])+
    (bytes[3]===4&&(bytes[5]&0x10)?10:0);
  if(offset>=bytes.length)throw Error('MP3 contains no audio frames.');
 }
 let frames=0,seconds=0,sampleRate=0,weighted=0,firstBitrate=0,vbr=false;
 const bitrateMpeg1=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] as const;
 while(offset+4<=bytes.length){
  if(bytes.length-offset===128&&bytes[offset]===0x54&&bytes[offset+1]===0x41&&bytes[offset+2]===0x47){
   offset=bytes.length;
   break;
  }
  const b=bytes[offset+1],c=bytes[offset+2],d=bytes[offset+3];
  const version=(b>>3)&3,layer=(b>>1)&3,index=c>>4,srIndex=(c>>2)&3;
  if(bytes[offset]!==255||(b&224)!==224||version!==3||layer!==1||index===0||index===15||srIndex===3){
   throw Error('This file is not a supported MPEG-1 Layer III MP3.');
  }
  const kbps=bitrateMpeg1[index];
  const hz=[44100,48000,32000][srIndex];
  if(sampleRate!==0&&sampleRate!==hz)throw Error('MP3 sample rate changes inside the recording.');
  const length=Math.floor(144000*kbps/hz)+((c>>1)&1);
  if(!Number.isSafeInteger(length)||length<24||offset+length>bytes.length)throw Error('MP3 audio frames are incomplete.');
  const frameSeconds=1152/hz;
  seconds+=frameSeconds;
  weighted+=kbps*frameSeconds;
  if(firstBitrate&&kbps!==firstBitrate)vbr=true;
  if(!firstBitrate)firstBitrate=kbps;
  sampleRate=hz;frames++;offset+=length;
 }
 if(offset!==bytes.length||frames<3||seconds<1||seconds>3602)throw Error('MP3 recording is incomplete or its duration is invalid.');
 // Fuzz tolerance is limited to floating-point roundoff, not a 191kbps file.
 const average=weighted/seconds;
 if(average+1e-7<192)throw Error('MP3 average audio bitrate must be at least 192 kbps (CBR or VBR).');
 return {
  averageKbps:Math.round(average*100)/100,
  mode:vbr?'VBR':'CBR',
  frames,
  duration:seconds,
  sampleRate,
 };
}
