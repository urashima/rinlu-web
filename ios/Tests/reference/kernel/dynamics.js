/** SPDX-License-Identifier: AGPL-3.0-or-later. Copyright notices and modification record: ./NOTICE.txt */
import {kernel, float32} from './registry.js';
var ENV_BIAS = float32(1.0e-24);
class EnvelopeChannel {
    constructor(maxLen) {
        this.dly = new Float32Array(maxLen);
        this.ptr = 0;
        this.maxAbs = 0;
        this.delta = 0;
        this.env = 0;
        this.ramp = 0;
    }
}
class DynamicsStage {
    constructor(fs) {
        var omega = 6.283185 * 0.1 / float32(fs);
        var c = Math.cos(omega);
        var root2 = Math.sqrt(c * c - 4.0 * c + 3.0);
        var d = 2.0 - c - root2;
        this.a0 = float32(d);
        this.filtGain = float32(1.0 - d);
        this.level = 0;
        this.L = new EnvelopeChannel(96);
        this.R = new EnvelopeChannel(96);
        this.trace = [];
    }
    process(buf, n, p) {
        var gainSum = 0;
        for (var i = 0, k = 0; i < n; i++, k += 2) {
            var in1 = buf[k], in2 = buf[k + 1];
            var inSqr = float32(in1 * in1);
            this.level = this.level * this.a0 + inSqr * this.filtGain;
            var sqrtLevel = float32(Math.sqrt(this.level));
            var gb, result = float32(p.gainBoost * sqrtLevel);
            if (result > p.targetLevel) {
                gb = float32(p.targetLevel / sqrtLevel);
                if (gb < float32(1.06))
                    gb = float32(1.06);
            }
            else {
                gb = p.gainBoost;
            }
            gainSum += gb;
            var w1 = float32(float32(gb * p.maxOutput) * in1);
            var d1 = delayLine(this.L, w1, p);
            var out1 = envelope(this.L, d1, float32(Math.abs(w1)), p);
            var w2 = float32(float32(gb * p.maxOutput) * in2);
            var d2 = delayLine(this.R, w2, p);
            var out2 = envelope(this.R, d2, float32(Math.abs(w2)), p);
            buf[k] = float32(float32(out1 * float32(1.0)) + float32(float32(0.0) * in1));
            buf[k + 1] = float32(float32(out2 * float32(1.0)) + float32(float32(0.0) * in2));
        }
        this.trace.push(gainSum / n);
    }
}
function envelope(ch, dlyOut, newAbs, p) {
    var absOut;
    if (ch.ramp) {
        absOut = float32(Math.abs(dlyOut));
        if (absOut > ch.env)
            ch.env = absOut;
        if (newAbs > ch.maxAbs) {
            ch.maxAbs = newAbs;
            ch.ramp = p.maxDelay;
            var tmp = float32(float32(newAbs - ch.env) / float32(p.maxDelay + 1));
            if (tmp > ch.delta)
                ch.delta = tmp;
        }
        else {
            ch.ramp--;
        }
        ch.env = float32(ch.env + ch.delta);
    }
    else {
        ch.env = float32(float32(ch.env * p.releaseBeta) + ENV_BIAS);
        absOut = float32(Math.abs(dlyOut));
        if (absOut > ch.env)
            ch.env = absOut;
        if (newAbs > ch.env) {
            ch.maxAbs = newAbs;
            ch.delta = float32(float32(newAbs - ch.env) / float32(p.maxDelay + 1));
            ch.env = float32(ch.env + ch.delta);
            ch.ramp = p.maxDelay;
        }
    }
    return ch.env > p.maxOutput ? float32(float32(dlyOut * p.maxOutput) / ch.env) : dlyOut;
}
function delayLine(ch, value, p) {
    var out = ch.dly[ch.ptr];
    ch.dly[ch.ptr] = value;
    ch.ptr++;
    if (ch.ptr >= p.maxDelay)
        ch.ptr = 0;
    return out;
}
kernel.DynamicsStage = DynamicsStage;
