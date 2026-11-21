/** Production read-only admission gate for the RINLU canonical Site backend.
 * Do not publish the OVH UI until the independently managed Worker passes.
 * Never attempts to upload songs, read private assets or modify D1.
 */
const probes=[
 {name:'original-site-backend',url:'https://sonora-independent-music.kai-ma.chatgpt.site/api/upload-policy'},
 {name:'rinlu-production-gateway',url:'https://rinlu.com/music/api/upload-policy'}
];
let failed=false;
for(const probe of probes){
 try{
  const result=await fetch(probe.url,{
   method:'GET',
   headers:{Accept:'application/json'},
   redirect:'manual',
   cache:'no-store',
   signal:AbortSignal.timeout(20000)
  });
  const type=result.headers.get('content-type')||'';
  if(result.status!==200||!type.includes('json')){
   console.log(JSON.stringify({target:probe.name,http_status:result.status,policy_ready:false}));
   await result.body?.cancel();
   failed=true;
   continue;
  }
  const data=await result.json();
  const formats=data?.formats;
  const ready=formats?.mp3?.enabled===true&&formats.mp3.minKbps===128&&
    formats.mp3.maxKbps===320&&formats.mp3.allowVbr===true&&
    ['wav','m4v','dolby_atmos','lossless'].every(key=>formats[key]?.enabled===false)&&
    Array.isArray(data?.supportedFormats)&&data.supportedFormats.length===1&&
    data.supportedFormats[0]==='mp3'&&Number.isSafeInteger(data?.revision)&&data.revision>=0;
  console.log(JSON.stringify({
   target:probe.name,http_status:result.status,policy_ready:ready,
   revision:data?.revision??null,mp3_enabled:formats?.mp3?.enabled??null,
   mp3_min_kbps:formats?.mp3?.minKbps??null,
   mp3_max_kbps:formats?.mp3?.maxKbps??null,
   vbr_enabled:formats?.mp3?.allowVbr??null
  }));
  if(!ready)failed=true;
 }catch(error){
  console.log(JSON.stringify({target:probe.name,policy_ready:false,error:String(error?.name||'network failure')}));
  failed=true;
 }
}
if(failed){
 console.error('RINLU canonical D1 upload policy is NOT fully live. Do not merge or publish the creator UI.');
 process.exitCode=1;
}else{
 console.log('RINLU canonical Site and OVH gateway expose the expected MP3 128kbps CBR/VBR policy.');
}
