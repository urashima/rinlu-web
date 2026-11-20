/** Read-only audit of the published corresponding source. No runtime secrets. */
import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
const root='.platform-source/rinlu-player-source';
const files=[
 'lib/media-storage.ts',
 'lib/ovh-media-migration.ts',
 'app/api/[...path]/route.ts',
 'lib/server.ts',
 'lib/media-service.ts',
 'db/schema.ts'
];
for (const file of files) {
 const path=join(root,file);
 const content=await readFile(path,'utf8');
 const lines=content.split('\n');
 console.log('AUDIT_FILE_START',file,'bytes',content.length,'lines',lines.length);
 let count=0;
 for (let i=0;i<lines.length;i++) {
   const important=/media|upload|asset|track|stream|storage|migrat|s3|r2|bucket|\.put\(|\.get\(|create.*route|listen/i.test(lines[i]);
   if (file==='lib/media-storage.ts'||file==='lib/ovh-media-migration.ts'||file==='app/api/[...path]/route.ts'||(important&&count<180)) {
     console.log('AUDIT_LINE',file,i+1,lines[i].slice(0,550));
     count++;
   }
   if(count>=300)break;
 }
 console.log('AUDIT_FILE_END',file);
}
