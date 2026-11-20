/** CDN edge URLs: HMAC-SHA256 bound to immutable recording-version path and TTL.
 * CDN deployment is opt-in; secret must also exist on the CDN Worker.
 */
import {createHmac,timingSafeEqual} from 'node:crypto';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function immutableCdnKey(track,version,size){
 if(!uuid.test(track)||!Number.isSafeInteger(version)||version<1||!Number.isSafeInteger(size)||size<1||size>32*1024*1024)throw Error('Invalid versioned media metadata');
 return {key:'playback/'+track+'/v'+version+'-s'+size+'.mp3',path:'/v1/audio/'+track+'/v'+version+'-s'+size+'.mp3'};
}
export function createCdnSigner(env=process.env,clock=()=>Date.now()){
 const origin=env.RINLU_CDN_BASE_URL,secret=env.RINLU_CDN_SIGNING_KEY;
 if(!origin||!secret||secret.length<32)throw Error('CDN token settings incomplete');
 const url=new URL(origin);
 if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password||!url.hostname.endsWith('.rinlu.com'))throw Error('Invalid CDN host');
 return (track,version,size,seconds=600)=>{
  if(!Number.isSafeInteger(seconds)||seconds<30||seconds>900)throw Error('Invalid CDN link TTL');
  const {path}=immutableCdnKey(track,version,size),expires=Math.floor(clock()/1000)+seconds;
  const sig=createHmac('sha256',secret).update(path+'\n'+expires).digest('hex');
  return url.origin+path+'?exp='+expires+'&sig='+sig;
 };
}
export function assertCdnOriginToken(configured,received){
 if(!configured||!received||configured.length<32||configured.length!==received.length)throw Error('CDN origin authentication required');
 if(!timingSafeEqual(Buffer.from(configured),Buffer.from(received)))throw Error('CDN origin authentication failed');
 return true;
}
