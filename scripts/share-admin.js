/* RINLU independent sharing-admin UI: no React router modifications. */
(()=>{'use strict';
 const PAGE='/music/admin/share-image',API='/music/api/admin/share-image';
 let checked=false,allowed=false,pending=false;
 function link(){
  if(!allowed||!location.pathname.startsWith('/music/admin')||location.pathname===PAGE||
     document.querySelector('[data-rinlu-share-entry]'))return;
  const anchors=[...document.querySelectorAll('a[href]')];
  const match=a=>{try{return /^\/music\/admin\/?$/.test(new URL(a.href).pathname);}catch{return false;}};
  const existing=anchors.find(a=>match(a)&&a.closest('aside,nav,[role="navigation"]'))||anchors.find(match);
  const el=document.createElement('a');el.href=PAGE;el.textContent='分享图 / Share Image';
  el.dataset.rinluShareEntry='true';
  el.style.cssText='display:inline-flex;padding:10px 12px;border-radius:9px;color:inherit;text-decoration:none;font-size:14px;';
  if(existing)existing.insertAdjacentElement('afterend',el);
  else {el.style.cssText+='position:fixed;right:20px;bottom:92px;z-index:9999;background:#303b54;color:#fff;';document.body.appendChild(el);}
 }
 async function check(){
  if(!location.pathname.startsWith('/music/admin')||location.pathname===PAGE||pending)return;
  if(checked){link();return;}
  pending=true;
  try{const r=await fetch(API,{cache:'no-store',credentials:'same-origin'});allowed=r.ok;checked=true;if(allowed)link();}
  catch{}finally{pending=false;}
 }
 async function editor(){
  const file=document.getElementById('file');if(!file)return;
  const save=document.getElementById('save'),clear=document.getElementById('clear'),
   image=document.getElementById('preview'),empty=document.getElementById('empty'),status=document.getElementById('status');
  let local=null;
  function show(url){image.hidden=!url;empty.hidden=!!url;if(url)image.src=url;else image.removeAttribute('src');}
  async function load(){
   const r=await fetch(API,{credentials:'same-origin',cache:'no-store'});
   if(!r.ok)throw Error('读取配置失败（HTTP '+r.status+'）');
   const data=await r.json();clear.disabled=!data.enabled;show(data.imageUrl?data.imageUrl+'&t='+Date.now():null);
   status.textContent=data.enabled?'分享图已启用':'尚未配置分享图片';
  }
  file.addEventListener('change',()=>{
   if(local)URL.revokeObjectURL(local);
   const selected=file.files?.[0];save.disabled=!selected;
   if(selected){local=URL.createObjectURL(selected);show(local);}
   else load().catch(e=>status.textContent=e.message);
  });
  save.addEventListener('click',async()=>{
   const selected=file.files?.[0];if(!selected)return;
   if(!['image/jpeg','image/png','image/webp'].includes(selected.type)||selected.size>4*1024*1024){
    status.textContent='仅支持最大 4 MB 的 JPEG、PNG、WebP';return;
   }
   save.disabled=true;clear.disabled=true;status.textContent='正在保存……';
   try{
    const r=await fetch(API,{method:'POST',credentials:'same-origin',headers:{'Content-Type':selected.type},body:selected});
    if(!r.ok)throw Error((await r.json()).error||'保存失败');
    file.value='';if(local){URL.revokeObjectURL(local);local=null;}
    await load();status.textContent='保存成功，分享预览已经更新';
   }catch(e){status.textContent=e.message;save.disabled=false;clear.disabled=false;}
  });
  clear.addEventListener('click',async()=>{
   if(!confirm('确定清除 RINLU 分享图吗？'))return;
   clear.disabled=true;status.textContent='正在清除……';
   try{
    const r=await fetch(API,{method:'DELETE',credentials:'same-origin'});
    if(!r.ok)throw Error((await r.json()).error||'清除失败');
    file.value='';save.disabled=true;await load();status.textContent='已清除分享图';
   }catch(e){status.textContent=e.message;clear.disabled=false;}
  });
  try{await load();}catch(e){status.textContent=e.message;}
 }
 function init(){
  if(location.pathname===PAGE)editor();
  else{check();new MutationObserver(check).observe(document.body,{childList:true,subtree:true});window.addEventListener('popstate',check);}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();