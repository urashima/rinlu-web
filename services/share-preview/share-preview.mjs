/** RINLU share image: isolated OVH S3 settings, no default image or rebuild hooks. */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const KEY='share-preview/config.json',MAX=4*1024*1024;
const KINDS={
 'image/jpeg':['jpg',b=>b[0]===255&&b[1]===216&&b[2]===255],
 'image/png':['png',b=>b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))],
 'image/webp':['webp',b=>b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP']
};
const isImage=i=>i&&/^[a-f0-9]{64}$/.test(i.sha256||'')&&KINDS[i.contentType]&&Number.isSafeInteger(i.bytes)&&i.bytes>0&&i.bytes<=MAX;
const empty=()=>({version:1,image:null});
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const imageUrl=(origin,sha)=>origin+'/music/share/image?v='+sha;
export function socialHtml(html,config,origin){
 const tags=[
 '<meta property="og:type" content="website">',
 '<meta property="og:site_name" content="RINLU">',
 '<meta property="og:url" content="'+origin+'/music/">',
 '<meta property="og:title" content="RINLU — music • play • create">',
 '<meta property="og:description" content="Discover original music, play rhythm games and create on RINLU.">',
 '<meta name="twitter:card" content="summary_large_image">'
 ];
 if(isImage(config?.image)){
  const url=imageUrl(origin,config.image.sha256);
  tags.push('<meta property="og:image" content="'+url+'">');
  tags.push('<meta property="og:image:secure_url" content="'+url+'">');
  tags.push('<meta property="og:image:type" content="'+config.image.contentType+'">');
  tags.push('<meta name="twitter:image" content="'+url+'">');
 }
 return html.replace(/<meta\b(?=[^>]*\b(?:name|property)\s*=\s*["'](?:og:[^"']+|twitter:[^"']+)["'])[^>]*>/gi,'')
   .replace('</head>',tags.join('\n')+'\n</head>');
}
export function createSharePreview({s3,backendOrigin,publicOrigin,accountBearer,transport=fetch,
 getIndex=()=>readFile(new URL('./public/index.html',import.meta.url),'utf8')}){
 let cache=null,cacheUntil=0;
 async function config(){
  if(!s3)return empty();
  if(cache&&Date.now()<cacheUntil)return cache;
  const response=await s3.get(KEY);
  let value=empty();
  if(response){
   const raw=await response.text();
   if(raw.length>2048)throw Error('Oversized settings');
   const data=JSON.parse(raw);
   value={version:1,image:isImage(data?.image)?data.image:null};
  }
  cache=value;cacheUntil=Date.now()+20_000;return value;
 }
 async function requireAdmin(req){
  const bearer=accountBearer(req);
  if(!bearer)return 401;
  const response=await transport(new URL('/api/me',backendOrigin),{
   method:'GET',headers:{authorization:bearer,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)
  });
  if(!response.ok){await response.body?.cancel();return response.status===401?401:403;}
  const me=await response.json();
  return me.user?.role==='admin'&&me.user?.status!=='suspended'?200:403;
 }
 async function save(req,res){
  if(req.headers.origin!==publicOrigin)return json(res,403,{error:'Invalid request origin'});
  const type=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
  if(!KINDS[type])return json(res,415,{error:'JPEG, PNG or WebP required'});
  const size=Number(req.headers['content-length']);
  if(!Number.isSafeInteger(size)||size<1||size>MAX)return json(res,413,{error:'Maximum 4 MB'});
  let bytes=0;const pieces=[];
  for await(const part of req){bytes+=part.length;if(bytes>MAX)return json(res,413,{error:'Maximum 4 MB'});pieces.push(part);}
  const binary=Buffer.concat(pieces);
  if(binary.length!==size||!KINDS[type][1](binary))return json(res,422,{error:'Invalid image'});
  const sha=createHash('sha256').update(binary).digest('hex');
  await s3.put('share-preview/images/'+sha+'.'+KINDS[type][0],binary,type);
  const data={version:1,image:{sha256:sha,contentType:type,bytes:binary.length,updatedAt:new Date().toISOString()}};
  await s3.put(KEY,Buffer.from(JSON.stringify(data)),'application/json');
  cache=data;cacheUntil=Date.now()+20_000;
  return json(res,200,{enabled:true,imageUrl:imageUrl(publicOrigin,sha)});
 }
 async function clear(req,res){
  if(req.headers.origin!==publicOrigin)return json(res,403,{error:'Invalid request origin'});
  const value=empty();
  await s3.put(KEY,Buffer.from(JSON.stringify(value)),'application/json');
  cache=value;cacheUntil=Date.now()+20_000;
  return json(res,200,{enabled:false,imageUrl:null});
 }
 function adminPage(){
  return \`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>分享图 — RINLU</title><style>
  :root{color-scheme:dark;font-family:system-ui,-apple-system,sans-serif}*{box-sizing:border-box}
  body{background:#0d111e;color:#fff;margin:0}main{max-width:720px;margin:8vh auto;padding:0 20px}
  a{color:#a7bcff}h1{margin-top:36px}p{color:#aeb8d0;line-height:1.7}
  section{background:#171d2b;border:1px solid #353e57;border-radius:16px;padding:24px}
  img{display:block;width:min(320px,100%);aspect-ratio:1;object-fit:contain;margin:18px 0;border-radius:12px;background:#0c1020}
  img[hidden]{display:none}input{display:block;max-width:100%;margin:20px 0}
  button{border:0;border-radius:9px;background:#9fb3ff;color:#091124;padding:10px 18px;margin:0 8px 0 0;font-weight:700;cursor:pointer}
  button:disabled{opacity:.5;cursor:default}#clear{background:#47303a;color:#ffbdc7}#status{min-height:25px}small{color:#8390ad}
  </style></head><body><main><a href="/music/admin">← 返回管理后台</a><h1>分享图</h1>
  <p>首次不配置任何图片。保存后立即更新 RINLU 首页的分享预览，无须重新构建或部署。</p>
  <section><strong>当前图片</strong><img id="preview" alt="分享图预览" hidden><p id="empty">未配置</p>
  <input id="file" type="file" accept="image/jpeg,image/png,image/webp">
  <button id="save" disabled>保存分享图</button><button id="clear" disabled>清除配置</button>
  <p id="status" role="status"></p><small>JPEG / PNG / WebP，最大 4 MB。社交平台的旧分享预览可能存在缓存。</small>
  </section></main><script defer src="/music/share-admin.js"></script></body></html>\`;
 }
 async function image(req,res,url){
  if(!s3){res.writeHead(404);res.end();return;}
  const current=(await config()).image;
  if(!isImage(current)||url.searchParams.get('v')!==current.sha256){res.writeHead(404);res.end();return;}
  const obj=await s3.get('share-preview/images/'+current.sha256+'.'+KINDS[current.contentType][0]);
  if(!obj){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':current.contentType,'Content-Length':String(current.bytes),
   'Cache-Control':'public, max-age=3600','ETag':'"'+current.sha256+'"','X-Content-Type-Options':'nosniff'});
  if(req.method==='HEAD'){await obj.body?.cancel();res.end();return;}
  for await(const chunk of obj.body)res.write(chunk);res.end();
 }
 return async function handle(req,res){
  const url=new URL(req.url||'/',publicOrigin),path=url.pathname;
  if((path==='/music/'||path==='/music/index.html')&&['GET','HEAD'].includes(req.method)){
   let current;try{current=await config();}catch(e){console.error('Share config read:',e?.message);current=empty();}
   const html=socialHtml(await getIndex(),current,publicOrigin);
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':String(Buffer.byteLength(html)),
    'Cache-Control':'public, max-age=20','X-Content-Type-Options':'nosniff'});
   res.end(req.method==='HEAD'?undefined:html);return true;
  }
  if(path==='/music/share/image'&&['GET','HEAD'].includes(req.method)){
   try{await image(req,res,url);}catch(e){console.error('Share image:',e?.message);if(!res.headersSent){res.writeHead(503);res.end();}else res.destroy();}
   return true;
  }
  if(path==='/music/admin/share-image'||path==='/music/api/admin/share-image'){
   if(!['GET','HEAD','POST','DELETE'].includes(req.method)) {json(res,405,{error:'Method not allowed'});return true;}
   if(path==='/music/admin/share-image'&&!['GET','HEAD'].includes(req.method)){json(res,405,{error:'Method not allowed'});return true;}
   if(path==='/music/api/admin/share-image'&&req.method==='HEAD'){json(res,405,{error:'Method not allowed'});return true;}
   let authorized;try{authorized=await requireAdmin(req);}catch(e){console.error('Share admin auth:',e?.message);json(res,503,{error:'Authentication unavailable'});return true;}
   if(authorized!==200){json(res,authorized,{error:'Administrator required'});return true;}
   if(path==='/music/admin/share-image'){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store',
     'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});
    res.end(req.method==='HEAD'?undefined:adminPage());return true;
   }
   if(!s3){json(res,503,{error:'OVH S3 is not configured'});return true;}
   try{
    if(req.method==='GET'){
     const data=(await config()).image;
     json(res,200,{enabled:!!data,imageUrl:data?imageUrl(publicOrigin,data.sha256):null,updatedAt:data?.updatedAt||null});
    }else if(req.method==='POST')await save(req,res);
    else await clear(req,res);
   }catch(e){console.error('Share config write:',e?.message);if(!res.headersSent)json(res,503,{error:'Share configuration unavailable'});else res.destroy();}
   return true;
  }
  return false;
 };
}