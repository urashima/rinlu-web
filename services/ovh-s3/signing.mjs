/** Server-only S3 SigV4 GET presigner and exact-key browser POST policy.
 * The caller must enforce account permissions; no bucket ACL is made public.
 */
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
const hash=(value)=>createHash('sha256').update(value).digest('hex');
const hmac=(key,value)=>createHmac('sha256',key).update(value).digest();
const escape=(value)=>encodeURIComponent(value).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const objectPath=(key)=>key.split('/').map(escape).join('/');
export function createS3Signer(env=process.env,clock=()=>new Date()){
 const {RINLU_S3_ENDPOINT:endpoint,RINLU_S3_REGION:region,RINLU_S3_BUCKET:bucket,RINLU_S3_ACCESS_KEY_ID:access,RINLU_S3_SECRET_ACCESS_KEY:secret}=env;
 if(!endpoint||!region||!bucket||!access||!secret)throw Error('S3 signer configuration incomplete');
 const u=new URL(endpoint);
 const hostname='s3.'+region+'.io.cloud.ovh.'+(region.startsWith('us-')?'us':'net');
 if(u.protocol!=='https:'||u.host!==hostname||u.pathname!=='/'||u.search||u.hash||u.username||u.password)throw Error('Unsafe S3 signing endpoint');
 if(!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))throw Error('Unsafe S3 bucket name');
 const date=()=>clock().toISOString().replace(/[:-]|\.\d{3}/g,'');
 const credentials=(stamp)=>{
  const day=stamp.slice(0,8),scope=day+'/'+region+'/s3/aws4_request';
  const signingKey=hmac(hmac(hmac(hmac('AWS4'+secret,day),region),'s3'),'aws4_request');
  return {scope,signingKey,credential:access+'/'+scope};
 };
 const path=(key)=>{
  if(typeof key!=='string'||key.length<1||key.length>450||!/^[A-Za-z0-9/_\-.]+$/.test(key)||key.split('/').some(s=>s===''||s==='.'||s==='..'))throw Error('Unsafe S3 object key');
  return '/'+escape(bucket)+'/'+objectPath(key);
 };
 function signedGet(key,expiresSeconds=600){
  if(!Number.isSafeInteger(expiresSeconds)||expiresSeconds<1||expiresSeconds>3600)throw Error('Unsafe GET expiration');
  const stamp=date(),{scope,signingKey,credential}=credentials(stamp),uri=path(key);
  const params=[
   ['X-Amz-Algorithm','AWS4-HMAC-SHA256'],['X-Amz-Credential',credential],
   ['X-Amz-Date',stamp],['X-Amz-Expires',String(expiresSeconds)],['X-Amz-SignedHeaders','host']
  ];
  const query=params.map(([k,v])=>escape(k)+'='+escape(v)).sort().join('&');
  const canonical=['GET',uri,query,'host:'+u.host+'\n','host','UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign=['AWS4-HMAC-SHA256',stamp,scope,hash(canonical)].join('\n');
  const signature=createHmac('sha256',signingKey).update(stringToSign).digest('hex');
  return u.origin+uri+'?'+query+'&X-Amz-Signature='+signature;
 }
 function postPolicy(key,contentType,size,expiresSeconds=300){
  path(key);
  if(!['audio/mpeg','image/jpeg','application/octet-stream'].includes(contentType))throw Error('Unsupported S3 upload type');
  if(!Number.isSafeInteger(size)||size<100||size>25*1024*1024)throw Error('Unsupported S3 upload size');
  if(!Number.isSafeInteger(expiresSeconds)||expiresSeconds<1||expiresSeconds>900)throw Error('Unsafe POST expiration');
  const stamp=date(),{signingKey,credential}=credentials(stamp);
  const fields={
   key,
   'Content-Type':contentType,
   'success_action_status':'204',
   'x-amz-algorithm':'AWS4-HMAC-SHA256',
   'x-amz-credential':credential,
   'x-amz-date':stamp,
  };
  const conditions=[
   {bucket},{key},{'Content-Type':contentType},{success_action_status:'204'},
   {'x-amz-algorithm':fields['x-amz-algorithm']},
   {'x-amz-credential':credential},
   {'x-amz-date':stamp},
   ['content-length-range',size,size],
  ];
  const policy=Buffer.from(JSON.stringify({expiration:new Date(clock().getTime()+expiresSeconds*1000).toISOString(),conditions})).toString('base64');
  return {url:u.origin+'/'+escape(bucket),fields:{...fields,policy,'x-amz-signature':createHmac('sha256',signingKey).update(policy).digest('hex')},expiresIn:expiresSeconds};
 }
 return {signedGet,postPolicy};
}
export const uploadNonce=()=>randomBytes(24).toString('hex');
export function signedTicket(secret,payload){
 const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
 const signature=createHmac('sha256',secret).update(encoded).digest('base64url');
 return encoded+'.'+signature;
}
export function verifyTicket(secret,ticket,now=Date.now()){
 if(typeof ticket!=='string'||ticket.length>1500)throw Error('Invalid direct upload ticket');
 const [encoded,signature,extra]=ticket.split('.');
 if(!encoded||!signature||extra!==undefined)throw Error('Malformed direct upload ticket');
 const expected=createHmac('sha256',secret).update(encoded).digest();
 const supplied=Buffer.from(signature,'base64url');
 if(supplied.length!==expected.length||!timingSafeEqual(expected,supplied))throw Error('Invalid direct upload ticket signature');
 let payload;
 try{payload=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'))}catch{throw Error('Malformed direct upload ticket payload')}
 if(!Number.isSafeInteger(payload?.expires)||payload.expires<=now)throw Error('Direct upload ticket expired');
 return payload;
}
