/** Read-only production primary-storage readiness probe.
 * No credentials, cookies, signed URLs, media bytes or user data are logged.
 */
const targets=[
 ['public_gateway','https://rinlu.com/music/api/storage/s3/capabilities'],
 ['canonical_backend','https://sonora-independent-music.kai-ma.chatgpt.site/api/storage/s3/capabilities']
];
for(const [name,url] of targets){
 try{
  const result=await fetch(url,{
   method:'GET',headers:{'Accept':'application/json'},
   redirect:'manual',signal:AbortSignal.timeout(20000)
  });
  const type=result.headers.get('content-type')||'';
  let ready=false,contract='unavailable',provider='unavailable',scanner='unknown',database='unknown',r2=false;
  if(result.status===200&&type.includes('json')){
   const value=await result.json();
   contract=value.contract||'not-advertised';
   provider=value.provider||'not-advertised';
   scanner=value.scanner||'unknown';
   database=value.database||'unknown';
   r2=value.r2_dual_write===false;
   ready=value.contract==='rinlu-s3-primary-v1'&&provider==='ovh-s3'&&
    value.database==='ready'&&value.scanner==='ready'&&value.processing==='ready'&&
    value.quarantine===true&&value.r2_dual_write===false;
  }else{await result.body?.cancel();}
  console.log(JSON.stringify({target:name,status:result.status,json:type.includes('json'),contract,provider,scanner,database,r2_dual_write_disabled:r2,s3_only_ready:ready}));
  if(!ready)process.exitCode=1;
 }catch(error){
  console.log(JSON.stringify({target:name,available:false,error_type:error?.name||'Error'}));
  process.exitCode=1;
 }
}
