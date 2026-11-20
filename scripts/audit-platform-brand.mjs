import {readdir,readFile,stat} from 'node:fs/promises';
import {join,relative} from 'node:path';
const root='.platform-source/rinlu-player-source';
let found=0, visited=0;
async function walk(dir, depth=0){
 if(depth>10||found>=65)return;
 for(const ent of await readdir(dir,{withFileTypes:true})){
  if(/^(node_modules|\.git|dist|platform-dist|public|vendor|\.next|coverage|\.pnpm)$/.test(ent.name))continue;
  const file=join(dir,ent.name);
  if(ent.isDirectory()){await walk(file,depth+1);continue;}
  if(!/\.(tsx?|jsx?|css|html)$/.test(ent.name))continue;
  if((await stat(file)).size>400000)continue;
  visited++;
  const src=await readFile(file,'utf8'), lines=src.split(/\r?\n/);
  for(let i=0;i<lines.length&&found<65;i++){
   const line=lines[i];
   if(/(RINLU|rinlu|logo|wordmark)/i.test(line)&&/(RINLU|rinlu|logo|wordmark|sidebar|brand)/i.test(line)){
     found++;
     console.log('BRAND_AUDIT',relative(root,file)+':'+(i+1),line.trim().slice(0,340));
   }
  }
 }
}
await walk(root);
console.log('BRAND_AUDIT_SUMMARY',JSON.stringify({visited,found}));
