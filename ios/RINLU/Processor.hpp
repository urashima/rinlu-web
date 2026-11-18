// SPDX-License-Identifier: AGPL-3.0-or-later. RINLU native port, 2026.
#pragma once
#include "Stages.hpp"
#include "Convolver.hpp"
#include <array>
struct Sound {
 int bands=10; bool refined=false;
 double boost=0,q=1,balance=0,normalization=0,bass=0,harmonics=0,clarity=0,warmth=0,deesser=0,width=1,crossfeed=0,room=0,decay=.5,compression=0,leveling=0,preamp=0,pan=0;
 std::vector<double> gains=std::vector<double>(10),fir={1};
};
struct History {
 std::vector<double> line;
 size_t pos=0;
 explicit History(int count):line(count){}
 double delay(double x){double old=line[pos];line[pos]=x;pos=(pos+1)%line.size();return old;}
 double filter(double x,const double* h){
  line[pos]=x;size_t j=pos;double sum=0;
  for(size_t k=0;k<line.size();++k){sum+=line[j]*h[k];j=j?j-1:line.size()-1;}
  pos=(pos+1)%line.size();return sum;
 }
};
struct Envelope {
 double env=0,maximum=0,increment=0;int remaining=0;
 double update(double delayed,double peak,const Parameters& p,bool rounded){
  auto round=[rounded](double x){return rounded?f32(x):x;};
  if(remaining){
   env=max(env,delayed);
   if(peak>maximum){maximum=peak;remaining=p.delay;increment=max(increment,round(round(peak-env)/(p.delay+1)));}else --remaining;
   env=round(env+increment);
  }else{
   env=max(round(round(env*p.beta)+(rounded?1e-24f:0)),delayed);
   if(peak>env){maximum=peak;increment=round(round(peak-env)/(p.delay+1));env=round(env+increment);remaining=p.delay;}
  }
  return env;
 }
};
struct Filter {
 double b0,b1,b2,a2,z1[2]{},z2[2]{};
 double tick(double x,int ch){double y=b0*x+z1[ch];z1[ch]=b1*x-b1*y+z2[ch];z2[ch]=b2*x-a2*y;return y;}
};
class Processor {
 Sound s;
 int rate,frames,pos=0;
 std::vector<float> block,output;
 const Parameters *table;
 const Parameters &clarity,&room,&wide,&bass,&dynamic;
 Space plate;Level level;
 std::vector<Section> sections;
 std::vector<Filter> extended;
 History dry[2]={History(16),History(16)},up[2]={History(65),History(65)},down[2]={History(65),History(65)};
 Convolver fir[2]; History look[2];
 Envelope envelope[2]; Filter bassFilter;
 double ix1[2]{},ix2[2]{},oy1[2]{},oy2[2]{},low[2]{},harmDC[2]{},tubeDC[2]{},deLow[2]{},cross[2]{};
 double deEnv=0,compressEnv=0,power=0,levelAlpha,levelComplement,lp,dcLp,deLp,crossLp,attack,release,pan[2],master,bal[2];
 static int midi(double value){return int(f32(f32(f32(value/10)*127)+.5));}
public:
 Processor(int fs,const Sound& settings):s(settings),rate(fs),frames(fs/100),block(2*frames),output(2*frames),
 table(fs==44100?rate44100:rate48000),clarity(table[midi(s.clarity/.6)]),room(table[midi(s.room/.035)]),wide(table[midi(clampReal((s.width-1)/.08,0,10))]),bass(table[midi(s.bass/.8)]),dynamic(table[midi(s.boost*10)]),
 plate(fs,room.roomsize),fir{Convolver(s.fir),Convolver(s.fir)},look{History(int(dynamic.delay)),History(int(dynamic.delay))},bassFilter{bass.b0,bass.b1,bass.b2,bass.a2}{
  const double centers[]={62.5,115.734,214.311,396.85,734.867,1360.79,2519.84,4666.12,8640.48,16000};
  double ratio=pow(256,1./9);
  for(int i=0;i<s.bands;++i){
   double db=s.gains[i];if(db==0)continue;
   if(s.bands==10){sections.push_back(calcParametric(fs,f32(centers[i]),f32(db),max(1,f32(f32(sqrt(ratio)/(ratio-1))*f32(s.q)))));continue;}
   double hz=20*pow(1000.,double(i)/(s.bands-1)),w=2*PI*min(hz,fs*.45)/fs,a=pow(10,db/40);
   double alpha=sin(w)*sinh(log(1000.)/(s.bands-1)/2)/s.q,d=1+alpha/a;
   extended.push_back({(1+alpha*a)/d,-2*cos(w)/d,(1-alpha*a)/d,(1-alpha/a)/d});
  }
  auto gain=[](double db){return f32(pow(10,f32(f32(db)/20)));};
  master=gain(s.preamp);bal[0]=gain(-max(s.balance,0));bal[1]=gain(min(s.balance,0));
  level.targetRms=gain(s.normalization);level.vlTargetRms=f32(f32(s.leveling)*.5);
  auto pole=[fs](double freq){return 1-exp(-2*PI*freq/fs);};
  lp=pole(100);dcLp=pole(8);deLp=pole(4500);crossLp=pole(700);attack=exp(-1/(fs*.005));release=exp(-1/(fs*.12));
  pan[0]=min(1,sqrt(2)*cos((s.pan+1)*PI/4));pan[1]=min(1,sqrt(2)*sin((s.pan+1)*PI/4));
  double c=cos(6.283185*.1/fs),d=2-c-sqrt(c*c-4*c+3);
  levelAlpha=s.refined?pole(.1):f32(1-d);levelComplement=s.refined?1-levelAlpha:f32(d);
 }
 void tick(float& l,float& r){
  int i=2*pos;
  block[i]=std::isfinite(l)?clampReal(l,-8,8):0;
  block[i+1]=std::isfinite(r)?clampReal(r,-8,8):0;
  l=output[i];r=output[i+1];
  if(++pos==frames){pos=0;render();}
 }
private:
 double excite(double x,int ch){
  if(!s.clarity)return dry[ch].delay(x);
  double h;
  if(s.refined)h=clarity.hp*(x-2*ix1[ch]+ix2[ch])+clarity.hp1*oy1[ch]+clarity.hp0*oy2[ch];
  else h=f32(f32(f32(oy1[ch]*clarity.hp1)+f32(oy2[ch]*clarity.hp0))+f32(f32(f32(f32(x+1e-30f)-f32(2*ix1[ch]))+ix2[ch])*clarity.hp));
  ix2[ch]=ix1[ch];ix1[ch]=x;oy2[ch]=oy1[ch];oy1[ch]=h;
  if(!s.refined){double odd=f32(sin(f32(h*clarity.drive)));return dry[ch].delay(f32(f32(f32(x+f32(1.5*odd))*.377953f)+f32(.622047f*x)));}
  double wet=0;
  for(int k=0;k<4;++k){double u=up[ch].filter(k?0:4*h,sinc65);double v=down[ch].filter(sin(u*clarity.drive),sinc65);if(!k)wet=v;}
  return dry[ch].delay(x)+1.5*.377953f*wet;
 }
 void render(){
  double sum=0;
  for(int i=0;i<frames;++i){
   for(int ch=0;ch<2;++ch){double x=block[i*2+ch];for(auto &f:extended)x=f32(f.tick(x,ch));x=f32(x);for(auto &f:sections)x=f.tick(x,ch);block[i*2+ch]=f32(f32(x*master)*bal[ch]);}
   double a=block[2*i],b=block[2*i+1];sum=f32(sum+f32(f32(a*a)+f32(b*b)));
  }
  if(level.targetRms!=1)level.normalize(block.data(),frames,sum);
  level.applyVolumeLeveling(block.data(),frames,2,rate,-1);
  for(int i=0;i<2*frames;++i)block[i]=excite(block[i],i%2);
  if(room.spaceOn)plate.process(block.data(),frames,room,clampReal(room.decay*s.decay/.5,.01,.9));
  for(int i=0;i<frames;++i){
   double v[2]={block[i*2],block[i*2+1]};
   if(s.width>1){double mid=f32(f32(v[0]+v[1])*.5);for(auto &x:v)x=f32(f32(mid*f32(1-.3*wide.intensity))+f32(f32(1+3*wide.intensity)*f32(x-mid)));}
   if(s.bass){for(int ch=0;ch<2;++ch){double x=v[ch],y=f32(bassFilter.z1[ch]+f32(bass.b0*f32(x+1e-30f)));bassFilter.z1[ch]=f32(f32(f32(x-y)*bass.b1)+bassFilter.z2[ch]);bassFilter.z2[ch]=f32(f32(bass.b2*x)-f32(bass.a2*y));v[ch]=y;}}
   if(s.width<1){double m=(v[0]+v[1])*.5,side=(v[0]-v[1])*.5*s.width;v[0]=m+side;v[1]=m-side;}
   for(int ch=0;ch<2;++ch){double& x=v[ch];
    if(s.harmonics){low[ch]+=lp*(x-low[ch]);double h=4*low[ch]*low[ch];harmDC[ch]+=dcLp*(h-harmDC[ch]);x+=s.harmonics*(h-harmDC[ch]);}
    if(s.warmth){double drive=1+2*s.warmth,bias=.12*s.warmth,y=(tanh((x+bias)*drive)-tanh(bias*drive))/drive;tubeDC[ch]+=dcLp*(y-tubeDC[ch]);x=x*(1-s.warmth)+(y-tubeDC[ch])*s.warmth;}
   }
   if(s.deesser){for(int c=0;c<2;++c)deLow[c]+=deLp*(v[c]-deLow[c]);double peak=max(std::abs(v[0]-deLow[0]),std::abs(v[1]-deLow[1]));deEnv=max(peak,deEnv*.9995);double g=1/(1+max(0,deEnv/.025-1)*s.deesser*2);for(int c=0;c<2;++c)v[c]+=(v[c]-deLow[c])*(g-1);}
   if(s.crossfeed){for(int c=0;c<2;++c)cross[c]+=crossLp*(v[c]-cross[c]);for(int c=0;c<2;++c)v[c]=(v[c]+s.crossfeed*cross[1-c])/(1+s.crossfeed);}
   double peak=max(std::abs(v[0]),std::abs(v[1])),g=1;compressEnv=peak+(compressEnv-peak)*(peak>compressEnv?attack:release);
   if(s.compression){double over=20*log10(max(compressEnv,1e-12))+12+12*s.compression,factor=1/(1+5*s.compression)-1;g=pow(10,(over<=-3?0:over<3?factor*(over+3)*(over+3)/12:factor*over)/20);}
   for(int c=0;c<2;++c)v[c]=fir[c].tick(v[c]*g*pan[c]);
   if(!s.refined){v[0]=f32(v[0]);v[1]=f32(v[1]);}
   double sq=s.refined?(v[0]*v[0]+v[1]*v[1])*.5:f32(v[0]*v[0]);power=power*levelComplement+sq*levelAlpha;
   double rms=s.refined?sqrt(power):f32(sqrt(power)),boost=dynamic.gainBoost;
   if((s.refined?boost*rms:f32(boost*rms))>.32f)boost=max(1.06f,s.refined?.32f/rms:f32(.32f/rms));
   double delayed[2];for(int c=0;c<2;++c){v[c]=s.refined?v[c]*boost*.966051f:f32(f32(boost*.966051f)*v[c]);delayed[c]=look[c].delay(v[c]);}
   if(s.refined){double env=envelope[0].update(max(std::abs(delayed[0]),std::abs(delayed[1])),max(std::abs(v[0]),std::abs(v[1])),dynamic,false);for(int c=0;c<2;++c)output[2*i+c]=delayed[c]*(env>.966051f?.966051f/env:1);}
   else for(int c=0;c<2;++c){double env=envelope[c].update(std::abs(delayed[c]),std::abs(v[c]),dynamic,true);output[2*i+c]=env>.966051f?f32(delayed[c]*.966051f)/env:delayed[c];}
  }
 }
};
