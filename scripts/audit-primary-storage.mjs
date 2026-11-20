import {readFile} from 'node:fs/promises';
const root='.platform-source/rinlu-player-source/';
const list=[
 'lib/media-storage.ts','lib/ovh-media-migration.ts','lib/media-service.ts',
 'lib/server.ts','db/schema.ts','lib/asset-validation.ts'
];
for(const file of list){
 let lines;
 try{lines=(await readFile(root+file,'utf8')).split('\n')}catch{console.log('AUDIT_MISSING',file);continue}
 console.log('AUDIT_FILE',file,lines.length);
 if(file.endsWith('media-storage.ts')||file.endsWith('ovh-media-migration.ts')||file.endsWith('media-service.ts')){
  for(let i=0;i<Math.min(lines.length,260);i++)console.log('AUDIT',file,i+1,lines[i].slice(0,420));
 }else{
  let n=0;
  for(let i=0;i<lines.length;i++)if(/resource==='upload'|async function upload|function upload|storage_key|mediaStorage\.|recording|INSERT INTO assets|INSERT INTO jobs|/i.test(lines[i])){
   for(let j=Math.max(0,i-4);j<=Math.min(lines.length-1,i+7);j++){
    if(n++>245)break;
    console.log('AUDIT',file,j+1,lines[j].slice(0,420));
   }
   if(n>245)break;
  }
 }
}
