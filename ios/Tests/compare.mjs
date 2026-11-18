import {RinluDSP,normalizeRinlu} from './reference/core.js';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const configs=[{}, {clarity:1.2,boost:.1,bass:.8}, {clarity:1.8,boost:.15,gains:[0,0,-.5,-1,0,.5,1,.5,0,-.5]}, {bass:1.6,clarity:.9,boost:.2},{clarity:.6,width:1.24,room:.14,boost:.05},{crossfeed:.12},{warmth:.3,bass:1},{compression:.45,leveling:.25,preamp:-2}];
for(let i=0;i<9;i++)configs.push({bands:[10,15,25,31][i%4],gains:Array.from({length:31},(_,j)=>Math.sin(j+.3+i*.19)*3),pan:.2,balance:-2,normalization:-8,harmonics:.6,clarity:2.5,width:i%2?.7:1.55,room:.2,decay:.62,q:1.6,compression:.6,deesser:.7,bass:2,warmth:.4,leveling:.35,boost:.24,crossfeed:.12,fir:i===8?Array.from({length:2048},(_,j)=>j===0?.8:Math.sin(j*.05)*Math.exp(-j/320)*.003):[.8,.2,-.03]});
let worst=0, count=0;
for(const rate of [44100,48000])for(const quality of ['aligned','refined'])for(const patch of configs){
 const s=normalizeRinlu({...patch,quality}), frames=8192, inL=new Float32Array(frames),inR=inL.slice(),l=inL.slice(),r=l.slice();
 for(let i=0;i<frames;i++){inL[i]=i===0?1:Math.sin(i*.17)*.24;inR[i]=Math.cos(i*.037)*.19;}
 const ref=new RinluDSP(rate,s);ref.process(inL,inR,l,r);
 const params=[rate,frames,s.bands,+(quality==='refined'),...['boost','q','balance','normalization','bass','harmonics','clarity','warmth','deesser','width','crossfeed','room','decay','compression','leveling','preamp','pan'].map(k=>s[k]),...s.gains,s.fir.length,...s.fir].join(' ')+'\n';
 const stereo=new Float32Array(frames*2);for(let i=0;i<frames;i++){stereo[i*2]=inL[i];stereo[i*2+1]=inR[i];}
 const p=spawnSync(process.argv[2],[params],{input:Buffer.from(stereo.buffer)});assert.equal(p.status,0);assert.equal(p.stdout.length,stereo.byteLength);let peak=0;
 for(let i=0;i<frames;i++)peak=Math.max(peak,Math.abs(l[i]-p.stdout.readFloatLE(8*i)),Math.abs(r[i]-p.stdout.readFloatLE(8*i+4)));
 worst=Math.max(peak,worst);assert.ok(peak<.00002,JSON.stringify({rate,quality,patch,peak}));count++;
}
console.log(count+' reference cases passed. Maximum absolute sample difference '+worst);
