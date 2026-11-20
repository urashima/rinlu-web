/** Canonical RINLU provider-aware media storage for the original Site Worker.
 * New 'originals/', versioned 'renditions/' and normalized 'artwork/' keys
 * are S3-only. Historical legacy keys remain readable from R2.
 * No S3-only key is allowed to fall through to R2.
 */
import {env} from 'cloudflare:workers';
import {fail} from './backend';
const encoder=new TextEncoder();
const hex=(v:ArrayBuffer)=>Array.from(new Uint8Array(v),n=>n.toString(16).padStart(2,'0')).join('');
export const mediaDigest=async(value:BufferSource)=>hex(await crypto.subtle.digest('SHA-256',value));
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const s3MediaKey=new RegExp('^(?:originals/'+uuid+'/'+uuid+'|renditions/'+uuid+'/v[1-9][0-9]*\\.mp3|artwork/'+uuid+'/normalized\\.jpg)$','i');
const isS3Primary=(key:string)=>s3MediaKey.test(key);
const secretEnv=()=>env as unknown as Record<string,string|undefined>;
const segment=(v:string)=>encodeURIComponent(v).replace(/[!'()*]/g,ch=>'%'+ch.charCodeAt(0).toString(16).toUpperCase());
async function hmac(key:BufferSource,data:string){
 const imported=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return crypto.subtle.sign('HMAC',imported,encoder.encode(data));
}
function settings(){
 const e=secretEnv();
 const {OVH_S3_ENDPOINT:endpoint,OVH_S3_REGION:region,OVH_S3_BUCKET:bucket,OVH_S3_ACCESS_KEY_ID:access,OVH_S3_SECRET_ACCESS_KEY:secret}=e;
 if(!endpoint&&!region&&!bucket&&!access&&!secret)return null;
 if(!endpoint||!region||!bucket||!access||!secret)fail(503,'OVH S3 media credentials are incomplete.');
 const url=new URL(endpoint!);
 const suffix=region!.startsWith('us-')?'us':'net';
 const expected='s3.'+region!+'.io.cloud.ovh.'+suffix;
 if(url.protocol!=='https:'||url.hostname!==expected||url.pathname!=='/'||url.search||url.hash||url.username||url.password||
    !/^[a-z0-9-]+$/.test(region!)||!/^[a-z0-9][a-z0-9.-]{2,63}$/.test(bucket!)){
  fail(503,'Invalid private OVH S3 endpoint.');
 }
 return {url,region:region!,bucket:bucket!,access:access!,secret:secret!};
}
async function request(cfg:NonNullable<ReturnType<typeof settings>>,method:string,key:string,headers:Headers,body?:ArrayBuffer){
 if(!isS3Primary(key)&&!/^[A-Za-z0-9/_\-.]{1,450}$/.test(key))fail(400,'Invalid media storage key.');
 const path='/'+segment(cfg.bucket)+'/'+key.split('/').map(segment).join('/');
 const stamp=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),day=stamp.slice(0,8);
 const digest=await mediaDigest(body??new ArrayBuffer(0));
 headers.set('x-amz-date',stamp);
 headers.set('x-amz-content-sha256',digest);
 const entries=[...headers.entries(),['host',cfg.url.host]].sort(([a],[b])=>a<b?-1:a>b?1:0);
 const names=entries.map(([key])=>key).join(';');
 const canonical=[method,path,'',entries.map(([k,v])=>k+':'+v.trim()+'\n').join(''),names,digest].join('\n');
 const scope=day+'/'+cfg.region+'/s3/aws4_request';
 const dateKey=await hmac(encoder.encode('AWS4'+cfg.secret),day);
 const regionKey=await hmac(dateKey,cfg.region);
 const svcKey=await hmac(regionKey,'s3');
 const signKey=await hmac(svcKey,'aws4_request');
 const sig=hex(await hmac(signKey,['AWS4-HMAC-SHA256',stamp,scope,await mediaDigest(encoder.encode(canonical))].join('\n')));
 headers.set('Authorization','AWS4-HMAC-SHA256 Credential='+cfg.access+'/'+scope+', SignedHeaders='+names+', Signature='+sig);
 const response=await fetch(cfg.url.origin+path,{method,headers,body,redirect:'error',signal:AbortSignal.timeout(60000)});
 if(!response.ok&&response.status!==404){await response.body?.cancel();fail(502,'Private OVH S3 storage request returned HTTP '+response.status);}
 return response;
}
function configFor(key:string){
 const cfg=(isS3Primary(key)||secretEnv().OVH_S3_ENABLED==='1')?settings():null;
 if(isS3Primary(key)&&!cfg)fail(503,'The S3 primary storage credentials are not installed.');
 return cfg;
}
export const mediaStorage={
 async get(key:string,options?:{range?:{offset:number;length:number}}){
  const cfg=configFor(key);
  if(cfg){
   const headers=new Headers(),range=options?.range;
   if(range)headers.set('Range','bytes='+range.offset+'-'+(range.offset+range.length-1));
   const response=await request(cfg!,'GET',key,headers);
   if(response.ok){
    if(range&&response.status!==206){await response.body?.cancel();fail(502,'S3 did not honor byte range.');}
    const size=Number(response.headers.get('content-length'));
    return {body:response.body,size,httpMetadata:{contentType:response.headers.get('content-type')||undefined},
      arrayBuffer:()=>response.arrayBuffer()};
   }
   await response.body?.cancel();
   if(isS3Primary(key))return null;
  }
  return (env as any).BUCKET.get(key,options);
 },
 async head(key:string){
  const cfg=configFor(key);
  if(cfg){
   const response=await request(cfg!,'HEAD',key,new Headers());
   if(response.ok){const size=Number(response.headers.get('content-length'));await response.body?.cancel();return {size};}
   await response.body?.cancel();
   if(isS3Primary(key))return null;
  }
  return (env as any).BUCKET.head(key);
 },
 async put(key:string,value:ArrayBuffer|Uint8Array<ArrayBuffer>,options:{httpMetadata:{contentType:string}}){
  const s3Only=secretEnv().RINLU_S3_ONLY==='1';
  if(s3Only&&!isS3Primary(key))fail(409,'Legacy R2 media writes are disabled after cutover.');
  const cfg=configFor(key);
  if(!cfg)return (env as any).BUCKET.put(key,value,options);
  const bytes=value instanceof ArrayBuffer?value:new Uint8Array(value).buffer;
  const response=await request(cfg!,'PUT',key,new Headers({'Content-Type':options.httpMetadata.contentType}),bytes);
  await response.body?.cancel();
  if(!response.ok)fail(502,'S3 media PUT did not finish.');
 },
 async delete(keys:string|string[]){
  const cfg=settings(),items=[keys].flat();
  for(const key of items){
   if(isS3Primary(key)){
    if(!cfg)fail(503,'S3 keys cannot be deleted without OVH configuration.');
    const r=await request(cfg!,'DELETE',key,new Headers());
    await r.body?.cancel();
   }else if(secretEnv().RINLU_S3_ONLY==='1'){
    // Keep old R2 files as a read-only rollback set until audited retention purge.
    fail(409,'Legacy R2 retention is active; explicit migration cleanup required.');
   }else{
    await (env as any).BUCKET.delete(key);
   }
  }
 }
};
export async function copyMediaToOvh(key:string){
 const cfg=settings();if(!cfg)fail(503,'Configure OVH object storage before migration.');
 const original=await (env as any).BUCKET.get(key);
 if(!original)return false;
 const content=await original.arrayBuffer();
 const expected=await mediaDigest(content);
 const existing=await request(cfg!,'GET',key,new Headers());
 if(existing.ok&&await mediaDigest(await existing.arrayBuffer())===expected)return true;
 if(!existing.ok)await existing.body?.cancel();
 const saved=await request(cfg!,'PUT',key,new Headers({'Content-Type':original.httpMetadata?.contentType||'application/octet-stream'}),content);
 await saved.body?.cancel();if(!saved.ok)fail(502,'S3 migration PUT failed.');
 const copy=await request(cfg!,'GET',key,new Headers());
 if(!copy.ok||await mediaDigest(await copy.arrayBuffer())!==expected)fail(502,'S3 media migration checksum differs.');
 return true;
}
