// SPDX-License-Identifier: AGPL-3.0-or-later. Native port; see Licenses/Kernel-NOTICE.txt.
#pragma once
#include <cmath>
#include <algorithm>
#include <vector>
constexpr double f32(double x){return static_cast<float>(x);}
inline double max(double a,double b){return std::max(a,b);}
inline double min(double a,double b){return std::min(a,b);}
inline double clampReal(double v,double lo,double hi){return max(lo,min(v,hi));}
constexpr double PI=3.14159265358979323846, SPN=1.65436e-24;
struct Section { bool on=false; double b0=1,b1=0,b2=0,a2=0,z1[2]{},z2[2]{};
 double tick(double x,int c){if(!on)return x;double y=f32(f32(z1[c]+f32(b0*x))+1e-30f);z1[c]=f32(f32(f32(x-y)*b1)+z2[c]);z2[c]=f32(f32(b2*x)-f32(a2*y));return y;}
};
inline double bw2angle(double a,double bandwidth) {
    double twoPi = f32(2 * PI);
    double T = f32(tan(f32(twoPi * bandwidth)));
    double a2 = f32(a * a), a4 = f32(a2 * a2);
    double d = f32(f32(2 * a2) * T);
    double sn = f32(f32(1 + a4) * T);
    double cs = f32(1 - a4);
    double mag = f32(sqrt(f32(f32(sn * sn) + f32(cs * cs))));
    d = f32(d / mag);
    double delta = f32(atan2(sn, cs));
    double asnd = f32(asin(d));
    double theta = f32(f32(0.5) * f32(f32(f32(PI) - asnd) - delta));
    double tmp = f32(f32(0.5) * f32(asnd - delta));
    if (tmp > 0 && tmp < theta)
        theta = tmp;
    if (bandwidth >= 0.5)
        theta = f32(0.005);
    return f32(theta / twoPi);
}
inline Section calcParametric(double sampFreq,double centerFreq,double boost,double Q) {
    if (boost == 0)
        return {};
    double maxQ;
    if (centerFreq < 60) {
        maxQ = f32(f32(f32(centerFreq - 20) * f32(f32(19) / f32(40))) + 1);
        if (Q > maxQ)
            Q = maxQ;
    }
    double absBoost = f32(std::abs(boost));
    if (absBoost < 6) {
        maxQ = f32(f32(absBoost * f32(f32(f32(20) - f32(0.2)) / f32(6))) + f32(0.2));
        if (Q > maxQ)
            Q = maxQ;
    }
    double center = f32(centerFreq / sampFreq);
    double bandwidth = f32(center / Q);
    double a = f32(tan(f32(f32(PI) * f32(center - f32(0.25)))));
    double asq = f32(a * a);
    double A = f32(pow(10.0, f32(boost / f32(20))));
    double F;
    if (boost < 6 && boost > -6)
        F = f32(sqrt(A));
    else if (A > 1)
        F = f32(A / f32(sqrt(2.0)));
    else
        F = f32(A * f32(sqrt(2.0)));
    double xfmbw = bw2angle(a, bandwidth);
    double C = f32(1 / f32(tan(f32(f32(2 * PI) * xfmbw))));
    double F2 = f32(F * F);
    double tmp = f32(f32(A * A) - F2);
    double alphad = (std::abs(tmp) <= SPN) ? C : f32(sqrt(f32(f32(f32(C * C) * f32(F2 - 1)) / tmp)));
    double alphan = f32(A * alphad);
    double a2plus1 = f32(1 + asq), ma2plus1 = f32(1 - asq);
    double b0 = f32(a2plus1 + f32(alphan * ma2plus1));
    double b1 = f32(4 * a);
    double b2 = f32(a2plus1 - f32(alphan * ma2plus1));
    double a0 = f32(a2plus1 + f32(alphad * ma2plus1));
    double a2 = f32(a2plus1 - f32(alphad * ma2plus1));
    double recip = f32(1 / a0);
    b0 = f32(b0 * recip);
    b1 = f32(b1 * recip);
    b2 = f32(b2 * recip);
    a2 = f32(a2 * recip);
    return {true,b0,b1,b2,a2};
}
namespace K {
constexpr double Ceiling = f32(1.0);
constexpr double AttackAlpha = f32(0.10);
constexpr double ReleaseAlphaFast = f32(0.05);
constexpr double ReleaseAlphaSlow = f32(0.02);
constexpr double ReleaseGapThreshold = f32(0.15);
constexpr double PredictionStrength = f32(0.35);
constexpr double PredictionClamp = f32(0.15);
constexpr double PredictionMissRatio = f32(0.35);
constexpr double SidechainHpfHz = f32(120.0);
constexpr double ToneLowHz = f32(180.0);
constexpr double ToneBodyHz = f32(1200.0);
constexpr double TonePresenceHz = f32(4500.0);
constexpr double MinRatioPerBuffer = f32(0.8912509381337456);
constexpr double TonalityDbRange = f32(7.0);
constexpr double TonalitySmoothing = f32(0.08);
constexpr double MuffledTargetBoost = f32(0.12);
constexpr double ClearTargetReduction = f32(0.18);
constexpr double ClearCeilingReduction = f32(0.08);
constexpr double HeadroomTimeSeconds = f32(60.0);
constexpr double HeadroomTargetBoost = f32(0.08);
constexpr double HeadroomTargetReduction = f32(0.14);
constexpr double HeadroomComfortThreshold = f32(0.18);
constexpr double HeadroomNearCeilingThreshold = f32(0.985);
constexpr double HeadroomHitThreshold = f32(0.002);
constexpr double VeryQuietRmsThreshold = f32(0.035);
constexpr double QuietAudiblePeakThreshold = f32(0.0035);
constexpr double QuietFullBoostPeak = f32(0.02);
constexpr double QuietMaxGain = f32(10.0);
constexpr double QuietReleaseAlpha = f32(0.18);
constexpr double QuietActivationSeconds = f32(10.0);
constexpr double QuietActivationRampSeconds = f32(2.0);
constexpr double QuietFloorReleaseRmsThreshold = f32(0.06);
constexpr double QuietFloorReleaseAlpha = f32(0.02);
constexpr double QuietFloorSilenceDecayAlpha = f32(0.08);
constexpr double QuietPeakBucketSeconds = f32(1.0);
constexpr double QuietPeakTargetRatio = f32(0.98);
constexpr double QuietPeakFloorRaiseTimeSeconds = f32(6.0);
constexpr double Pi = f32(3.14159265358979323846);
constexpr double HistorySize = 6;
constexpr double PeakWindowSize = 30;
}
inline double onePoleAlpha(double cutoff,double fs) {
    double dt = f32(1 / fs), rc = f32(1 / f32(f32(f32(2) * K::Pi) * cutoff));
    return f32(dt / f32(rc + dt));
}

