/** Private OVH S3 adapter (AWS SigV4, no third-party runtime dependencies).
 * Access keys remain in Docker env. This module never makes objects public.
 */
import {createHash,createHmac} from 'node:crypto';

const digest=value=>createHash('sha256').update(value).digest('hex');
const hmac=(key,value)=>createHmac('sha256',key).update(value).digest();
const percent=value=>encodeURIComponent(value).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const keyPath=key=>key.split('/').map(percent).join('/');

export function createOvhS3(env=process.env,transport=fetch) {
  const keys=['RINLU_S3_ENDPOINT','RINLU_S3_REGION','RINLU_S3_BUCKET','RINLU_S3_ACCESS_KEY_ID','RINLU_S3_SECRET_ACCESS_KEY'];
  if(keys.every(key=>!env[key]))return null;
  if(keys.some(key=>!env[key]))throw new Error('Incomplete private OVH S3 configuration');
  const region=env.RINLU_S3_REGION,bucket=env.RINLU_S3_BUCKET,access=env.RINLU_S3_ACCESS_KEY_ID,secret=env.RINLU_S3_SECRET_ACCESS_KEY;
  if(!/^[a-z][a-z0-9-]{1,40}$/.test(region)||!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))throw Error('Invalid S3 region or bucket');
  const endpoint=new URL(env.RINLU_S3_ENDPOINT);
  const host='s3.'+region+'.io.cloud.ovh.'+(region.startsWith('us-')?'us':'net');
  if(endpoint.protocol!=='https:'||endpoint.host!==host||endpoint.pathname!=='/'||endpoint.search||endpoint.hash||endpoint.username||endpoint.password)throw Error('Unexpected S3 endpoint');
  if(!access||!secret||/[\r\n\0]/.test(access+secret))throw Error('Invalid S3 credentials');

  async function request(method,key,{body,contentType,range,copySource,timeout=45000}={}) {
    if(!/^[A-Za-z0-9/_\-.]{1,450}$/.test(key)||key.split('/').includes('..'))throw Error('Invalid object key');
    const path='/'+percent(bucket)+'/'+keyPath(key),date=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),short=date.slice(0,8);
    const payload=digest(body||Buffer.alloc(0)),headers=new Headers({
      host:endpoint.host,'x-amz-date':date,'x-amz-content-sha256':payload,
    });
    if(contentType)headers.set('content-type',contentType);
    if(body)headers.set('content-length',String(body.byteLength));
    if(range)headers.set('range',range);
    if(copySource){
      if(!/^[A-Za-z0-9/_\-.]{1,450}$/.test(copySource)||copySource.split('/').includes('..'))throw Error('Invalid source object key');
      headers.set('x-amz-copy-source','/'+percent(bucket)+'/'+keyPath(copySource));
      headers.set('x-amz-metadata-directive','REPLACE');
    }
    const sorted=[...headers].sort(([a],[b])=>a.localeCompare(b)),signed=sorted.map(([k])=>k).join(';');
    const canonical=[method,path,'',sorted.map(([k,v])=>k+':'+v.trim()+'\n').join(''),signed,payload].join('\n');
    const scope=short+'/'+region+'/s3/aws4_request';
    const signing=hmac(hmac(hmac(hmac('AWS4'+secret,short),region),'s3'),'aws4_request');
    const signature=createHmac('sha256',signing).update(['AWS4-HMAC-SHA256',date,scope,digest(canonical)].join('\n')).digest('hex');
    headers.set('authorization','AWS4-HMAC-SHA256 Credential='+access+'/'+scope+', SignedHeaders='+signed+', Signature='+signature);
    const response=await transport(endpoint.origin+path,{method,headers,body,redirect:'error',signal:AbortSignal.timeout(timeout)});
    if(!response.ok&&response.status!==404) {
      await response.body?.cancel();
      throw Error('OVH S3 request failed, HTTP '+response.status);
    }
    return response;
  }
  return {
    bucket,region,
    async put(key,bytes,contentType='application/octet-stream') {
      const body=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
      const r=await request('PUT',key,{body,contentType});
      if(!r.ok)throw Error('OVH S3 object write failed');
      await r.body?.cancel();
      return {bytes:body.length,sha256:digest(body)};
    },
    async copy(from,to,contentType='application/octet-stream'){
      const r=await request('PUT',to,{copySource:from,contentType});
      if(!r.ok)throw Error('OVH S3 server-side object copy failed');
      await r.body?.cancel();
      return this.head(to);
    },
    async head(key){
      const r=await request('HEAD',key);
      if(r.status===404)return null;
      await r.body?.cancel();
      const size=Number(r.headers.get('content-length'));
      if(!Number.isSafeInteger(size)||size<0)throw Error('Invalid S3 object length');
      return {size,contentType:r.headers.get('content-type')||'application/octet-stream'};
    },
    async get(key,range){
      const r=await request('GET',key,{range});
      if(r.status===404)return null;
      if(range&&r.status!==206){await r.body?.cancel();throw Error('S3 did not honor Range');}
      return r;
    },
    async remove(key){
      const r=await request('DELETE',key);
      await r.body?.cancel();
      return r.ok||r.status===404;
    },
    async verifiedPut(key,bytes,contentType){
      const body=Buffer.from(bytes),sha=digest(body);
      const existing=await this.head(key);
      if(existing?.size===body.length){
        const read=await this.get(key);
        if(read&&digest(Buffer.from(await read.arrayBuffer()))===sha)return {bytes:body.length,sha256:sha,unchanged:true};
      }
      await this.put(key,body,contentType);
      const returned=await this.get(key);
      if(!returned||digest(Buffer.from(await returned.arrayBuffer()))!==sha)throw Error('OVH S3 checksum verification failed');
      return {bytes:body.length,sha256:sha,unchanged:false};
    },
  };
}
