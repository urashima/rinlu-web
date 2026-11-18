/** SPDX-License-Identifier: AGPL-3.0-or-later. Copyright notices and modification record: ./NOTICE.txt */
import {kernel, float32} from './registry.js';
var PI = 3.141592653589793238462643;
var SPN = 1.65436e-24;
var SOS_FLOAT_BIAS = float32(1.0e-30);
function bw2angle(a, bandwidth) {
    var twoPi = float32(2 * PI);
    var T = float32(Math.tan(float32(twoPi * bandwidth)));
    var a2 = float32(a * a), a4 = float32(a2 * a2);
    var d = float32(float32(2 * a2) * T);
    var sn = float32(float32(1 + a4) * T);
    var cs = float32(1 - a4);
    var mag = float32(Math.sqrt(float32(float32(sn * sn) + float32(cs * cs))));
    d = float32(d / mag);
    var delta = float32(Math.atan2(sn, cs));
    var asnd = float32(Math.asin(d));
    var theta = float32(float32(0.5) * float32(float32(float32(PI) - asnd) - delta));
    var tmp = float32(float32(0.5) * float32(asnd - delta));
    if (tmp > 0 && tmp < theta)
        theta = tmp;
    if (bandwidth >= 0.5)
        theta = float32(0.005);
    return float32(theta / twoPi);
}
function calcParametric(sampFreq, centerFreq, boost, Q) {
    if (boost === 0)
        return { on: false, boost: 0, b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, Q: Q };
    var maxQ;
    if (centerFreq < 60) {
        maxQ = float32(float32(float32(centerFreq - 20) * float32(float32(19) / float32(40))) + 1);
        if (Q > maxQ)
            Q = maxQ;
    }
    var absBoost = float32(Math.abs(boost));
    if (absBoost < 6) {
        maxQ = float32(float32(absBoost * float32(float32(float32(20) - float32(0.2)) / float32(6))) + float32(0.2));
        if (Q > maxQ)
            Q = maxQ;
    }
    var center = float32(centerFreq / sampFreq);
    var bandwidth = float32(center / Q);
    var a = float32(Math.tan(float32(float32(PI) * float32(center - float32(0.25)))));
    var asq = float32(a * a);
    var A = float32(Math.pow(10.0, float32(boost / float32(20))));
    var F;
    if (boost < 6 && boost > -6)
        F = float32(Math.sqrt(A));
    else if (A > 1)
        F = float32(A / float32(Math.sqrt(2.0)));
    else
        F = float32(A * float32(Math.sqrt(2.0)));
    var xfmbw = bw2angle(a, bandwidth);
    var C = float32(1 / float32(Math.tan(float32(float32(2 * PI) * xfmbw))));
    var F2 = float32(F * F);
    var tmp = float32(float32(A * A) - F2);
    var alphad = (Math.abs(tmp) <= SPN) ? C : float32(Math.sqrt(float32(float32(float32(C * C) * float32(F2 - 1)) / tmp)));
    var alphan = float32(A * alphad);
    var a2plus1 = float32(1 + asq), ma2plus1 = float32(1 - asq);
    var b0 = float32(a2plus1 + float32(alphan * ma2plus1));
    var b1 = float32(4 * a);
    var b2 = float32(a2plus1 - float32(alphan * ma2plus1));
    var a0 = float32(a2plus1 + float32(alphad * ma2plus1));
    var a2 = float32(a2plus1 - float32(alphad * ma2plus1));
    var recip = float32(1 / a0);
    b0 = float32(b0 * recip);
    b1 = float32(b1 * recip);
    b2 = float32(b2 * recip);
    a2 = float32(a2 * recip);
    return { on: true, boost: boost, b0: b0, b1: b1, b2: b2, a1: b1, a2: a2, Q: Q };
}
var frequencyCenters = [62.5, 115.734, 214.311, 396.85, 734.867, 1360.79, 2519.84, 4666.12, 8640.48, 16000.0].map(float32);
function bandQ(qMultiplier) {
    var r = Math.pow(16000 / 62.5, 1.0 / (frequencyCenters.length - 1));
    var Q = float32(Math.sqrt(r) / (r - 1.0));
    Q = float32(Q * float32(qMultiplier));
    if (Q < 1)
        Q = float32(1);
    return Q;
}
var K = {
    Ceiling: float32(1.0), AttackAlpha: float32(0.10), ReleaseAlphaFast: float32(0.05), ReleaseAlphaSlow: float32(0.02),
    ReleaseGapThreshold: float32(0.15), PredictionStrength: float32(0.35), PredictionClamp: float32(0.15),
    PredictionMissRatio: float32(0.35), SidechainHpfHz: float32(120.0), ToneLowHz: float32(180.0),
    ToneBodyHz: float32(1200.0), TonePresenceHz: float32(4500.0), MinRatioPerBuffer: float32(0.8912509381337456),
    TonalityDbRange: float32(7.0), TonalitySmoothing: float32(0.08), MuffledTargetBoost: float32(0.12),
    ClearTargetReduction: float32(0.18), ClearCeilingReduction: float32(0.08), HeadroomTimeSeconds: float32(60.0),
    HeadroomTargetBoost: float32(0.08), HeadroomTargetReduction: float32(0.14), HeadroomComfortThreshold: float32(0.18),
    HeadroomNearCeilingThreshold: float32(0.985), HeadroomHitThreshold: float32(0.002),
    VeryQuietRmsThreshold: float32(0.035), QuietAudiblePeakThreshold: float32(0.0035), QuietFullBoostPeak: float32(0.02),
    QuietMaxGain: float32(10.0), QuietReleaseAlpha: float32(0.18), QuietActivationSeconds: float32(10.0),
    QuietActivationRampSeconds: float32(2.0), QuietFloorReleaseRmsThreshold: float32(0.06),
    QuietFloorReleaseAlpha: float32(0.02), QuietFloorSilenceDecayAlpha: float32(0.08),
    QuietPeakBucketSeconds: float32(1.0), QuietPeakTargetRatio: float32(0.98), QuietPeakFloorRaiseTimeSeconds: float32(6.0),
    Pi: float32(3.14159265358979323846), HistorySize: 6, PeakWindowSize: 30
};
function clampReal(v, lo, hi) { return Math.max(lo, Math.min(v, hi)); }
function onePoleAlpha(cutoff, fs) {
    var dt = float32(1 / fs), rc = float32(1 / float32(float32(float32(2) * K.Pi) * cutoff));
    return float32(dt / float32(rc + dt));
}
class EqualizerStage {
    constructor(fs, settings) {
        this.fs = float32(fs);
        var Q = bandQ(settings.qMultiplier);
        this.Q = Q;
        this.sections = [];
        for (var i = 0; i < frequencyCenters.length; i++) {
            var g = settings.gains[i] || 0;
            if (g > 20)
                g = 20;
            if (g < -20)
                g = -20;
            var c = (g === 0 || float32(frequencyCenters[i] * 2) >= this.fs)
                ? { on: false, b0: 1, b1: 0, b2: 0, a2: 0 }
                : calcParametric(this.fs, frequencyCenters[i], float32(g), Q);
            c.s1 = 0;
            c.s2 = 0;
            c.s3 = 0;
            c.s4 = 0;
            this.sections.push(c);
        }
        this.masterGain = float32(Math.pow(10.0, float32(float32(settings.masterGainDb || 0) / float32(20))));
        var bal = float32(settings.balanceDb || 0);
        this.balanceLeft = float32(1);
        this.balanceRight = float32(1);
        if (bal > 0)
            this.balanceLeft = float32(Math.pow(10.0, float32(float32(-bal) / float32(20))));
        else if (bal < 0)
            this.balanceRight = float32(Math.pow(10.0, float32(bal / float32(20))));
        this.targetRms = float32(Math.pow(10.0, float32(float32(settings.normalizationDb || 0) / float32(20))));
        this.normalizationGain = float32(1);
        var vl = float32(Math.max(0, Math.min(settings.volumeLeveling || 0, 4)));
        this.vlTargetRms = float32(float32(vl / float32(4)) * float32(0.5));
        this.vl = {
            gain: float32(1), powerHistory: new Float32Array(K.HistorySize), powerSum: 0, powerIndex: 0,
            powerCount: 0, prevAvg: 0, prevPred: 0, alphaFs: 0, scAlpha: 0, lowA: 0, bodyA: 0, presA: 0,
            scPrevIn: [0, 0], scPrevOut: [0, 0], tone: [[0, 0, 0], [0, 0, 0]], tonality: 0, headroom: 0,
            quietDuration: 0, quietFloor: float32(1), peakHistory: new Float32Array(K.PeakWindowSize),
            peakIndex: 0, peakCount: 0, bucketMax: 0, bucketSeconds: 0
        };
        this.trace = [];
    }
    processMasterGainOnly(buf) {
        for (var i = 0; i < buf.length; i++)
            buf[i] = float32(buf[i] * this.masterGain);
    }
    process(buf, n, opts) {
        opts = opts || {};
        var eqOn = opts.eq !== false, gainOn = opts.gain !== false;
        var mg = gainOn ? this.masterGain : float32(1);
        var bl = gainOn ? this.balanceLeft : float32(1), br = gainOn ? this.balanceRight : float32(1);
        var secs = this.sections, sumSquares = float32(0), k = 0;
        for (var j = 0; j < n; j++, k += 2) {
            var in1 = buf[k], in2 = buf[k + 1], out1 = in1, out2 = in2;
            if (eqOn) {
                for (var i = 0; i < secs.length; i++) {
                    var s = secs[i];
                    if (!s.on)
                        continue;
                    out1 = float32(float32(s.s1 + float32(s.b0 * in1)) + SOS_FLOAT_BIAS);
                    s.s1 = float32(float32(float32(in1 - out1) * s.b1) + s.s2);
                    s.s2 = float32(float32(s.b2 * in1) - float32(s.a2 * out1));
                    in1 = out1;
                    out2 = float32(float32(s.s3 + float32(s.b0 * in2)) + SOS_FLOAT_BIAS);
                    s.s3 = float32(float32(float32(in2 - out2) * s.b1) + s.s4);
                    s.s4 = float32(float32(s.b2 * in2) - float32(s.a2 * out2));
                    in2 = out2;
                }
            }
            buf[k] = float32(float32(out1 * mg) * bl);
            buf[k + 1] = float32(float32(out2 * mg) * br);
            if (this.targetRms !== float32(1))
                sumSquares = float32(sumSquares + float32(float32(buf[k] * buf[k]) + float32(buf[k + 1] * buf[k + 1])));
        }
        if (opts.normalization !== false && this.targetRms !== float32(1))
            this.normalize(buf, n, sumSquares);
        if (opts.leveling !== false)
            this.applyVolumeLeveling(buf, n, 2, this.fs, -1);
        this.trace.push(this.vl.gain);
    }
    normalize(buf, n, sumSquares) {
        var currentRms = float32(Math.sqrt(float32(sumSquares / float32(n * 2))));
        if (currentRms < float32(1e-6))
            currentRms = float32(1e-6);
        var targetGain = float32(this.targetRms / currentRms);
        targetGain = Math.max(float32(0.01), Math.min(targetGain, float32(1)));
        var diff = float32(Math.abs(float32(targetGain - this.normalizationGain)));
        var smoothing = targetGain > this.normalizationGain ? float32(float32(0.0005) + float32(diff * float32(0.001))) : float32(1);
        smoothing = Math.min(smoothing, float32(0.5));
        this.normalizationGain = float32(this.normalizationGain + float32(float32(targetGain - this.normalizationGain) * smoothing));
        for (var i = 0; i < n * 2; i++)
            buf[i] = float32(buf[i] * this.normalizationGain);
    }
    updateQuietPeakWindow(postPeak, dur) {
        var v = this.vl;
        v.bucketMax = Math.max(v.bucketMax, postPeak);
        v.bucketSeconds = float32(v.bucketSeconds + dur);
        while (v.bucketSeconds >= K.QuietPeakBucketSeconds) {
            v.peakHistory[v.peakIndex] = v.bucketMax;
            v.peakIndex = (v.peakIndex + 1) % K.PeakWindowSize;
            if (v.peakCount < K.PeakWindowSize)
                v.peakCount++;
            v.bucketSeconds = float32(v.bucketSeconds - K.QuietPeakBucketSeconds);
            v.bucketMax = 0;
        }
    }
    quietPeakWindowMax() {
        var v = this.vl, m = v.bucketMax;
        for (var i = 0; i < v.peakCount; i++)
            m = Math.max(m, v.peakHistory[i]);
        return m;
    }
    applyVolumeLeveling(buf, n, ch, sampFreq, excluded) {
        var v = this.vl;
        if (this.vlTargetRms <= 0 || n <= 0 || ch <= 0) {
            v.gain = float32(1);
            return;
        }
        var analyzed = excluded >= 0 ? ch - 1 : ch;
        if (analyzed <= 0)
            return;
        var sumSquares = float32(0), peak = float32(0), low = float32(0), body = float32(0), pres = float32(0), air = float32(0), idx = 0;
        var fs = sampFreq > 1000 ? sampFreq : float32(48000);
        if (v.alphaFs !== fs) {
            var dt = float32(1 / fs), rc = float32(1 / float32(float32(float32(2) * K.Pi) * K.SidechainHpfHz));
            v.scAlpha = float32(rc / float32(rc + dt));
            v.lowA = onePoleAlpha(K.ToneLowHz, fs);
            v.bodyA = onePoleAlpha(K.ToneBodyHz, fs);
            v.presA = onePoleAlpha(K.TonePresenceHz, fs);
            v.alphaFs = fs;
        }
        for (var s = 0; s < n; s++, idx += ch) {
            for (var c = 0; c < ch; c++) {
                if (c === excluded)
                    continue;
                var value = buf[idx + c];
                var sc = float32(v.scAlpha * float32(float32(v.scPrevOut[c] + value) - v.scPrevIn[c]));
                v.scPrevIn[c] = value;
                v.scPrevOut[c] = sc;
                sumSquares = float32(sumSquares + float32(sc * sc));
                var av = float32(Math.abs(sc));
                if (av > peak)
                    peak = av;
                var t = v.tone[c];
                t[0] = float32(t[0] + float32(v.lowA * float32(value - t[0])));
                t[1] = float32(t[1] + float32(v.bodyA * float32(value - t[1])));
                t[2] = float32(t[2] + float32(v.presA * float32(value - t[2])));
                var lb = t[0], bb = float32(t[1] - t[0]), pb = float32(t[2] - t[1]), ab = float32(value - t[2]);
                low = float32(low + float32(lb * lb));
                body = float32(body + float32(bb * bb));
                pres = float32(pres + float32(pb * pb));
                air = float32(air + float32(ab * ab));
            }
        }
        var currentPower = float32(sumSquares / float32(n * analyzed));
        var currentRms = float32(Math.sqrt(currentPower));
        var gainStart = v.gain, gainEnd = gainStart;
        var hReduce = Math.max(v.headroom, 0), hBoost = Math.max(-v.headroom, 0);
        var floor = Math.max(v.quietFloor, float32(1));
        var quietBefore = v.quietDuration;
        var num = float32(float32(pres + float32(air * float32(0.75))) + float32(1e-12));
        var den = float32(float32(float32(body * float32(1.15)) + float32(low * float32(0.85))) + float32(1e-12));
        var tonalityDb = float32(10.0 * Math.log10(float32(num / den)));
        var targetTonality = clampReal(float32(tonalityDb / K.TonalityDbRange), float32(-1), float32(1));
        v.tonality = float32(float32(v.tonality * float32(1 - K.TonalitySmoothing)) + float32(targetTonality * K.TonalitySmoothing));
        var clear = Math.max(v.tonality, 0), muffled = Math.max(-v.tonality, 0);
        var dur = float32(n / fs);
        var upAuth = clampReal(float32(float32(float32(1) - float32(hReduce * float32(1.5))) + float32(hBoost * float32(0.25))), float32(0), float32(1));
        var downAuth = clampReal(float32(float32(0.35) + float32(upAuth * float32(0.65))), float32(0.35), float32(1));
        var gMuffled = float32(muffled * upAuth), gClear = float32(clear * downAuth);
        var effTarget = float32(this.vlTargetRms * float32(float32(float32(float32(float32(1) + float32(gMuffled * K.MuffledTargetBoost))
            - float32(gClear * K.ClearTargetReduction)) + float32(hBoost * K.HeadroomTargetBoost)) - float32(hReduce * K.HeadroomTargetReduction)));
        var ceiling = clampReal(float32(K.Ceiling * float32(float32(1) - float32(gClear * K.ClearCeilingReduction))), float32(0.92), K.Ceiling);
        var maxGainCap = Math.max(float32(effTarget / float32(0.125)), floor);
        if (v.powerCount === K.HistorySize)
            v.powerSum = float32(v.powerSum - v.powerHistory[v.powerIndex]);
        else
            v.powerCount++;
        v.powerHistory[v.powerIndex] = currentPower;
        v.powerSum = float32(v.powerSum + currentPower);
        v.powerIndex = (v.powerIndex + 1) % K.HistorySize;
        var averaged = currentRms;
        if (v.powerCount > 0)
            averaged = float32(Math.sqrt(float32(v.powerSum / v.powerCount)));
        var predicted = averaged, missed = false;
        if (v.prevAvg > float32(1e-6)) {
            var pd = float32(v.prevPred - v.prevAvg), ad = float32(averaged - v.prevAvg);
            var missThreshold = Math.max(float32(v.prevAvg * float32(0.01)), float32(1e-5));
            if (Math.abs(pd) > missThreshold) {
                var wrong = float32(pd * ad) < 0;
                var overshot = Math.abs(ad) < float32(Math.abs(pd) * K.PredictionMissRatio);
                if (wrong || overshot)
                    missed = true;
            }
        }
        if (v.prevAvg > float32(1e-6)) {
            var gradient = float32(averaged - v.prevAvg);
            predicted = float32(predicted + float32(gradient * K.PredictionStrength));
            predicted = clampReal(predicted, float32(averaged * float32(1 - K.PredictionClamp)), float32(averaged * float32(1 + K.PredictionClamp)));
        }
        if (missed)
            predicted = averaged;
        predicted = Math.max(predicted, float32(1e-6));
        v.prevAvg = averaged;
        v.prevPred = predicted;
        if (currentRms > float32(1e-6)) {
            var qActivation = clampReal(float32(float32(v.quietDuration - K.QuietActivationSeconds) / K.QuietActivationRampSeconds), float32(0), float32(1));
            var qRms = clampReal(float32(float32(K.VeryQuietRmsThreshold - predicted) / K.VeryQuietRmsThreshold), float32(0), float32(1));
            var qPeak = clampReal(float32(float32(peak - K.QuietAudiblePeakThreshold) / float32(K.QuietFullBoostPeak - K.QuietAudiblePeakThreshold)), float32(0), float32(1));
            var qBoost = float32(float32(qRms * qPeak) * qActivation);
            if (qBoost > 0) {
                var qCap = Math.max(maxGainCap, K.QuietMaxGain);
                maxGainCap = float32(maxGainCap + float32(float32(qCap - maxGainCap) * qBoost));
            }
            var desired = float32(effTarget / predicted);
            desired = Math.min(desired, maxGainCap);
            desired = Math.max(desired, floor);
            var alpha = K.AttackAlpha;
            if (desired >= v.gain) {
                var gap = float32(desired - v.gain);
                var ratio = float32(gap / Math.max(v.gain, float32(1e-6)));
                alpha = ratio > K.ReleaseGapThreshold ? K.ReleaseAlphaSlow : K.ReleaseAlphaFast;
                alpha = float32(alpha * clampReal(float32(float32(float32(1) + float32(gMuffled * float32(0.20))) - float32(gClear * float32(0.35))), float32(0.55), float32(1.20)));
                alpha = Math.max(alpha, float32(K.QuietReleaseAlpha * qBoost));
            }
            gainEnd = float32(float32(v.gain * float32(float32(1) - alpha)) + float32(desired * alpha));
        }
        if (gainEnd < gainStart) {
            var minEnd = float32(gainStart * K.MinRatioPerBuffer);
            if (gainEnd < minEnd)
                gainEnd = minEnd;
        }
        if (peak > float32(1e-6)) {
            var safe = float32(ceiling / peak);
            if (gainEnd > safe)
                gainEnd = safe;
            if (gainStart > safe)
                gainStart = safe;
        }
        gainStart = clampReal(gainStart, float32(0), maxGainCap);
        gainEnd = clampReal(gainEnd, float32(0), maxGainCap);
        v.gain = gainEnd;
        idx = 0;
        var postSum = float32(0), postPeak = float32(0), hits = 0;
        for (var sm = 0; sm < n; sm++, idx += ch) {
            var tt = float32(sm / n);
            var g = float32(gainStart + float32(tt * float32(gainEnd - gainStart)));
            for (var cc = 0; cc < ch; cc++) {
                if (cc === excluded)
                    continue;
                var o = float32(buf[idx + cc] * g);
                var oa = float32(Math.abs(o));
                postSum = float32(postSum + float32(o * o));
                if (oa > postPeak)
                    postPeak = oa;
                if (oa >= float32(ceiling * K.HeadroomNearCeilingThreshold))
                    hits++;
                if (o > ceiling)
                    o = ceiling;
                else if (o < -ceiling)
                    o = -ceiling;
                buf[idx + cc] = o;
            }
        }
        var postRms = float32(Math.sqrt(float32(postSum / float32(n * analyzed))));
        this.updateQuietPeakWindow(postPeak, dur);
        var rolling = this.quietPeakWindowMax();
        if (peak > K.QuietAudiblePeakThreshold && postRms < K.VeryQuietRmsThreshold)
            v.quietDuration = float32(v.quietDuration + dur);
        else
            v.quietDuration = 0;
        if (quietBefore >= K.QuietActivationSeconds && gainEnd > float32(effTarget / float32(0.125)) && gainEnd > floor)
            floor = gainEnd;
        var windowReady = v.peakCount === K.PeakWindowSize;
        var floorActive = quietBefore >= K.QuietActivationSeconds || floor > 1;
        var peakTarget = float32(ceiling * K.QuietPeakTargetRatio);
        var headroomAvail = rolling > K.QuietAudiblePeakThreshold && rolling < peakTarget && hReduce < float32(0.25);
        if (windowReady && floorActive && headroomAvail) {
            var desiredFloor = float32(floor * float32(peakTarget / Math.max(rolling, float32(1e-6))));
            desiredFloor = clampReal(desiredFloor, floor, K.QuietMaxGain);
            var raise = clampReal(float32(dur / K.QuietPeakFloorRaiseTimeSeconds), float32(0.0005), float32(0.05));
            floor = float32(float32(floor * float32(float32(1) - raise)) + float32(desiredFloor * raise));
        }
        if (peak <= K.QuietAudiblePeakThreshold)
            floor = float32(floor + float32(float32(float32(1) - floor) * K.QuietFloorSilenceDecayAlpha));
        else if (postRms > K.QuietFloorReleaseRmsThreshold)
            floor = float32(floor + float32(float32(float32(1) - floor) * K.QuietFloorReleaseAlpha));
        if (floor < float32(1.0001))
            floor = float32(1);
        v.quietFloor = floor;
        var hitRatio = float32(hits / float32(n * analyzed));
        var headroomRatio = clampReal(float32(float32(ceiling - postPeak) / ceiling), float32(0), float32(1));
        var targetHs = 0;
        if (hitRatio > K.HeadroomHitThreshold)
            targetHs = clampReal(float32(hitRatio / float32(0.02)), float32(0), float32(1));
        else if (postPeak >= float32(ceiling * K.HeadroomNearCeilingThreshold))
            targetHs = clampReal(float32(float32(float32(postPeak / ceiling) - K.HeadroomNearCeilingThreshold) / float32(float32(1) - K.HeadroomNearCeilingThreshold)), float32(0), float32(1));
        else if (headroomRatio > K.HeadroomComfortThreshold)
            targetHs = -clampReal(float32(float32(headroomRatio - K.HeadroomComfortThreshold) / float32(0.25)), float32(0), float32(1));
        var hAlpha = clampReal(float32(dur / K.HeadroomTimeSeconds), float32(0.0005), float32(0.05));
        v.headroom = float32(float32(v.headroom * float32(float32(1) - hAlpha)) + float32(targetHs * hAlpha));
    }
}
kernel.filters = {
    calcParametric: calcParametric,
    bw2angle: bw2angle,
    bandQ: bandQ,
    frequencyCenters: frequencyCenters,
    EqualizerStage: EqualizerStage
};