struct Level {
 struct State {
  double gain=1, powerHistory[6]{},powerSum=0,prevAvg=0,prevPred=0,alphaFs=0,scAlpha=0,lowA=0,bodyA=0,presA=0,scPrevIn[2]{},scPrevOut[2]{},tone[2][3]{},tonality=0,headroom=0,quietDuration=0,quietFloor=1,peakHistory[30]{},bucketMax=0,bucketSeconds=0;
  int powerIndex=0,powerCount=0,peakIndex=0,peakCount=0;
 } vl;
 double normalizationGain=1,targetRms=1,vlTargetRms=0;
    void normalize(float* buf,int n,double sumSquares) {
        double currentRms = f32(sqrt(f32(sumSquares / f32(n * 2))));
        if (currentRms < f32(1e-6))
            currentRms = f32(1e-6);
        double targetGain = f32(targetRms / currentRms);
        targetGain = max(f32(0.01), min(targetGain, f32(1)));
        double diff = f32(std::abs(f32(targetGain - normalizationGain)));
        double smoothing = targetGain > normalizationGain ? f32(f32(0.0005) + f32(diff * f32(0.001))) : f32(1);
        smoothing = min(smoothing, f32(0.5));
        normalizationGain = f32(normalizationGain + f32(f32(targetGain - normalizationGain) * smoothing));
        for (int i = 0; i < n * 2; i++)
            buf[i] = f32(buf[i] * normalizationGain);
    }
    void updateQuietPeakWindow(double postPeak,double dur) {
        auto &v = vl;
        v.bucketMax = max(v.bucketMax, postPeak);
        v.bucketSeconds = f32(v.bucketSeconds + dur);
        while (v.bucketSeconds >= K::QuietPeakBucketSeconds) {
            v.peakHistory[v.peakIndex] = v.bucketMax;
            v.peakIndex = (v.peakIndex + 1) % int(K::PeakWindowSize);
            if (v.peakCount < K::PeakWindowSize)
                v.peakCount++;
            v.bucketSeconds = f32(v.bucketSeconds - K::QuietPeakBucketSeconds);
            v.bucketMax = 0;
        }
    }
    double quietPeakWindowMax() {
        auto &v = vl; double m = v.bucketMax;
        for (int i = 0; i < v.peakCount; i++)
            m = max(m, v.peakHistory[i]);
        return m;
    }
    void applyVolumeLeveling(float* buf,int n,int ch,double sampFreq,int excluded) {
        auto &v = vl;
        if (vlTargetRms <= 0 || n <= 0 || ch <= 0) {
            v.gain = f32(1);
            return;
        }
        double analyzed = excluded >= 0 ? ch - 1 : ch;
        if (analyzed <= 0)
            return;
        double sumSquares = f32(0), peak = f32(0), low = f32(0), body = f32(0), pres = f32(0), air = f32(0); int idx = 0;
        double fs = sampFreq > 1000 ? sampFreq : f32(48000);
        if (v.alphaFs != fs) {
            double dt = f32(1 / fs), rc = f32(1 / f32(f32(f32(2) * K::Pi) * K::SidechainHpfHz));
            v.scAlpha = f32(rc / f32(rc + dt));
            v.lowA = onePoleAlpha(K::ToneLowHz, fs);
            v.bodyA = onePoleAlpha(K::ToneBodyHz, fs);
            v.presA = onePoleAlpha(K::TonePresenceHz, fs);
            v.alphaFs = fs;
        }
        for (int s = 0; s < n; s++, idx += ch) {
            for (int c = 0; c < ch; c++) {
                if (c == excluded)
                    continue;
                double value = buf[idx + c];
                double sc = f32(v.scAlpha * f32(f32(v.scPrevOut[c] + value) - v.scPrevIn[c]));
                v.scPrevIn[c] = value;
                v.scPrevOut[c] = sc;
                sumSquares = f32(sumSquares + f32(sc * sc));
                double av = f32(std::abs(sc));
                if (av > peak)
                    peak = av;
                auto &t = v.tone[int(c)];
                t[0] = f32(t[0] + f32(v.lowA * f32(value - t[0])));
                t[1] = f32(t[1] + f32(v.bodyA * f32(value - t[1])));
                t[2] = f32(t[2] + f32(v.presA * f32(value - t[2])));
                double lb = t[0], bb = f32(t[1] - t[0]), pb = f32(t[2] - t[1]), ab = f32(value - t[2]);
                low = f32(low + f32(lb * lb));
                body = f32(body + f32(bb * bb));
                pres = f32(pres + f32(pb * pb));
                air = f32(air + f32(ab * ab));
            }
        }
        double currentPower = f32(sumSquares / f32(n * analyzed));
        double currentRms = f32(sqrt(currentPower));
        double gainStart = v.gain, gainEnd = gainStart;
        double hReduce = max(v.headroom, 0), hBoost = max(-v.headroom, 0);
        double floor = max(v.quietFloor, f32(1));
        double quietBefore = v.quietDuration;
        double num = f32(f32(pres + f32(air * f32(0.75))) + f32(1e-12));
        double den = f32(f32(f32(body * f32(1.15)) + f32(low * f32(0.85))) + f32(1e-12));
        double tonalityDb = f32(10.0 * log10(f32(num / den)));
        double targetTonality = clampReal(f32(tonalityDb / K::TonalityDbRange), f32(-1), f32(1));
        v.tonality = f32(f32(v.tonality * f32(1 - K::TonalitySmoothing)) + f32(targetTonality * K::TonalitySmoothing));
        double clear = max(v.tonality, 0), muffled = max(-v.tonality, 0);
        double dur = f32(n / fs);
        double upAuth = clampReal(f32(f32(f32(1) - f32(hReduce * f32(1.5))) + f32(hBoost * f32(0.25))), f32(0), f32(1));
        double downAuth = clampReal(f32(f32(0.35) + f32(upAuth * f32(0.65))), f32(0.35), f32(1));
        double gMuffled = f32(muffled * upAuth), gClear = f32(clear * downAuth);
        double effTarget = f32(vlTargetRms * f32(f32(f32(f32(f32(1) + f32(gMuffled * K::MuffledTargetBoost))
            - f32(gClear * K::ClearTargetReduction)) + f32(hBoost * K::HeadroomTargetBoost)) - f32(hReduce * K::HeadroomTargetReduction)));
        double ceiling = clampReal(f32(K::Ceiling * f32(f32(1) - f32(gClear * K::ClearCeilingReduction))), f32(0.92), K::Ceiling);
        double maxGainCap = max(f32(effTarget / f32(0.125)), floor);
        if (v.powerCount == K::HistorySize)
            v.powerSum = f32(v.powerSum - v.powerHistory[v.powerIndex]);
        else
            v.powerCount++;
        v.powerHistory[v.powerIndex] = currentPower;
        v.powerSum = f32(v.powerSum + currentPower);
        v.powerIndex = (v.powerIndex + 1) % int(K::HistorySize);
        double averaged = currentRms;
        if (v.powerCount > 0)
            averaged = f32(sqrt(f32(v.powerSum / v.powerCount)));
        double predicted = averaged, missed = false;
        if (v.prevAvg > f32(1e-6)) {
            double pd = f32(v.prevPred - v.prevAvg), ad = f32(averaged - v.prevAvg);
            double missThreshold = max(f32(v.prevAvg * f32(0.01)), f32(1e-5));
            if (std::abs(pd) > missThreshold) {
                double wrong = f32(pd * ad) < 0;
                double overshot = std::abs(ad) < f32(std::abs(pd) * K::PredictionMissRatio);
                if (wrong || overshot)
                    missed = true;
            }
        }
        if (v.prevAvg > f32(1e-6)) {
            double gradient = f32(averaged - v.prevAvg);
            predicted = f32(predicted + f32(gradient * K::PredictionStrength));
            predicted = clampReal(predicted, f32(averaged * f32(1 - K::PredictionClamp)), f32(averaged * f32(1 + K::PredictionClamp)));
        }
        if (missed)
            predicted = averaged;
        predicted = max(predicted, f32(1e-6));
        v.prevAvg = averaged;
        v.prevPred = predicted;
        if (currentRms > f32(1e-6)) {
            double qActivation = clampReal(f32(f32(v.quietDuration - K::QuietActivationSeconds) / K::QuietActivationRampSeconds), f32(0), f32(1));
            double qRms = clampReal(f32(f32(K::VeryQuietRmsThreshold - predicted) / K::VeryQuietRmsThreshold), f32(0), f32(1));
            double qPeak = clampReal(f32(f32(peak - K::QuietAudiblePeakThreshold) / f32(K::QuietFullBoostPeak - K::QuietAudiblePeakThreshold)), f32(0), f32(1));
            double qBoost = f32(f32(qRms * qPeak) * qActivation);
            if (qBoost > 0) {
                double qCap = max(maxGainCap, K::QuietMaxGain);
                maxGainCap = f32(maxGainCap + f32(f32(qCap - maxGainCap) * qBoost));
            }
            double desired = f32(effTarget / predicted);
            desired = min(desired, maxGainCap);
            desired = max(desired, floor);
            double alpha = K::AttackAlpha;
            if (desired >= v.gain) {
                double gap = f32(desired - v.gain);
                double ratio = f32(gap / max(v.gain, f32(1e-6)));
                alpha = ratio > K::ReleaseGapThreshold ? K::ReleaseAlphaSlow : K::ReleaseAlphaFast;
                alpha = f32(alpha * clampReal(f32(f32(f32(1) + f32(gMuffled * f32(0.20))) - f32(gClear * f32(0.35))), f32(0.55), f32(1.20)));
                alpha = max(alpha, f32(K::QuietReleaseAlpha * qBoost));
            }
            gainEnd = f32(f32(v.gain * f32(f32(1) - alpha)) + f32(desired * alpha));
        }
        if (gainEnd < gainStart) {
            double minEnd = f32(gainStart * K::MinRatioPerBuffer);
            if (gainEnd < minEnd)
                gainEnd = minEnd;
        }
        if (peak > f32(1e-6)) {
            double safe = f32(ceiling / peak);
            if (gainEnd > safe)
                gainEnd = safe;
            if (gainStart > safe)
                gainStart = safe;
        }
        gainStart = clampReal(gainStart, f32(0), maxGainCap);
        gainEnd = clampReal(gainEnd, f32(0), maxGainCap);
        v.gain = gainEnd;
        idx = 0;
        double postSum = f32(0), postPeak = f32(0), hits = 0;
        for (int sm = 0; sm < n; sm++, idx += ch) {
            double tt = f32(double(sm) / n);
            double g = f32(gainStart + f32(tt * f32(gainEnd - gainStart)));
            for (int cc = 0; cc < ch; cc++) {
                if (cc == excluded)
                    continue;
                double o = f32(buf[idx + cc] * g);
                double oa = f32(std::abs(o));
                postSum = f32(postSum + f32(o * o));
                if (oa > postPeak)
                    postPeak = oa;
                if (oa >= f32(ceiling * K::HeadroomNearCeilingThreshold))
                    hits++;
                if (o > ceiling)
                    o = ceiling;
                else if (o < -ceiling)
                    o = -ceiling;
                buf[idx + cc] = o;
            }
        }
        double postRms = f32(sqrt(f32(postSum / f32(n * analyzed))));
        updateQuietPeakWindow(postPeak, dur);
        double rolling = quietPeakWindowMax();
        if (peak > K::QuietAudiblePeakThreshold && postRms < K::VeryQuietRmsThreshold)
            v.quietDuration = f32(v.quietDuration + dur);
        else
            v.quietDuration = 0;
        if (quietBefore >= K::QuietActivationSeconds && gainEnd > f32(effTarget / f32(0.125)) && gainEnd > floor)
            floor = gainEnd;
        double windowReady = v.peakCount == K::PeakWindowSize;
        double floorActive = quietBefore >= K::QuietActivationSeconds || floor > 1;
        double peakTarget = f32(ceiling * K::QuietPeakTargetRatio);
        double headroomAvail = rolling > K::QuietAudiblePeakThreshold && rolling < peakTarget && hReduce < f32(0.25);
        if (windowReady && floorActive && headroomAvail) {
            double desiredFloor = f32(floor * f32(peakTarget / max(rolling, f32(1e-6))));
            desiredFloor = clampReal(desiredFloor, floor, K::QuietMaxGain);
            double raise = clampReal(f32(dur / K::QuietPeakFloorRaiseTimeSeconds), f32(0.0005), f32(0.05));
            floor = f32(f32(floor * f32(f32(1) - raise)) + f32(desiredFloor * raise));
        }
        if (peak <= K::QuietAudiblePeakThreshold)
            floor = f32(floor + f32(f32(f32(1) - floor) * K::QuietFloorSilenceDecayAlpha));
        else if (postRms > K::QuietFloorReleaseRmsThreshold)
            floor = f32(floor + f32(f32(f32(1) - floor) * K::QuietFloorReleaseAlpha));
        if (floor < f32(1.0001))
            floor = f32(1);
        v.quietFloor = floor;
        double hitRatio = f32(hits / f32(n * analyzed));
        double headroomRatio = clampReal(f32(f32(ceiling - postPeak) / ceiling), f32(0), f32(1));
        double targetHs = 0;
        if (hitRatio > K::HeadroomHitThreshold)
            targetHs = clampReal(f32(hitRatio / f32(0.02)), f32(0), f32(1));
        else if (postPeak >= f32(ceiling * K::HeadroomNearCeilingThreshold))
            targetHs = clampReal(f32(f32(f32(postPeak / ceiling) - K::HeadroomNearCeilingThreshold) / f32(f32(1) - K::HeadroomNearCeilingThreshold)), f32(0), f32(1));
        else if (headroomRatio > K::HeadroomComfortThreshold)
            targetHs = -clampReal(f32(f32(headroomRatio - K::HeadroomComfortThreshold) / f32(0.25)), f32(0), f32(1));
        double hAlpha = clampReal(f32(dur / K::HeadroomTimeSeconds), f32(0.0005), f32(0.05));
        v.headroom = f32(f32(v.headroom * f32(f32(1) - hAlpha)) + f32(targetHs * hAlpha));
    }
};
struct Parameters {
 double drive,hp,hp1,hp0,spaceOn,decay,lat6,wet,dry,roomsize,bandwidth,damping,intensity,b0,b1,b2,a2,gainBoost,beta,delay;
};
#include "Parameters.inc"
struct Space {
 int pre,lat1n,lat2,lat3n,lat4,lat5n,lat5max,lat6n,lat6t1,lat6t2,lat7,lat7max,lat8,lat8t1,lat8t2;
 int d1[4],d2[3],d3[4],d4[3],ptr=0;
 std::vector<float> m;
 double bw=0,damp1=0,damp2=0,d4out=0;
 Space(int fs,double room){
  auto f=[&](double ms){return int(f32(fs*f32(ms/1000)));};
  auto d=[&](double ms){return int(ms/1000*f32(room*fs));};
  pre=f(100);lat1n=f(4.77);lat2=f(3.595);lat3n=f(12.73);lat4=f(9.31);lat5n=d(22.6);lat5max=lat5n+f(2)+1;
  lat6t1=d(6.28);lat6t2=d(41.26);lat6n=d(60.5);lat7=d(30.5);lat7max=lat7+f(2)+1;lat8t1=d(11.25);lat8t2=d(64.3);lat8=d(89.2);
  int a[]={d(10.1),d(66.9),d(121.9),d(149.6)},b[]={d(35.8),d(89.8),d(125)},c[]={d(10.1),d(70.9),d(99.9),d(141.7)},e[]={d(4.065),d(67.1),d(106.3)};
  std::copy(a,a+4,d1);std::copy(b,b+3,d2);std::copy(c,c+4,d3);std::copy(e,e+3,d4);
  m.resize(pre+lat1n+lat2+lat3n+lat4+lat5max+d1[3]+lat6n+d2[2]+lat7max+d3[3]+lat8+d4[2]);
 }
 void adv(int step){ptr+=step;if(ptr>=int(m.size()))ptr-=m.size();}
 float tap(int back){int i=ptr-back;return m[i<0?i+int(m.size()):i];}
 void process(float* buf,int n,const Parameters& p,double decay){
  double wet=p.wet,dry=p.dry,lat6=p.lat6,lat1=.75,lat3=.625,lat5=f32(.70),bandwidth=p.bandwidth,damping=p.damping,oneMinusBandwidth=f32(1-bandwidth),oneMinusDamping=f32(1-damping);
  int preDelay=1;
        for (int i = 0, k = 0; i < n; i++, k += 2) {
            double in1 = f32(buf[k] + 1e-36f), in2 = f32(buf[k + 1] + 1e-36f);
            double out1, out2, ta, tb, t1, t2, t3, t4, next, din, dout, ido;
            adv(pre + 1);
            tb = tap(preDelay);
            next = m[ptr];
            m[ptr] = f32(in1 + in2);
            ta = f32(f32(tb * oneMinusBandwidth) + f32(bandwidth * bw));
            bw = ta;
            adv(lat1n);
            dout = next;
            din = f32(ta - f32(lat1 * dout));
            next = m[ptr];
            m[ptr] = din;
            tb = f32(dout + f32(lat1 * din));
            adv(lat2);
            dout = next;
            din = f32(tb - f32(lat1 * dout));
            next = m[ptr];
            m[ptr] = din;
            ta = f32(dout + f32(lat1 * din));
            adv(lat3n);
            dout = next;
            din = f32(ta - f32(lat3 * dout));
            next = m[ptr];
            m[ptr] = din;
            tb = f32(dout + f32(lat3 * din));
            adv(lat4);
            dout = next;
            din = f32(tb - f32(lat3 * dout));
            m[ptr] = din;
            ido = f32(dout + f32(lat3 * din));
            tb = f32(ido + f32(decay * d4out));
            adv(lat5max);
            dout = tap(lat5n);
            din = f32(tb + f32(lat5 * dout));
            next = m[ptr];
            m[ptr] = din;
            ta = f32(dout - f32(lat5 * din));
            adv(d1[3]);
            t4 = next;
            next = m[ptr];
            m[ptr] = ta;
            t1 = tap(d1[0]);
            t2 = tap(d1[1]);
            t3 = tap(d1[2]);
            out1 = f32(-t2);
            out2 = f32(t1 + t3);
            ta = f32(f32(t4 * oneMinusDamping) + f32(damping * damp1));
            damp1 = ta;
            ta = f32(ta * decay);
            adv(lat6n);
            dout = next;
            din = f32(ta - f32(lat6 * dout));
            next = m[ptr];
            m[ptr] = din;
            tb = f32(dout + f32(lat6 * din));
            t1 = tap(lat6t1);
            t2 = tap(lat6t2);
            out1 = f32(out1 - t1);
            out2 = f32(out2 - t2);
            adv(d2[2]);
            t3 = next;
            m[ptr] = tb;
            t1 = tap(d2[0]);
            t2 = tap(d2[1]);
            out1 = f32(out1 - t1);
            out2 = f32(out2 + t2);
            tb = f32(ido + f32(decay * t3));
            adv(lat7max);
            dout = tap(lat7);
            din = f32(tb + f32(lat5 * dout));
            next = m[ptr];
            m[ptr] = din;
            ta = f32(dout - f32(lat5 * din));
            adv(d3[3]);
            t4 = next;
            next = m[ptr];
            m[ptr] = ta;
            t1 = tap(d3[0]);
            t2 = tap(d3[1]);
            t3 = tap(d3[2]);
            out1 = f32(out1 + f32(t1 + t3));
            out2 = f32(out2 - t2);
            ta = f32(f32(t4 * oneMinusDamping) + f32(damping * damp2));
            damp2 = ta;
            ta = f32(ta * decay);
            adv(lat8);
            dout = next;
            din = f32(ta - f32(lat6 * dout));
            next = m[ptr];
            m[ptr] = din;
            tb = f32(dout + f32(lat6 * din));
            t1 = tap(lat8t1);
            t2 = tap(lat8t2);
            out1 = f32(out1 - t2);
            out2 = f32(out2 - t1);
            adv(d4[2]);
            t3 = next;
            m[ptr] = tb;
            t1 = tap(d4[0]);
            t2 = tap(d4[1]);
            out1 = f32(out1 + t2);
            out2 = f32(out2 - t1);
            d4out = t3;
            out1 = f32(out1 * f32(0.6 * 0.5));
            out2 = f32(out2 * f32(0.6 * 0.5));
            buf[k] = f32(f32(out1 * wet) + f32(dry * in1));
            buf[k + 1] = f32(f32(out2 * wet) + f32(dry * in2));
        }
 }
};
