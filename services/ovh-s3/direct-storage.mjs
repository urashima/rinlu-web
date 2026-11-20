/** OVH S3 browser-direct POST + canonical metadata finalize.
 * D1/user rights remain canonical; R2 is retained as a compatibility backup.
 * This is a safe bridge until the canonical Worker supports S3-only finalize.
 */
import {createHash,randomBytes} from 'node:crypto';
import {createS3Signer,signedTicket,verifyTicket,uploadNonce} from './signing.mjs';
import {createCdnSigner,assertCdnOriginToken} from './cdn-signer.mjs';
const uid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha=b=>createHash('sha256').update(b).digest('hex');
const maxBytes={audio:25*1024*1024,artwork:5*1024*1024};
const mimeType={audio:'audio/mpeg',artwork:'image/jpeg'};
const extension={audio:'.mp3',artwork:'.jpg'};
export function createDirectStorage({s3,backendOrigin,publicOrigin,accountBearer,env=process.env,transport=fetch}){
 if(!s3)return null;
 const enabled=env.RINLU_S3_DIRECT_UPLOAD==='1';
 const directPlay=env.RINLU_S3_DIRECT_PLAYBACK==='1';
 const edgeEnabled=env.RINLU_CDN_ENABLED==='1';
 if(!enabled&&!directPlay)return null;
 const signer=createS3Signer(env);
 const signEdge=edgeEnabled?createCdnSigner(env):null;
 const keySecret=env.RINLU_S3_SECRET_ACCESS_KEY;
 const processing=new Set();
 const sessions=new Map();
 const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const upstream=(path,opts={})=>transport(new URL(path,backendOrigin),{redirect:'error',signal:AbortSignal.timeout(60000),...opts});
 const headers=req=>{const h=new Headers(),bearer=accountBearer(req);if(bearer)h.set('authorization',bearer);return h;};
 const isOrigin=req=>req.headers.origin===publicOrigin;
 const readBody=async(req,max=4096)=>{
  let size=0,chunks=[];
  for await(const piece of req){size+=piece.length;if(size>max)throw Error('Request body too large');chunks.push(piece);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 };
 async function user(req){
  const h=headers(req);
  if(!h.has('authorization'))return null;
  const response=await upstream('/api/me',{headers:h});
  if(!response.ok){await response.body?.cancel();return null;}
  const account=(await response.json()).user;
  return uid.test(account?.id||'')&&account.status!=='suspended'?account:null;
 }
 const sessionDigest=req=>sha(accountBearer(req)||'');
 async function issue(req,res){
  if(!enabled)return send(res,404,{error:'Direct upload is not enabled'});
  if(!isOrigin(req))return send(res,403,{error:'Cross-origin upload denied'});
  const owner=await user(req);
  if(!owner)return send(res,401,{error:'Sign in before uploading'});
  const data=await readBody(req);
  const kind=data?.kind;
  if(!Object.hasOwn(maxBytes,kind))return send(res,415,{error:'Unsupported upload type'});
  const size=data.size;
  if(!Number.isSafeInteger(size)||size<100||size>maxBytes[kind])return send(res,413,{error:'File exceeds upload allowance'});
  const name=String(data.name||'recording').replace(/[/\\\x00-\x1f]/g,'_').slice(0,160);
  const now=Date.now(),recent=sessions.get(owner.id)||[];
  const remaining=recent.filter(t=>t>now-60000);
  if(remaining.length>=8)return send(res,429,{error:'Too many upload requests'});
  remaining.push(now);sessions.set(owner.id,remaining);
  const expires=now+300000;
  const key='staging/'+owner.id+'/'+uploadNonce()+extension[kind];
  const grant=signer.postPolicy(key,mimeType[kind],size,300);
  const ticket=signedTicket(keySecret,{key,owner:owner.id,size,kind,name,expires,session:sessionDigest(req)});
  return send(res,200,{upload:{...grant,kind,size},ticket,expiresAt:expires});
 }
 async function complete(req,res){
  if(!enabled)return send(res,404,{error:'Direct upload is not enabled'});
  if(!isOrigin(req))return send(res,403,{error:'Cross-origin upload denied'});
  const owner=await user(req);
  if(!owner)return send(res,401,{error:'Sign in before completing upload'});
  const data=await readBody(req,5000);
  let t;
  try{t=verifyTicket(keySecret,data.ticket);}catch{return send(res,403,{error:'Invalid or expired upload ticket'});}
  if(t.owner!==owner.id||t.session!==sessionDigest(req)||t.kind!==data.kind||!t.key?.startsWith('staging/'+owner.id+'/'))return send(res,403,{error:'Upload ticket does not match this account'});
  if(!Number.isSafeInteger(t.size)||t.size<100||t.size>maxBytes[t.kind])return send(res,403,{error:'Invalid file size'});
  const signature=sha(data.ticket);
  if(processing.has(signature))return send(res,409,{error:'This file is already being finalized'});
  processing.add(signature);
  try{
   const meta=await s3.head(t.key);
   if(!meta||meta.size!==t.size)return send(res,409,{error:'The direct upload was not received or its size differs'});
   const response=await s3.get(t.key);
   if(!response)return send(res,409,{error:'The direct upload is missing'});
   const bytes=Buffer.from(await response.arrayBuffer());
   if(bytes.length!==t.size)return send(res,409,{error:'The direct upload is incomplete'});
   const form=new FormData();
   form.set('kind',t.kind);
   form.set('file',new Blob([bytes],{type:mimeType[t.kind]}),t.name||'upload'+extension[t.kind]);
   const h=headers(req);h.set('origin',publicOrigin);
   const result=await upstream('/api/upload',{method:'POST',headers:h,body:form});
   const raw=await result.text();
   let payload;try{payload=JSON.parse(raw)}catch{throw Error('Canonical upload did not return JSON')}
   if(!result.ok)return send(res,result.status,{error:typeof payload?.error==='string'?payload.error:'The upload was not accepted'});
   if(!uid.test(payload?.id||'')||payload.hash!==sha(bytes)||Number(payload.size)!==bytes.length)throw Error('Canonical metadata integrity check failed');
   await s3.verifiedPut(owner.id+'/'+payload.id,bytes,mimeType[t.kind]);
   await s3.remove(t.key);
   res.setHeader('X-Rinlu-Storage','ovh-s3-direct-upload');
   return send(res,result.status,{...payload,storage:'ovh-s3-direct-upload'});
  }finally{processing.delete(signature);}
 }
 async function authorize(req,res){
  if(!directPlay)return false;
  if(!isOrigin(req))return false;
  const data=await readBody(req,2048);
  if(!uid.test(data?.track_id||''))return send(res,400,{error:'Invalid track'});
  const h=headers(req);h.set('origin',publicOrigin);h.set('content-type','application/json');
  const authorized=await upstream('/api/playback/authorize',{method:'POST',headers:h,body:JSON.stringify({track_id:data.track_id})});
  const raw=await authorized.text();
  let payload;try{payload=JSON.parse(raw)}catch{return send(res,502,{error:'Could not authorize playback'})}
  if(!authorized.ok)return send(res,authorized.status,payload);
  const media=new URL(payload.url||'',backendOrigin);
  if(media.origin!==new URL(backendOrigin).origin||media.pathname!=='/api/media/'+data.track_id||!media.searchParams.has('token'))return send(res,502,{error:'Invalid authorized media response'});
  const bearer=headers(req);
  const test=await upstream(media.pathname+media.search,{method:'HEAD',headers:bearer});
  if(!test.ok){await test.body?.cancel();return send(res,200,{...payload,url:'/music'+payload.url});}
  const total=Number((test.headers.get('content-range')||'').split('/')[1]||test.headers.get('content-length'));
  if(!Number.isSafeInteger(total)||total<1||total>32*1024*1024)return send(res,200,{...payload,url:'/music'+payload.url});
  const detail=await upstream('/api/track/'+data.track_id,{headers:bearer});
  if(!detail.ok){await detail.body?.cancel();return send(res,200,{...payload,url:'/music'+payload.url});}
  const record=(await detail.json()).track;
  if(!Number.isSafeInteger(record?.version)||record.version<1)return send(res,200,{...payload,url:'/music'+payload.url});
  const key='playback/'+data.track_id+'/v'+record.version+'-s'+total+'.mp3';
  let meta;
  try{meta=await s3.head(key);}catch{return send(res,200,{...payload,url:'/music'+payload.url});}
  if(meta?.size!==total)return send(res,200,{...payload,url:'/music'+payload.url});
  const signed=signEdge?signEdge(data.track_id,record.version,total):signer.signedGet(key,900);
  return send(res,200,{...payload,probe_url:'/music'+payload.url,url:signed,delivery:signEdge?'rinlu-cdn-edge':'ovh-s3-direct',expires_at:Date.now()+900000});
 }
 async function cdnOrigin(req,res,url){
  if(!edgeEnabled)return send(res,404,{error:'Not found'});
  const key=url.searchParams.get('key')||'';
  const expected=env.RINLU_CDN_ORIGIN_TOKEN;
  const supplied=String(req.headers.authorization||'').replace(/^Bearer /,'');
  try{assertCdnOriginToken(expected,supplied);}catch{return send(res,403,{error:'CDN service authentication failed'});}
  const re=/^playback\/([0-9a-f-]{36})\/v([1-9][0-9]*)-s([1-9][0-9]*)\.mp3$/i;
  const m=re.exec(key);
  if(!m||!uid.test(m[1])||Number(m[3])>32*1024*1024)return send(res,400,{error:'Invalid media key'});
  const info=await s3.head(key);
  if(info?.size!==Number(m[3]))return send(res,404,{error:'S3 media unavailable'});
  return send(res,200,{url:signer.signedGet(key,60)});
 }
 return {
  enabled:{upload:enabled,playback:directPlay},
  async handle(req,res,local,url){
   if(local==='/api/storage/cdn-origin'&&req.method==='GET'){await cdnOrigin(req,res,url);return true;}
   if(local==='/api/storage/direct/init'&&req.method==='POST'){await issue(req,res);return true;}
   if(local==='/api/storage/direct/complete'&&req.method==='POST'){await complete(req,res);return true;}
   if(local==='/api/playback/authorize'&&req.method==='POST'&&directPlay){await authorize(req,res);return true;}
   return false;
  }
 };
}
