import {readFile} from 'node:fs/promises';
const root='.platform-source/rinlu-player-source/';
const ranges={
 'lib/server.ts':[[1,75],[155,235],[250,325]],
 'lib/media-service.ts':[[1,51],[85,117]],
 'lib/operations.ts':[[1,160]],
 'lib/capacity.ts':[[1,35]],
 'lib/backend.ts':[[1,85]],
 'app/rinlu.tsx':[[400,460],[560,585]],
 'app/site-font-admin.tsx':[[1,85]],
};
for(const [file,sections]of Object.entries(ranges)){
 let lines;
 try{lines=(await readFile(root+file,'utf8')).split('\n')}catch{console.log('SRC_MISSING',file);continue}
 console.log('SRC_FILE',file,lines.length);
 for(const [start,end]of sections)for(let i=start;i<=Math.min(end,lines.length);i++)console.log('SRC',file,i,lines[i-1].slice(0,Math.max(file==='app/rinlu.tsx'?600:1500,600)));
}
