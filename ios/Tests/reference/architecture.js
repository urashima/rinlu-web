/** SPDX-License-Identifier: AGPL-3.0-or-later. Copyright notices: ./kernel/NOTICE.txt */
import './kernel/equalizer.js';
import './kernel/parameters.js';
import './kernel/space.js';
import './kernel/clarity.js';
import './kernel/stereo.js';
import './kernel/dynamics.js';
import './kernel/chain.js';
import {kernel} from './kernel/registry.js';
export {kernel};
export const bands10=Array.from(kernel.filters.frequencyCenters);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function controlValues(s){return {fidelity:s.clarity/.6,ambience:s.room/.035,surround:clamp((s.width-1)/.08,0,10),bass:s.bass/.8,dynamicBoost:s.boost*10,volumeLeveling:s.leveling*4,gains:s.bands===10?s.gains:Array(10).fill(0),qMultiplier:s.q,masterGainDb:s.preamp,balanceDb:s.balance,normalizationDb:s.normalization}}
// Windowed-sinc lowpass, 65 taps at 4fs. Two filters together delay 16 base samples.
export function oversamplingKernel(){const n=65,c=.1125,h=new Float64Array(n);let sum=0;for(let i=0;i<n;i++){const x=i-(n-1)/2,w=.42-.5*Math.cos(2*Math.PI*i/(n-1))+.08*Math.cos(4*Math.PI*i/(n-1));h[i]=(x===0?2*c:Math.sin(2*Math.PI*c*x)/(Math.PI*x))*w;sum+=h[i]}return h.map(x=>x/sum)}
class FIR {
 constructor(h){this.h=h;this.x=new Float64Array(h.length);this.pos=0}
 tick(x){this.x[this.pos]=x;let y=0,j=this.pos;for(let k=0;k<this.h.length;k++){y+=this.h[k]*this.x[j];if(--j<0)j=this.x.length-1}if(++this.pos===this.x.length)this.pos=0;return y}
}
class Delay {constructor(n){this.x=new Float64Array(n);this.pos=0}tick(x){const y=this.x[this.pos];this.x[this.pos]=x;if(++this.pos===this.x.length)this.pos=0;return y}}
export class Excitation {
 constructor(p,quality){this.p=p;this.quality=quality;this.hp=[0,1].map(()=>({x1:0,x2:0,y1:0,y2:0}));this.dry=[new Delay(16),new Delay(16)];this.full=[new Delay(16),new Delay(16)];if(quality==='refined'){const h=oversamplingKernel();this.up=[new FIR(h),new FIR(h)];this.down=[new FIR(h),new FIR(h)]}}
 tick(x,ch){const p=this.p;if(!p.on)return this.full[ch].tick(x);const z=this.hp[ch],h=p.gain*(x-2*z.x1+z.x2)+p.a1*z.y1+p.a0*z.y2;z.x2=z.x1;z.x1=x;z.y2=z.y1;z.y1=h;const dry=this.dry[ch].tick(x);if(this.quality==='refined'){let wet=0;for(let k=0;k<4;k++){const u=this.up[ch].tick(k===0?4*h:0)*p.drive;const filtered=this.down[ch].tick(Math.sin(u));if(k===0)wet=filtered}return dry+(p.odd*p.wet)*wet}return this.full[ch].tick(x+p.odd*p.wet*Math.sin(h*p.drive))}
}
// Stereo-linked streaming gain and peak envelope.
class PeakEnvelope {
 constructor(p){this.p=p;this.env=0;this.maximum=0;this.increment=0;this.remaining=0}
 tick(delayedPeak,newPeak){const p=this.p;if(this.remaining){this.env=Math.max(this.env,delayedPeak);if(newPeak>this.maximum){this.maximum=newPeak;this.remaining=p.maxDelay;this.increment=Math.max(this.increment,(newPeak-this.env)/(p.maxDelay+1))}else this.remaining--;this.env+=this.increment}else{this.env=Math.max(this.env*p.releaseBeta,delayedPeak);if(newPeak>this.env){this.maximum=newPeak;this.increment=(newPeak-this.env)/(p.maxDelay+1);this.env+=this.increment;this.remaining=p.maxDelay}}return this.env>p.maxOutput?p.maxOutput/this.env:1}
}
export class Dynamics {
 constructor(rate,p,quality){this.p=p;this.linked=quality==='refined';if(!this.linked){this.native=new kernel.DynamicsStage(rate);this.native.trace={push(){}};this.nativeBuffer=new Float32Array(2)}this.left=new Delay(p.maxDelay);this.right=new Delay(p.maxDelay);this.env=[new PeakEnvelope(p),new PeakEnvelope(p)];this.power=0;this.alpha=1-Math.exp(-2*Math.PI*.1/rate);this.outL=0;this.outR=0}
 tick(l,r){const p=this.p;if(this.native){this.nativeBuffer[0]=l;this.nativeBuffer[1]=r;this.native.process(this.nativeBuffer,1,p);this.outL=this.nativeBuffer[0];this.outR=this.nativeBuffer[1];return}const power=this.linked?(l*l+r*r)*.5:l*l;this.power+=this.alpha*(power-this.power);const rms=Math.sqrt(this.power);const gain=p.gainBoost*rms>p.targetLevel?Math.max(1.06,p.targetLevel/Math.max(1e-30,rms)):p.gainBoost;const a=l*gain*p.maxOutput,b=r*gain*p.maxOutput,dl=this.left.tick(a),dr=this.right.tick(b);if(this.linked){const g=this.env[0].tick(Math.max(Math.abs(dl),Math.abs(dr)),Math.max(Math.abs(a),Math.abs(b)));this.outL=dl*g;this.outR=dr*g}else{this.outL=dl*this.env[0].tick(Math.abs(dl),Math.abs(a));this.outR=dr*this.env[1].tick(Math.abs(dr),Math.abs(b))}}
}
