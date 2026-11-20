import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const root='.platform-source/rinlu-player-source';
const files=[
 'deployment/platform/server.mjs','deployment/platform/Dockerfile','package.json',
 'lib/server.ts','lib/media-service.ts'
];
for (const file of files) {
 const body=await readFile(join(root,file),'utf8');
 const lines=body.split('\n');
 console.log('AUDIT_START',file,'length',body.length,'lines',lines.length);
 let ranges=[];
 if(file==='lib/server.ts') ranges=[[60,140],[188,218],[275,320]];
 else if(file==='lib/media-service.ts') ranges=[[1,26],[78,115]];
 else ranges=[[1,Math.min(lines.length,200)]];
 for(const [start,end] of ranges){
  for(let i=start;i<=end;i++)console.log('AUDIT_L',file,i,lines[i-1]?.slice(0,900));
 }
 console.log('AUDIT_END',file);
}
