import {readFile} from 'node:fs/promises';
const source='.platform-source/rinlu-player-source/app/rinlu.tsx';
const text=await readFile(source,'utf8');const l=text.split('\n');
for(let i=0;i<l.length;i++){
 if(/async function submit|const submit=|api\('upload'|const check=await fetch\(r\.url|<audio ref=|crossOrigin/i.test(l[i])){
  console.log('CONTEXT '+(i+1));
  for(let j=Math.max(0,i-8);j<=Math.min(l.length-1,i+12);j++)console.log((j+1)+': '+l[j].slice(0,2400));
 }
}
