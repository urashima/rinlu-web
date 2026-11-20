/** R2-free S3 primary asset registration contract.
 * Disabled unless both OVH gateway and the canonical D1/scan backend opt in.
 * Never forwards audio bytes to the canonical server or trusts a browser status.
 */
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const mime={audio:'audio/mpeg',artwork:'image/jpeg'};
export const originalKey=(owner,id)=> {
 if(!uuid.test(owner)||!uuid.test(id))throw Error('Invalid S3 owner or asset ID');
 return 'originals/'+owner+'/'+id;
};
const json=async r=>{try{return await r.json()}catch{throw Error('Invalid canonical storage response')}};
export async function checkPrimaryReady({backendOrigin,headers,transport=fetch,expectedBucket}){
 const address=new URL('/api/storage/s3/capabilities',backendOrigin);
 const response=await transport(address,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(12000)});
 if(!response.ok){await response.body?.cancel();throw Error('Canonical S3-only asset registration is unavailable: HTTP '+response.status);}
 const capability=await json(response);
 if(capability?.contract!=='rinlu-s3-primary-v1'||capability.provider!=='ovh-s3'||
    capability.bucket!==expectedBucket||capability.database!=='ready'||
    capability.scanner!=='ready'||capability.processing!=='ready'||
    capability.quarantine!==true||capability.r2_dual_write!==false){
  throw Error('Canonical D1/scanner S3 primary capability is not ready');
 }
 return capability;
}
export async function finalizePrimaryAsset({s3,ticket,backendOrigin,headers,transport=fetch}){
 if(!uuid.test(ticket.owner)||!uuid.test(ticket.assetId)||!['audio','artwork'].includes(ticket.kind))throw Error('Invalid S3 primary registration ticket');
 if(!Number.isSafeInteger(ticket.size)||ticket.size<100||ticket.size>(ticket.kind==='audio'?25*1024*1024:5*1024*1024))throw Error('Invalid S3 source size');
 const expected=originalKey(ticket.owner,ticket.assetId);
 await checkPrimaryReady({backendOrigin,headers,transport,expectedBucket:s3.bucket});
 const stage=await s3.head(ticket.key);
 if(!stage||stage.size!==ticket.size)throw Error('Staging object is missing or the size differs');
 const existing=await s3.head(expected);
 if(existing&&existing.size!==ticket.size)throw Error('Immutable original key collision');
 if(!existing)await s3.copy(ticket.key,expected,mime[ticket.kind]);
 const finalObject=await s3.head(expected);
 if(finalObject?.size!==ticket.size)throw Error('Copied original is not verified in OVH S3');
 // Caller auth and canonical signed session remain mandatory.
 // Hash and codec validity are determined by the trusted ClamAV/ffprobe worker.
 // No 'approved' or published state can be set here.
 const request={
  asset_id:ticket.assetId,
  kind:ticket.kind,
  size:ticket.size,
  content_type:mime[ticket.kind],
  original_name:ticket.name||'recording',
  storage_provider:'ovh-s3',
  storage_key:expected,
  upload_ticket_nonce:ticket.nonce,
  processing_state:'pending_scan'
 };
 const h=new Headers(headers);h.set('origin','https://rinlu.com');h.set('content-type','application/json');
 const response=await transport(new URL('/api/storage/s3/commit',backendOrigin),{
  method:'POST',headers:h,body:JSON.stringify(request),redirect:'error',signal:AbortSignal.timeout(20000)
 });
 if(!response.ok){await response.body?.cancel();throw Error('Canonical S3-only asset registration failed: HTTP '+response.status);}
 const result=await json(response);
 if(result?.id!==ticket.assetId||result.storage_provider!=='ovh-s3'||
    result.processing_state!=='pending_scan'||result.review_status==='approved'||
    result.storage_key!==expected)throw Error('Canonical asset registration did not confirm quarantine');
 // Delete staging only after D1 commit acknowledgement; failures remain retryable.
 await s3.remove(ticket.key).catch(()=>{});
 return result;
}
