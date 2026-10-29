"""Bounded amplitude/onset assistance, never an authoritative authored chart."""
import array, math, sys

def analyze_pcm(raw, sample_rate=8000):
    values=array.array('h');values.frombytes(raw)
    if sys.byteorder!='little': values.byteswap()
    duration=len(values)/sample_rate
    if not 1<=duration<=3602: raise ValueError('Analysis duration outside supported range')
    frame=max(1,sample_rate//10)
    energy=[math.sqrt(sum(v*v for v in values[i:i+frame])/len(values[i:i+frame]))/32768 for i in range(0,len(values),frame)]
    maximum=max(energy) or 1
    width=max(1,math.ceil(len(energy)/512))
    peaks=[round(max(energy[i:i+width])/maximum,4) for i in range(0,len(energy),width)]
    flux=[0]+[max(0,energy[i]-energy[i-1]) for i in range(1,len(energy))]
    threshold=max(flux)*.2
    onsets=[]
    for i in range(1,len(flux)-1):
        t=i*.1
        if flux[i]>max(.005,threshold) and flux[i]>=flux[i-1] and flux[i]>flux[i+1] and (not onsets or t-onsets[-1]>=.2):
            onsets.append(round(t,3))
            if len(onsets)==1200: break
    # A coarse autocorrelation hint can have half/double-tempo ambiguity.
    denominator=sum(v*v for v in flux)
    scores=[(sum(flux[i]*flux[i-lag] for i in range(lag,len(flux)))/denominator,lag) for lag in range(3,21)] if denominator>0 else []
    score,lag=max(scores,default=(0,0))
    confidence=round(max(0,min(1,score)),4)
    bpm=round(600/lag,1) if lag and confidence>=.15 and len(onsets)>=4 else None
    return {'version':1,'algorithm':'rinlu-energy-v1','duration':round(duration,3),'peaks':peaks,'onsets':onsets,'bpm':bpm,'confidence':confidence if bpm else 0}
