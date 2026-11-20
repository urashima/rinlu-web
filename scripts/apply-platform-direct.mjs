/** Apply RINLU S3 direct upload and CORS-compatible playback to canonical React UI. */
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function applyPlatformDirect(root){
 const path=join(root,'app/rinlu.tsx');
 let body=await readFile(path,'utf8');
 const ensure=(needle,name)=>{const n=body.split(needle).length-1;if(n!==1)throw Error('Canonical '+name+' integration point changed: '+n);};
 const marker="async function upload(file:File,kind:string,progress:(p:number)=>void):Promise<any>{\n if(kind==='artwork')file=await compressArtwork(file);\n return new Promise";
 ensure(marker,'browser upload');
 const direct="async function upload(file:File,kind:string,progress:(p:number)=>void):Promise<any>{\n  if(kind==='artwork')file=await compressArtwork(file);\n  // The file bytes go directly from the browser to private OVH S3.\n  // The completion request contains only an authenticated upload ticket.\n  const init=await fetch(platformUrl('/api/storage/direct/init'),{\n    method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',\n    body:JSON.stringify({kind,size:file.size,name:file.name})\n  }).catch(()=>null);\n  if(init?.ok){\n    const grant=await init.json();\n    if(!grant?.upload?.url||!grant.ticket)throw Error('Invalid signed upload authorization');\n    const payload=new FormData();\n    for(const [key,value] of Object.entries(grant.upload.fields as Record<string,string>))payload.append(key,String(value));\n    payload.append('file',file,file.name);\n    await new Promise<void>((resolve,reject)=>{\n      const xhr=new XMLHttpRequest();\n      xhr.open('POST',grant.upload.url);\n      xhr.upload.onprogress=e=>{if(e.lengthComputable)progress(Math.round(e.loaded/e.total*90))};\n      xhr.onload=()=>[200,201,204].includes(xhr.status)?resolve():reject(Error('OVH storage rejected the upload (HTTP '+xhr.status+').'));\n      xhr.onerror=()=>reject(Error('Direct storage upload failed; check your connection and retry.'));\n      xhr.send(payload);\n    });\n    progress(93);\n    const final=await fetch(platformUrl('/api/storage/direct/complete'),{\n      method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',\n      body:JSON.stringify({ticket:grant.ticket,kind})\n    });\n    const result=await final.json().catch(()=>({error:'Upload registration failed'}));\n    if(!final.ok)throw Error(result.error||'Cannot finish upload registration');\n    progress(100);\n    return result;\n  }\n  // The legacy upload path remains available until the primary backend is upgraded.\n  return new Promise";
 body=body.replace(marker,direct);
 const probe="const check=await fetch(r.url,{method:'HEAD'});";
 ensure(probe,'playback probe');
 body=body.replace(probe,"const check=await fetch(r.probe_url||r.url,{method:'HEAD'});");
 const audio='<audio ref={audio} preload="metadata"';
 ensure(audio,'WebAudio CORS');
 body=body.replace(audio,'<audio ref={audio} crossOrigin="anonymous" preload="metadata"');
 await writeFile(path,body);
 console.log('RINLU S3 direct upload and signed playback overlay applied');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 await applyPlatformDirect(process.argv[2]||'.platform-source/rinlu-player-source');
}
