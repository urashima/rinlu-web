/** RINLU S3 bridge for the existing canonical D1/R2 backend.
 * Source of truth, auth, moderation and DB remain on the canonical platform.
 * The OVH gateway mirrors user uploads to S3 and caches authorized renditions.
 * Flags remain OFF until an explicit verified production rollout.
 */
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {createDirectStorage} from './direct-storage.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createStorageGateway({s3,backendOrigin,publicOrigin,accountBearer,env=process.env,transport=fetch}){
 if(!s3)return null;
 const uploadEnabled=env.RINLU_S3_UPLOAD_MIRROR==='1';
 const playbackEnabled=env.RINLU_S3_PLAYBACK_CACHE==='1';
 const direct=createDirectStorage({s3,backendOrigin,publicOrigin,accountBearer,env,transport});
 const active=new Map();
 let uploads=0,cacheJobs=0;
 const upstream=(path,opts)=>transport(new URL(path,backendOrigin),{redirect:'error',signal:AbortSignal.timeout(45000),...opts});
 const authHeaders=req=>{
  const headers=new Headers(),bearer=accountBearer(req);
  if(bearer)headers.set('authorization',bearer);
  return headers;
 };
 const send=(res,status,data)=>{
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(data));
 };
 async function upload(req,res){
  if(req.headers.origin!==publicOrigin)return send(res,403,{error:'Invalid upload origin'});
  if(uploads>=1)return send(res,429,{error:'An upload is already in progress. Retry shortly.'});
  if(!/^multipart\/form-data; boundary=/.test(String(req.headers['content-type']||'')))return send(res,415,{error:'Expected multipart upload'});
  if(Number(req.headers['content-length']||0)>27*1024*1024)return send(res,413,{error:'Upload too large'});
  uploads++;
  try{
   let total=0;const parts=[];
   for await(const chunk of req){total+=chunk.length;if(total>27*1024*1024)return send(res,413,{error:'Upload too large'});parts.push(chunk)}
   const body=Buffer.concat(parts);
   const headers=authHeaders(req);headers.set('origin',publicOrigin);headers.set('content-type',req.headers['content-type']);
   const upstreamResponse=await upstream('/api/upload',{method:'POST',headers,body});
   const raw=await upstreamResponse.text();
   let result;try{result=JSON.parse(raw)}catch{}
   if(!upstreamResponse.ok){
    res.writeHead(upstreamResponse.status,{'Content-Type':upstreamResponse.headers.get('content-type')||'application/json','Cache-Control':'no-store'});
    res.end(raw);return;
   }
   if(!result||!uuid.test(result.id||'')||!/^[a-f0-9]{64}$/.test(result.hash||''))throw Error('Unexpected canonical upload response');
   const form=await new Request(publicOrigin+'/music/api/upload',{method:'POST',headers:{'content-type':req.headers['content-type']},body}).formData();
   const file=form.get('file'),kind=form.get('kind');
   if(!file||typeof file.arrayBuffer!=='function'||!['audio','artwork'].includes(String(kind)))throw Error('Unexpected multipart data');
   const bytes=Buffer.from(await file.arrayBuffer());
   if(sha(bytes)!==result.hash||bytes.length!==Number(result.size))throw Error('Canonical upload checksum differs');
   const me=await upstream('/api/me',{headers:authHeaders(req)});
   if(!me.ok)throw Error('Cannot validate uploading account');
   const user=(await me.json()).user;
   if(!uuid.test(user?.id||''))throw Error('Invalid authenticated owner');
   const key=user.id+'/'+result.id;
   const mediaType=String(kind)==='audio'?'audio/mpeg':'image/jpeg';
   await s3.verifiedPut(key,bytes,mediaType);
   res.setHeader('X-Rinlu-Storage','ovh-s3-mirrored');
   res.writeHead(upstreamResponse.status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
   res.end(raw);
  }catch(error){
   console.error('RINLU S3 upload mirror failure:',error?.name||'Error');
   return send(res,502,{error:'Upload reached the original storage, but OVH replication was not verified. Please retry the same file.'});
  }finally{uploads--;}
 }
 const playbackKey=(track,version,size)=>'playback/'+track+'/v'+version+'-s'+size+'.mp3';
 const readUserVersion=async(req,track)=>{
  const detail=await upstream('/api/track/'+track,{headers:authHeaders(req)});
  if(!detail.ok){await detail.body?.cancel();return null;}
  const value=(await detail.json()).track?.version;
  return Number.isSafeInteger(value)&&value>=1?value:null;
 };
 function cacheAsync(key,mediaPath,headers,expected){
  if(active.has(key)||cacheJobs>=1||uploads>0)return;
  cacheJobs++;
  const task=(async()=>{
   const response=await upstream(mediaPath,{method:'GET',headers});
   if(!response.ok||response.status!==200){await response.body?.cancel();return;}
   const declared=Number(response.headers.get('content-length'));
   if(declared!==expected||expected>32*1024*1024){await response.body?.cancel();return;}
   const bytes=Buffer.from(await response.arrayBuffer());
   if(bytes.length===expected)await s3.verifiedPut(key,bytes,'audio/mpeg');
  })().catch(error=>console.error('RINLU S3 playback replication failure:',error?.name||'Error')).finally(()=>{active.delete(key);cacheJobs--});
  active.set(key,task);
 }
 async function playback(req,res,local,url){
  if(!['GET','HEAD'].includes(req.method))return false;
  if(req.headers['if-range'])return false;
  const match=/^\/api\/media\/([0-9a-f-]{36})$/.exec(local);
  if(!match||!uuid.test(match[1]))return false;
  const track=match[1],headers=authHeaders(req);
  if(req.headers.range)headers.set('range',req.headers.range);
  let authorized;
  try{authorized=await upstream(local+url.search,{method:'HEAD',headers});}
  catch{return false;}
  if(!authorized.ok){await authorized.body?.cancel();return false;}
  const total=Number((authorized.headers.get('content-range')||'').split('/')[1]||authorized.headers.get('content-length'));
  if(!Number.isSafeInteger(total)||total<1||total>32*1024*1024)return false;
  const version=await readUserVersion(req,track);
  if(!version)return false;
  const key=playbackKey(track,version,total);
  try{
   const info=await s3.head(key);
   if(!info||info.size!==total){
    if(req.method==='GET'){
     const fullHeaders=authHeaders(req);
     cacheAsync(key,local+url.search,fullHeaders,total);
    }
    return false;
   }
   if(req.method==='HEAD'){
    for(const name of ['content-type','content-length','content-range','accept-ranges'])if(authorized.headers.has(name))res.setHeader(name,authorized.headers.get(name));
    res.setHeader('X-Rinlu-Storage','ovh-s3');
    res.writeHead(authorized.status);res.end();return true;
   }
   const object=await s3.get(key,req.headers.range);
   if(!object||object.status!==authorized.status){await object?.body?.cancel();return false;}
   for(const name of ['content-type','content-length','content-range','accept-ranges'])if(authorized.headers.has(name))res.setHeader(name,authorized.headers.get(name));
   res.setHeader('X-Rinlu-Storage','ovh-s3');
   res.writeHead(authorized.status);
   if(object.body)Readable.fromWeb(object.body).pipe(res).on('error',()=>res.destroy());
   else res.end();
   return true;
  }catch(error){
   console.error('RINLU S3 playback fallback:',error?.name||'Error');
   return false;
  }
 }
 return {
  enabled:{upload:uploadEnabled,playback:playbackEnabled},
  async handle(req,res,local,url){
   if(direct&&await direct.handle(req,res,local,url))return true;
   if(uploadEnabled&&local==='/api/upload'&&req.method==='POST'){await upload(req,res);return true;}
   if(playbackEnabled&&local.startsWith('/api/media/'))return playback(req,res,local,url);
   return false;
  }
 };
}
