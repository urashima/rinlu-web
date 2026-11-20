import {readFile} from 'node:fs/promises';
const root='.platform-source/rinlu-player-source';
const names=['app/rinlu.tsx','lib/server.ts','lib/media-service.ts','lib/capacity.ts','lib/asset-validation.ts'];
for(const name of names){
 let value;
 try{value=await readFile(root+'/'+name,'utf8')}catch{console.log('AUDIT_MISSING',name);continue;}
 const lines=value.split('\n'), matches=[];
 for(let i=0;i<lines.length;i++){
  if(/(?:mp3|bitrate|192|320|audio\/mpeg|audio.*accept|upload.*max|compressArtwork|async function upload)/i.test(lines[i]) ){
   matches.push(i);
  }
 }
 console.log('AUDIT_FILE',name,lines.length,matches.length);
 const selected=new Set();
 for(const i of matches.slice(0,name==='app/rinlu.tsx'?110:150)){
  for(let j=Math.max(0,i-2);j<=Math.min(lines.length-1,i+3);j++)selected.add(j);
 }
 for(const i of [...selected].sort((a,b)=>a-b))console.log('AUDIT',name,i+1,lines[i].slice(0,420));
}
