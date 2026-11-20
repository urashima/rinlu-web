/** Cloudflare Worker edge: signed private RINLU music, not a public bucket.
 * Route a custom domain (for example media.rinlu.com) to this Worker.
 * Secrets: RINLU_CDN_SIGNING_KEY, RINLU_CDN_ORIGIN_TOKEN (NOT S3 keys).
 * Actual audio bytes go straight from the edge to OVH S3. VPS only signs
 * the short-lived origin request on a cache miss; it never relays audio.
 */
const encoder=new TextEncoder();
const hexToBytes=hex=>new Uint8Array((hex.match(/.{2}/g)||[]).map(v=>Number.parseInt(v,16)));
const idPattern='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const route=new RegExp('^/v1/audio/('+idPattern+')/v([1-9][0-9]*)-s([1-9][0-9]*)\\.mp3$','i');
const origin='https://rinlu.com';
const json=(error,status)=>new Response(JSON.stringify({error}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
async function authorized(url,secret){
 const expires=Number(url.searchParams.get('exp')),signature=url.searchParams.get('sig')||'';
 if(!Number.isSafeInteger(expires)||expires<=Date.now()/1000||expires>Math.floor(Date.now()/1000)+900||!(/^[a-f0-9]{64}$/i.test(signature))||!secret||secret.length<32)return false;
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 return crypto.subtle.verify('HMAC',key,hexToBytes(signature),encoder.encode(url.pathname+'\n'+expires));
}
const edgeHeaders=(headers,requestedOrigin)=>{
 const result=new Headers();
 for(const name of ['content-type','content-length','content-range','accept-ranges','etag','last-modified'])if(headers.has(name))result.set(name,headers.get(name));
 result.set('X-Content-Type-Options','nosniff');
 result.set('X-Rinlu-Delivery','cdn-edge-ovh-s3');
 result.set('Cache-Control','private, no-store');
 if(requestedOrigin===origin){result.set('Access-Control-Allow-Origin',origin);result.set('Vary','Origin');result.set('Access-Control-Expose-Headers','Content-Length,Content-Range,Accept-Ranges,ETag,X-Rinlu-Delivery');}
 return result;
};
const s3Origin=async(key,env)=>{
 const u=new URL('https://rinlu.com/music/api/storage/cdn-origin');
 u.searchParams.set('key',key);
 const r=await fetch(u,{headers:{Authorization:'Bearer '+env.RINLU_CDN_ORIGIN_TOKEN},redirect:'error'});
 if(!r.ok){await r.body?.cancel();throw Error('S3 origin authorization refused');}
 const result=await r.json();
 const next=new URL(result.url);
 if(next.protocol!=='https:'||!/^[a-z0-9.-]+\.io\.cloud\.ovh\.(us|net)$/i.test(next.hostname)||!next.searchParams.has('X-Amz-Signature'))throw Error('Untrusted origin URL');
 return next.toString();
};
export default {
 async fetch(request,env,ctx){
  const u=new URL(request.url),requestedOrigin=request.headers.get('Origin');
  if(request.method==='OPTIONS'){
   if(requestedOrigin!==origin)return new Response(null,{status:403});
   return new Response(null,{status:204,headers:{
    'Access-Control-Allow-Origin':origin,
    'Access-Control-Allow-Methods':'GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers':'Range,Content-Type',
    'Access-Control-Max-Age':'1800',
    'Vary':'Origin',
   }});
  }
  if(!['GET','HEAD'].includes(request.method))return json('Method not allowed',405);
  const match=route.exec(u.pathname);
  if(!match||Number(match[3])>32*1024*1024)return json('Not found',404);
  if(!await authorized(u,env.RINLU_CDN_SIGNING_KEY))return json('Signed playback link expired or invalid',403);
  const key='playback/'+match[1]+'/v'+match[2]+'-s'+match[3]+'.mp3';
  const range=request.headers.get('Range');
  if(range&&!/^bytes=[0-9]+-[0-9]*$/.test(range))return json('Invalid byte range',416);
  const cacheKey=new Request(u.origin+u.pathname,{method:'GET',headers:range?{Range:range}:{}});
  try{
   if(request.method==='GET'){
    const cached=await caches.default.match(cacheKey);
    if(cached&&(!range||cached.status===206)){
     return new Response(cached.body,{status:cached.status,headers:edgeHeaders(cached.headers,requestedOrigin)});
    }
   }
   const signed=await s3Origin(key,env);
   // No private bucket is opened: this GET has its own 60-second origin signature.
   const source=await fetch(signed,{method:'GET',headers:range?{Range:range}:request.method==='HEAD'?{Range:'bytes=0-0'}:{},redirect:'error'});
   if(!source.ok){await source.body?.cancel();return json('Audio is temporarily unavailable',502);}
   if(request.method==='HEAD'){
    const total=(source.headers.get('content-range')||'').split('/')[1];
    const h=edgeHeaders(source.headers,requestedOrigin);
    if(total)h.set('Content-Length',total);
    h.delete('Content-Range');
    await source.body?.cancel();
    return new Response(null,{status:200,headers:h});
   }
   // Cache only complete immutable objects, never partial data or authorization tokens.
   if(!range&&source.status===200){
    const cached=source.clone();
    const h=new Headers(cached.headers);
    h.set('Cache-Control','public, max-age=86400, immutable');
    const item=new Response(cached.body,{status:200,headers:h});
    ctx.waitUntil(caches.default.put(new Request(u.origin+u.pathname),item).catch(()=>{}));
   }
   return new Response(source.body,{status:source.status,headers:edgeHeaders(source.headers,requestedOrigin)});
  }catch{
   return json('CDN origin temporarily unavailable',502);
  }
 }
};
