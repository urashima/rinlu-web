/** RINLU original-SVG branding configuration, persisted in existing OVH S3.
 * Bundled originals stay byte-for-byte unchanged. No SVG uploads or mutation.
 */
import {readFile} from 'node:fs/promises';
const KEY='site-brand/logo-config-v1.json';
const fulls=['rinlu-full-vector','rinlu-full-cutout'];
const compacts=['rinlu-icon-vector','rinlu-icon-cutout','rinlu-symbol-only'];
export const defaults=Object.freeze({version:1,full:'rinlu-full-vector',compact:'rinlu-icon-vector',updatedAt:null});
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
const normalize=c=>({version:1,full:fulls.includes(c?.full)?c.full:defaults.full,compact:compacts.includes(c?.compact)?c.compact:defaults.compact,updatedAt:typeof c?.updatedAt==='string'?c.updatedAt:null});
export function createBrandLogo({s3,backendOrigin,publicOrigin,accountBearer,transport=fetch,readSvg=filename=>readFile(new URL('./public/brand/'+filename,import.meta.url))}){
 let cache=null,until=0;
 async function config(){
  if(!s3)return {...defaults};
  if(cache&&Date.now()<until)return cache;
  const result=await s3.get(KEY);
  const raw=result?await result.text():null;
  if(raw&&raw.length>2048)throw Error('Brand settings too large');
  cache=raw?normalize(JSON.parse(raw)):{...defaults};until=Date.now()+5000;
  return cache;
 }
 async function requireAdmin(req){
  const auth=accountBearer(req);
  if(!auth)return 401;
  const r=await transport(new URL('/api/me',backendOrigin),{method:'GET',headers:{authorization:auth,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!r.ok){await r.body?.cancel();return r.status===401?401:403;}
  const me=await r.json();
  return me?.user?.role==='admin'&&me?.user?.status!=='suspended'?200:403;
 }
 async function logo(req,res,url){
  const slot=url.searchParams.get('slot');
  if(slot!=='full'&&slot!=='compact'&&slot!=='account')return send(res,400,{error:'Unsupported logo slot'});
  const cfg=await config();
  const variant=slot==='compact'?cfg.compact:cfg.full;
  const bytes=await readSvg(variant+'.svg');
  res.writeHead(200,{'Content-Type':'image/svg+xml; charset=utf-8','Content-Length':String(bytes.length),
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox"});
  if(req.method==='HEAD')return res.end();
  res.end(bytes);
 }
 async function save(req,res){
  if(req.headers.origin!==publicOrigin)return send(res,403,{error:'Invalid request origin'});
  if(String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase()!=='application/json')return send(res,415,{error:'JSON required'});
  const size=Number(req.headers['content-length']);
  if(!Number.isSafeInteger(size)||size<2||size>2048)return send(res,413,{error:'Invalid content size'});
  let n=0;const parts=[];
  for await(const chunk of req){n+=chunk.length;if(n>2048)return send(res,413,{error:'Payload too large'});parts.push(chunk);}
  if(n!==size)return send(res,422,{error:'Body size mismatch'});
  let body;try{body=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{return send(res,400,{error:'Invalid JSON'});}
  if(!body||typeof body!=='object'||!fulls.includes(body.full)||!compacts.includes(body.compact))return send(res,422,{error:'Unknown original SVG variant'});
  const cfg={version:1,full:body.full,compact:body.compact,updatedAt:new Date().toISOString()};
  await s3.put(KEY,Buffer.from(JSON.stringify(cfg)),'application/json');
  cache=cfg;until=Date.now()+5000;
  return send(res,200,cfg);
 }
 return async function handle(req,res){
  const url=new URL(req.url||'/',publicOrigin),path=url.pathname;
  if(path==='/music/api/brand/config'){
   if(req.method!=='GET')return send(res,405,{error:'Method not allowed'}),true;
   try{send(res,200,await config());}catch(e){console.error('Brand config:',e?.message);send(res,503,{error:'Brand settings unavailable'});}return true;
  }
  if(path==='/music/api/brand/logo'){
   if(!['GET','HEAD'].includes(req.method))return send(res,405,{error:'Method not allowed'}),true;
   try{await logo(req,res,url);}catch(e){console.error('Brand logo:',e?.message);if(!res.headersSent)send(res,503,{error:'Logo unavailable'});else res.destroy();}return true;
  }
  if(path==='/music/api/admin/logo'){
   if(!['GET','POST'].includes(req.method))return send(res,405,{error:'Method not allowed'}),true;
   let auth;try{auth=await requireAdmin(req);}catch(e){console.error('Logo admin auth:',e?.message);send(res,503,{error:'Authentication unavailable'});return true;}
   if(auth!==200)return send(res,auth,{error:'Administrator required'}),true;
   if(!s3)return send(res,503,{error:'OVH S3 is not configured'}),true;
   try{if(req.method==='GET')send(res,200,await config());else await save(req,res);}
   catch(e){console.error('Logo config write:',e?.message);if(!res.headersSent)send(res,503,{error:'Logo settings unavailable'});else res.destroy();}return true;
  }
  return false;
 };
}
