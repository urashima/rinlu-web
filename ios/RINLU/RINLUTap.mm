// SPDX-License-Identifier: AGPL-3.0-or-later
#import "RINLUTap.h"
#import <MediaToolbox/MediaToolbox.h>
#include "Processor.hpp"
#include <memory>
#include <atomic>

static Sound decode(NSDictionary *settings,double strength){
 Sound s;
 auto value=[&](NSString *key,double lo,double hi,double def=0.){
  NSNumber *n=settings[key];double x=[n isKindOfClass:NSNumber.class]?n.doubleValue:def;
  return std::isfinite(x)?clampReal(x,lo,hi):def;
 };
 strength=clampReal(strength,0,1);
 s.bands=(int)value(@"bands",10,31,10);
 if(s.bands!=15 && s.bands!=25 && s.bands!=31)s.bands=10;
 s.refined=[settings[@"quality"] isEqual:@"refined"];
 s.gains.assign(s.bands,0);
 NSArray *g=settings[@"gains"],*ir=settings[@"fir"];
 for(int i=0;i<s.bands && i<(int)g.count;++i)s.gains[i]=clampReal([g[i] doubleValue],-12,12)*strength;
 if(ir.count && ir.count<=2048){s.fir.clear();for(NSNumber *n in ir)s.fir.push_back(clampReal(n.doubleValue,-4,4)*strength);s.fir[0]+=1-strength;}
 s.q=value(@"q",.5,2,1);s.decay=value(@"decay",.1,.85,.5);
 s.width=1+(value(@"width",0,1.8,1)-1)*strength;
 s.pan=value(@"pan",-1,1)*strength;s.boost=value(@"boost",0,1)*strength;
 s.balance=value(@"balance",-12,12)*strength;s.normalization=value(@"normalization",-24,0)*strength;
 s.bass=value(@"bass",0,8)*strength;s.harmonics=value(@"harmonics",0,1)*strength;
 s.clarity=value(@"clarity",0,6)*strength;s.warmth=value(@"warmth",0,1)*strength;
 s.deesser=value(@"deesser",0,1)*strength;s.crossfeed=value(@"crossfeed",0,.25)*strength;
 s.room=value(@"room",0,.35)*strength;s.compression=value(@"compression",0,1)*strength;
 s.leveling=value(@"leveling",0,1)*strength;s.preamp=value(@"preamp",-18,6)*strength;
 return s;
}
struct Control {Sound settings;std::atomic<bool> enabled{false},unsupported{false};};
struct Context {
 std::shared_ptr<Control> control;
 std::unique_ptr<Processor> dsp;
 unsigned channels=0;bool planar=false;double blend=0;
};
static Context *context(MTAudioProcessingTapRef tap){return static_cast<Context*>(MTAudioProcessingTapGetStorage(tap));}
static void setup(MTAudioProcessingTapRef,void *info,void **storage){*storage=info;}
static void finish(MTAudioProcessingTapRef tap){delete context(tap);}
static void prepare(MTAudioProcessingTapRef tap,CMItemCount,const AudioStreamBasicDescription *format){
 auto &c=*context(tap);double fs=format->mSampleRate;
 c.channels=format->mChannelsPerFrame;c.planar=(format->mFormatFlags&kAudioFormatFlagIsNonInterleaved)!=0;
 bool supported=format->mFormatID==kAudioFormatLinearPCM && (format->mFormatFlags&kAudioFormatFlagIsFloat) && format->mBitsPerChannel==32 && (c.channels==1||c.channels==2) && (fs==44100||fs==48000);
 c.control->unsupported.store(!supported);
 if(supported)c.dsp.reset(new Processor(int(fs),c.control->settings));
 c.blend=0;
}
static void releaseFormat(MTAudioProcessingTapRef tap){context(tap)->dsp.reset();}
static void process(MTAudioProcessingTapRef tap,CMItemCount requested,MTAudioProcessingTapFlags,AudioBufferList *list,CMItemCount *frames,MTAudioProcessingTapFlags *flags){
 if(MTAudioProcessingTapGetSourceAudio(tap,requested,list,flags,nullptr,frames)!=noErr){*frames=0;return;}
 auto &c=*context(tap);
 if(!c.dsp||!list->mNumberBuffers||!list->mBuffers[0].mData)return;
 bool enabled=c.control->enabled.load();
 if(!enabled && c.blend==0)return;
 auto a=(float*)list->mBuffers[0].mData;
 auto b=(c.channels==2 && c.planar && list->mNumberBuffers>=2)?(float*)list->mBuffers[1].mData:nullptr;
 if(c.planar && c.channels==2 && !b)return;
 for(CMItemCount i=0;i<*frames;++i){
  int offset=int(i)*(c.planar?1:c.channels);float l=a[offset],r=c.channels==1?l:(b?b[i]:a[offset+1]);
  float wetL=l,wetR=r;c.dsp->tick(wetL,wetR);
  c.blend=clampReal(c.blend+(enabled?1:-1)/960.,0,1);
  a[offset]=l+(wetL-l)*c.blend;
  if(c.channels==2){float value=r+(wetR-r)*c.blend;if(b)b[i]=value;else a[offset+1]=value;}
 }
}
@implementation RINLUTap { std::shared_ptr<Control> _control; }
- (instancetype)initWithSettings:(NSDictionary *)settings strength:(double)strength{
 if((self=[super init])){_control=std::make_shared<Control>();_control->settings=decode(settings,strength);}return self;
}
- (BOOL)enabled{return _control->enabled.load();}
- (void)setEnabled:(BOOL)enabled{_control->enabled.store(enabled);}
- (BOOL)formatUnsupported{return _control->unsupported.load();}
- (AVAudioMix *)mixForTrack:(AVAssetTrack *)track{
 Context *c=new Context{_control};
 MTAudioProcessingTapCallbacks cb={kMTAudioProcessingTapCallbacksVersion_0,c,setup,finish,prepare,releaseFormat,process};
 MTAudioProcessingTapRef tap=nullptr;
 if(MTAudioProcessingTapCreate(kCFAllocatorDefault,&cb,kMTAudioProcessingTapCreationFlag_PostEffects,&tap)!=noErr){delete c;return nil;}
 AVMutableAudioMixInputParameters *params=[AVMutableAudioMixInputParameters audioMixInputParametersWithTrack:track];
 params.audioTapProcessor=tap;CFRelease(tap);
 AVMutableAudioMix *mix=[AVMutableAudioMix audioMix];mix.inputParameters=@[params];return mix;
}
@end
