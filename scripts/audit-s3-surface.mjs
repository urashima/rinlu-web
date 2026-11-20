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
const rx=/upload|\.put\(|\.get\(|R2|S3|presign|\\/api\\/|\\/assets|\\/media|audioUrl|audio_url|fileUrl|file_url|stream|blob|assetKey|objectKey|storage|createServer|proxy\(/i;
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
