'use client';

import {useEffect,useState,type ChangeEvent} from 'react';
import {platformUrl} from '../lib/platform-location';
import {useTranslation} from './localization-provider';

const MAX_BYTES=4*1024*1024;
const MIME_TYPES=new Set(['image/jpeg','image/png','image/webp']);
const ENDPOINT='/api/admin/share-image';

type ShareConfig={enabled:boolean;imageUrl:string|null;updatedAt?:string|null;error?:string};

async function readConfig():Promise<ShareConfig>{
 const response=await fetch(platformUrl(ENDPOINT),{credentials:'same-origin',cache:'no-store'});
 const result=await response.json() as ShareConfig;
 if(!response.ok)throw Error(result.error||'Could not load sharing settings.');
 return result;
}

export function SiteShareAdmin(){
 const tr=useTranslation();
 const [config,setConfig]=useState<ShareConfig|null>(null);
 const [file,setFile]=useState<File|null>(null);
 const [preview,setPreview]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');

 useEffect(()=>{
  const controller=new AbortController();
  fetch(platformUrl(ENDPOINT),{credentials:'same-origin',cache:'no-store',signal:controller.signal})
   .then(async response=>{
    const value=await response.json() as ShareConfig;
    if(!response.ok)throw Error(value.error||'Could not load sharing settings.');
    if(!controller.signal.aborted)setConfig(value);
   }).catch(failure=>{if(!controller.signal.aborted)setError((failure as Error).message);});
  return ()=>controller.abort();
 },[]);

 useEffect(()=>{
  if(!file){setPreview('');return;}
  const url=URL.createObjectURL(file);
  setPreview(url);
  return ()=>URL.revokeObjectURL(url);
 },[file]);

 function choose(event:ChangeEvent<HTMLInputElement>){
  setError('');setNotice('');
  const value=event.currentTarget.files?.[0]||null;
  event.currentTarget.value='';
  if(!value){setFile(null);return;}
  if(!MIME_TYPES.has(value.type)||!value.size||value.size>MAX_BYTES){
   setFile(null);
   setError(tr('Use JPEG, PNG or WebP images up to 4 MB.'));
   return;
  }
  setFile(value);
 }
 async function save(){
  if(!file||busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   const response=await fetch(platformUrl(ENDPOINT),{
    method:'POST',credentials:'same-origin',headers:{'Content-Type':file.type},body:file
   });
   const result=await response.json() as ShareConfig;
   if(!response.ok)throw Error(result.error||'Could not save share image.');
   setConfig(await readConfig());
   setFile(null);
   setNotice(tr('Share image saved. New link previews will use this image.'));
  }catch(failure){setError((failure as Error).message);}
  finally{setBusy(false);}
 }
 async function remove(){
  if(busy||!config?.enabled)return;
  if(!window.confirm(tr('Remove the current share image?')))return;
  setBusy(true);setError('');setNotice('');
  try{
   const response=await fetch(platformUrl(ENDPOINT),{method:'DELETE',credentials:'same-origin'});
   const result=await response.json() as ShareConfig;
   if(!response.ok)throw Error(result.error||'Could not remove share image.');
   setConfig({enabled:false,imageUrl:null});
   setFile(null);
   setNotice(tr('Share image removed.'));
  }catch(failure){setError((failure as Error).message);}
  finally{setBusy(false);}
 }
 const image=preview||config?.imageUrl||'';
 return <section className="panel section-space" aria-busy={busy}>
  <h3>{tr('Share image')}</h3>
  <p className="body-copy">{tr('Used for link previews when sharing the RINLU music platform. Leave empty until you upload an image.')}</p>
  {image?<img src={image} alt={tr('Current share image preview')} style={{display:'block',width:'min(320px,100%)',aspectRatio:'1',objectFit:'contain',borderRadius:12,margin:'16px 0',background:'var(--surface-2, #171d2b)'}}/>:
   <p className="muted">{config?tr('No share image configured.'):tr('Loading…')}</p>}
  <label className="field" style={{maxWidth:440}}>
   {tr('Choose image (JPEG, PNG, WebP; maximum 4 MB)')}
   <input type="file" accept="image/jpeg,image/png,image/webp" onChange={choose} disabled={busy}/>
  </label>
  <div className="button-row">
   <button type="button" className="btn primary" onClick={save} disabled={busy||!file}>{tr(busy?'Please wait…':'Save share image')}</button>
   <button type="button" className="btn" onClick={remove} disabled={busy||!config?.enabled}>{tr('Remove image')}</button>
  </div>
  {error&&<p role="alert" className="form-error">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  <p className="muted">{tr('Social apps may cache older link previews for some time.')}</p>
 </section>;
}
