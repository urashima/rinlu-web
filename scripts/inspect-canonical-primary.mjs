import {readFile,readdir} from 'node:fs/promises';
const root='.platform-source/rinlu-player-source';
const paths=['lib/server.ts','lib/backend.ts','lib/media-service.ts','lib/media-storage.ts','db/schema.ts','lib/artwork-jpeg.ts'];
for(const f of paths){
 let source;
 try{source=await readFile(root+'/'+f,'utf8')}catch{console.log('SOURCE_MISSING',f);continue}
 const lines=source.split('\n');
 console.log('SOURCE_FILE',f,'lines',lines.length);
 for(let i=0;i<lines.length;i++){
  if(f==='lib/server.ts' && i>=330)continue;
  if(f==='lib/media-service.ts' && i>=125)continue;
  console.log('SOURCE_LINE',f,i+1,lines[i].slice(0,800));
 }
 console.log('SOURCE_END',f);
}
for(const dir of ['lib','db','app']){
 const files=(await readdir(root+'/'+dir)).filter(x=>/asset|auth|artwork|storage|upload|service|backend|database|queue/i.test(x));
 console.log('SOURCE_NAMES',dir,files.join(','));
}
