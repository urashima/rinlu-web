import {readFile} from 'node:fs/promises';
const p='.platform-source/rinlu-player-source/lib/server.ts';
const lines=(await readFile(p,'utf8')).split('\n');
for(let i=95;i<=165;i++)console.log('SERVER',i,lines[i-1]);
const view=(await readFile('.platform-source/rinlu-player-source/app/rinlu.tsx','utf8')).split('\n');
for(let i=0;i<view.length;i++)if(/authorize|api\/media|playback/i.test(view[i]))console.log('CLIENT',i+1,view[i].slice(0,450));
