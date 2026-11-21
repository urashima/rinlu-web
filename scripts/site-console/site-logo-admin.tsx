'use client';
import {useEffect,useState} from 'react';
import {platformUrl} from '../lib/platform-location';
import {useTranslation} from './localization-provider';
type Config={version:number;full:string;compact:string;updatedAt:string|null;error?:string};
const FULL=[['rinlu-full-vector','Horizontal · Vector'],['rinlu-full-cutout','Horizontal · Cutout']] as const;
const COMPACT=[['rinlu-icon-vector','Square icon · Vector'],['rinlu-icon-cutout','Square icon · Cutout'],['rinlu-symbol-only','Note + controller · Symbol only']] as const;
const API='/api/admin/logo';
const asset=(name:string)=>platformUrl('/brand/'+name+'.svg');
const initial:Config={version:1,full:FULL[0][0],compact:COMPACT[0][0],updatedAt:null};
export function SiteLogoAdmin(){
 const tr=useTranslation();
 const [loaded,setLoaded]=useState(false);
 const [value,setValue]=useState<Config>(initial);
 const [saved,setSaved]=useState<Config|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  fetch(platformUrl(API),{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(async r=>{
   const c=await r.json() as Config;if(!r.ok)throw Error(c.error||'Logo settings unavailable');
   if(!controller.signal.aborted){setValue(c);setSaved(c);setLoaded(true);}
  }).catch(e=>{if(!controller.signal.aborted)setError((e as Error).message);});
  return ()=>controller.abort();
 },[]);
 async function submit(){
  if(busy||!loaded)return;
  setBusy(true);setNotice('');setError('');
  try{
   const body=JSON.stringify({full:value.full,compact:value.compact});
   const r=await fetch(platformUrl(API),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body});
   const c=await r.json() as Config;if(!r.ok)throw Error(c.error||'Could not update logo');
   setValue(c);setSaved(c);setNotice(tr('Logo saved. The next page load will use the selected original SVGs without a redeploy.'));
   // Refresh any logo images in the current admin tab without triggering a full navigation.
   document.querySelectorAll<HTMLImageElement>('img[data-rinlu-brand]').forEach(img=>{
    const u=new URL(img.src);u.searchParams.set('updated',String(Date.now()));img.src=u.toString();
   });
  }catch(e){setError((e as Error).message);}
  finally{setBusy(false);}
 }
 const dirty=!!saved&&(value.full!==saved.full||value.compact!==saved.compact);
 return <section className="panel section-space" aria-busy={busy}>
  <h3>{tr('Logo')}</h3>
  <p className="body-copy">{tr('Use the five original vector files supplied for RINLU. The artwork is not converted or redrawn. Changes are stored in OVH S3 and take effect without a deployment.')}</p>
  <div className="grid grid-cols-2 gap-4" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,280px),1fr))',gap:18,marginTop:16}}>
   <label className="field" style={{display:'grid',gap:8}}>
    {tr('Desktop and sign-in logo')}
    <select value={value.full} onChange={e=>setValue({...value,full:e.currentTarget.value})} disabled={!loaded||busy}>
     {FULL.map(([id,name])=><option value={id} key={id}>{name}</option>)}
    </select>
    <span style={{display:'grid',gap:8}}>
     <span style={{background:'#fafafa',border:'1px solid #bfc4ca',borderRadius:12,padding:16,display:'grid',placeItems:'center',height:100}}>
      <img src={asset(value.full)} alt={tr('Desktop logo on light background')} style={{display:'block',width:'100%',maxWidth:260,maxHeight:68,objectFit:'contain'}}/>
     </span>
     <span style={{background:'#11151f',borderRadius:12,padding:16,display:'grid',placeItems:'center',height:100}}>
      <img src={asset(value.full)} alt={tr('Desktop logo on dark background')} style={{display:'block',width:'100%',maxWidth:260,maxHeight:68,objectFit:'contain',filter:'invert(1)'}}/>
     </span>
    </span>
   </label>
   <label className="field" style={{display:'grid',gap:8}}>
    {tr('Mobile / collapsed navigation / favicon')}
    <select value={value.compact} onChange={e=>setValue({...value,compact:e.currentTarget.value})} disabled={!loaded||busy}>
     {COMPACT.map(([id,name])=><option value={id} key={id}>{name}</option>)}
    </select>
    <span style={{display:'flex',gap:8}}>
     <span style={{flex:1,background:'#fafafa',border:'1px solid #bfc4ca',borderRadius:12,display:'grid',placeItems:'center',height:100}}>
      <img src={asset(value.compact)} alt={tr('Compact logo on light background')} style={{width:72,height:72,objectFit:'contain'}}/>
     </span>
     <span style={{flex:1,background:'#11151f',borderRadius:12,display:'grid',placeItems:'center',height:100}}>
      <img src={asset(value.compact)} alt={tr('Compact logo on dark background')} style={{width:72,height:72,objectFit:'contain',filter:'invert(1)'}}/>
     </span>
    </span>
   </label>
  </div>
  <div className="button-row" style={{marginTop:14}}>
   <button type="button" className="btn primary" onClick={()=>void submit()} disabled={!dirty||busy||!loaded}>{tr(busy?'Saving…':'Save logo')}</button>
   <button type="button" className="btn" onClick={()=>setValue({...value,full:initial.full,compact:initial.compact})} disabled={!loaded||busy}>{tr('Restore default selection')}</button>
  </div>
  {error&&<p className="form-error" role="alert">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  {saved?.updatedAt&&<p className="muted">{tr('Last updated')}: {new Date(saved.updatedAt).toLocaleString()}</p>}
  <p className="muted">{tr('SVG files are served as provided. Color inversion is applied by CSS only when dark theme is active.')}</p>
 </section>;
}
