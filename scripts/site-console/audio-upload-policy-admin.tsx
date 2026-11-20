'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {platformUrl} from '../lib/platform-location';
import {useTranslation} from './localization-provider';
type Mp3={enabled:boolean;minKbps:number;maxKbps:number;allowVbr:boolean};
type DisabledFormat={enabled:false};
type Formats={mp3:Mp3;wav:DisabledFormat;m4v:DisabledFormat;dolby_atmos:DisabledFormat;lossless:DisabledFormat};
type Policy={revision:number;formats:Formats;updatedAt?:string|null;updatedBy?:string|null;error?:string};
const ENDPOINT='/api/admin/audio-upload-policy';
const rateOptions=[32,40,48,56,64,80,96,112,128,160,192,224,256,320];
const future=[
 {key:'wav',title:'WAV / PCM',detail:'无压缩音频 · 未来按采样率和位深管理（16 / 24 / 32-bit）'},
 {key:'m4v',title:'M4V',detail:'视频容器 · 未来用于音乐视频，需要独立的视频转码与安全检查'},
 {key:'dolby_atmos',title:'Dolby Atmos',detail:'沉浸式音频 · 需要 E-AC-3 JOC / ADM BWF 等格式的独立接收与播放链路'},
 {key:'lossless',title:'无损音乐',detail:'FLAC / ALAC / PCM · 未来按采样率、位深与编码器管理'},
] as const;
async function get():Promise<Policy>{
 const response=await fetch(platformUrl(ENDPOINT),{cache:'no-store',credentials:'same-origin'});
 const value=await response.json() as Policy;
 if(!response.ok)throw Error(value.error||'无法读取音频上传策略。');
 return value;
}
export function AudioUploadPolicyAdmin(){
 const tr=useTranslation();
 const [saved,setSaved]=useState<Policy|null>(null),[draft,setDraft]=useState<Formats|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [reloadIndex,setReloadIndex]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  get().then(result=>{if(controller.signal.aborted)return;setSaved(result);setDraft(result.formats);})
   .catch(err=>{if(!controller.signal.aborted)setError((err as Error).message)});
  return ()=>controller.abort();
 },[reloadIndex]);
 function edit(mp3:Partial<Mp3>){
  setDraft(previous=>previous?{...previous,mp3:{...previous.mp3,...mp3}}:previous);
  setNotice('');setError('');
 }
 const dirty=!!saved&&!!draft&&JSON.stringify(saved.formats)!==JSON.stringify(draft);
 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!draft||!saved||busy||!dirty)return;
  setBusy(true);setError('');setNotice('');
  try{
   if(draft.mp3.minKbps>draft.mp3.maxKbps)throw Error('最低码率不能超过最高码率。');
   const response=await fetch(platformUrl(ENDPOINT),{
    method:'PUT',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
     expected_revision:saved.revision,formats:draft,
     reason:'Platform Console 修改音频格式及码率准入规则'
    })
   });
   const value=await response.json() as Policy;
   if(!response.ok)throw Error(value.error||'保存失败，请刷新配置后重试。');
   // Fresh read verifies the committed revision, not just an optimistic UI state.
   const confirmed=await get();
   if(confirmed.revision!==value.revision)throw Error('配置已变更，请重新读取。');
   setSaved(confirmed);setDraft(confirmed.formats);
   setNotice('已保存到服务器。新上传请求立即使用第 '+confirmed.revision+' 版规则，无需重新部署。');
  }catch(err){setError((err as Error).message);}
  finally{setBusy(false);}
 }
 return <section className="panel section-space" aria-busy={busy}>
  <div className="form-intro">
   <p className="eyebrow">{tr('UPLOAD POLICY / PLATFORM CONSOLE')}</p>
   <h3>{tr('音频上传格式与码率')}</h3>
   <p className="body-copy">{tr('管理员可即时调整新上传文件的准入规则。已经发布的音乐不受影响；文件仍须通过安全扫描、版权声明与审核。')}</p>
  </div>
  {!draft?<p className="muted">{tr('正在加载服务器配置…')}</p>:
  <form onSubmit={save}>
   <div className="settings-row">
    <div><b>MP3</b><p>{tr('MPEG Layer III · 目前唯一开放的音频上传格式')}</p></div>
    <label className="checkbox">
     <input type="checkbox" checked={draft.mp3.enabled} disabled={busy} onChange={e=>edit({enabled:e.target.checked})}/>
     {tr(draft.mp3.enabled?'已启用':'已停用')}
    </label>
   </div>
   <div className="form-grid" style={{marginTop:16}}>
    <label className="field">
     {tr('最低平均码率')}
     <select value={draft.mp3.minKbps} disabled={busy||!draft.mp3.enabled}
       onChange={e=>edit({minKbps:Number(e.target.value)})}>
      {rateOptions.map(rate=><option key={rate} value={rate}>{rate} kbps</option>)}
     </select>
    </label>
    <label className="field">
     {tr('最高平均码率')}
     <select value={draft.mp3.maxKbps} disabled={busy||!draft.mp3.enabled}
       onChange={e=>edit({maxKbps:Number(e.target.value)})}>
      {rateOptions.map(rate=><option key={rate} value={rate}>{rate} kbps</option>)}
     </select>
    </label>
   </div>
   <label className="checkbox" style={{display:'flex',gap:10,alignItems:'center',margin:'12px 0 20px'}}>
    <input type="checkbox" checked={draft.mp3.allowVbr} disabled={busy||!draft.mp3.enabled}
      onChange={e=>edit({allowVbr:e.target.checked})}/>
    <span>{tr('允许 VBR（以整首音频的实际平均码率判定）')}</span>
   </label>
   <p className="muted small">{tr('MP3 的标准码率上限是 320 kbps。低码率帧可以出现在 VBR 文件中，但整首平均码率必须在所选范围内。')}</p>
   {future.map(f=><div className="settings-row" key={f.key} style={{opacity:.66}}>
    <div><b>{f.title}</b><p>{tr(f.detail)}</p><small>{tr('处理器和审核链路尚未支持，不能启用')}</small></div>
    <label className="checkbox"><input type="checkbox" disabled checked={false}/>{tr('未开放')}</label>
   </div>)}
   <div className="button-row" style={{marginTop:20}}>
    <button className="btn primary" type="submit" disabled={busy||!dirty}>{tr(busy?'保存中…':'保存并立即生效')}</button>
    <button className="btn" type="button" disabled={busy} onClick={()=>{setSaved(null);setDraft(null);setNotice('');setError('');setReloadIndex(i=>i+1)}}>{tr('重新读取')}</button>
   </div>
   {saved&&<p className="muted small">{tr('策略修订版')} #{saved.revision}{saved.updatedAt?' · '+saved.updatedAt:''}</p>}
  </form>}
  {error&&<p className="form-error" role="alert">{tr(error)}</p>}
  {notice&&<p role="status">{tr(notice)}</p>}
 </section>;
}
