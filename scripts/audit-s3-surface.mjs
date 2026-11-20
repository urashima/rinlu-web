import {readdir,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
const root='.platform-source/rinlu-player-source';
async function walk(path='') {
  const dir=join(root,path);
  const out=[];
  for (const ent of await readdir(dir,{withFileTypes:true})) {
    if (['node_modules','platform-dist','.git'].includes(ent.name))continue;
    const p=path?path+'/'+ent.name:ent.name;
    if(ent.isDirectory())out.push(...await walk(p));
    else if(/\.(tsx?|mjs|js|json|sql)$/.test(ent.name))out.push(p);
  }
  return out;
}
const files=await walk();
console.log('AUDIT_FILES',files.length);
const matched=files.filter(p=>/upload|storage|media|catalog|server|api|asset|track|schema|client|service|auth/i.test(p));
console.log('AUDIT_NAMES',matched.join('\n'));
const rx=/upload|\.put\(|\.get\(|R2|S3|presign|api|assets|media|audioUrl|audio_url|fileUrl|file_url|stream|blob|assetKey|objectKey|storage|createServer|proxy\(/i;
let lines=0;
for(const p of matched){
 if(!/^(app|deployment|server|worker|api|src)\//.test(p))continue;
 const f=join(root,p);
 const size=(await stat(f)).size;
 if(size>120000)continue;
 const content=await readFile(f,'utf8'),arr=content.split('\n');
 const hits=[];
 for(let i=0;i<arr.length;i++)if(rx.test(arr[i]))hits.push(i);
 if(!hits.length)continue;
 console.log('AUDIT_FILE',p,'lines',arr.length,'hits',hits.length);
 for(const i of hits.slice(0,35)){
   console.log(String(i+1).padStart(4,' '),arr[i].slice(0,250));
   lines++;if(lines>340){console.log('AUDIT_LIMIT');process.exit(0)}
 }
}
\nfor (const p of ['lib/media-storage.ts','lib/ovh-media-migration.ts','app/api/[...path]/route.ts','lib/server.ts','lib/media-service.ts','db/schema.ts']) {\n const body=await readFile(join(root,p),'utf8');\n const arr=body.split('\\n');\n console.log('AUDIT_DETAIL',p,'bytes',body.length,'lines',arr.length);\n if (['lib/media-storage.ts','lib/ovh-media-migration.ts','app/api/[...path]/route.ts'].includes(p)) {\n  for(let i=0;i<Math.min(arr.length,190);i++) console.log('DETAIL',p,i+1,arr[i].slice(0,400));\n }else{\n  let n=0;\n  for(let i=0;i<arr.length;i++) if(/media|upload|asset|track|stream|storage|migrat|\\/api\\//i.test(arr[i])) {\n   for(let j=Math.max(0,i-2);j<=Math.min(arr.length-1,i+2);j++){\n    if(n++>110)break;\n    console.log('DETAIL',p,j+1,arr[j].slice(0,400));\n   }\n   if(n>110)break;\n  }\n }\n}\n