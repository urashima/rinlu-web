/** SPDX-License-Identifier: AGPL-3.0-or-later. Copyright notices and modification record: ./NOTICE.txt */
import {kernel, float32} from './registry.js';
var DENORM_BIAS = float32(1.0e-36);
var L = {
    PRE: 100.0 / 1000.0, LAT1: 4.77 / 1000.0, LAT2: 3.595 / 1000.0, LAT3: 12.73 / 1000.0,
    LAT4: 9.31 / 1000.0, LAT5: 22.6 / 1000.0, MOD: 2.0 / 1000.0,
    D1: [10.1 / 1000.0, 66.9 / 1000.0, 121.9 / 1000.0, 149.6 / 1000.0],
    LAT6: [6.28 / 1000.0, 41.26 / 1000.0, 60.5 / 1000.0],
    D2: [35.8 / 1000.0, 89.8 / 1000.0, 125.0 / 1000.0], LAT7: 30.5 / 1000.0,
    D3: [10.1 / 1000.0, 70.9 / 1000.0, 99.9 / 1000.0, 141.7 / 1000.0],
    LAT8: [11.25 / 1000.0, 64.3 / 1000.0, 89.2 / 1000.0],
    D4: [4.065 / 1000.0, 67.1 / 1000.0, 106.3 / 1000.0]
};
class SpaceStage {
    constructor(fs, roomsize) {
        fs = float32(fs);
        var flt = function (sec) { return Math.trunc(float32(fs * float32(sec))); };
        var r = float32(roomsize * fs);
        var dbl = function (sec) { return Math.trunc(sec * r); };
        this.pre = flt(L.PRE);
        this.lat1 = flt(L.LAT1);
        this.lat2 = flt(L.LAT2);
        this.lat3 = flt(L.LAT3);
        this.lat4 = flt(L.LAT4);
        this.lat5 = dbl(L.LAT5);
        this.lat5max = this.lat5 + flt(L.MOD) + 1;
        this.d1 = L.D1.map(dbl);
        this.lat6t1 = dbl(L.LAT6[0]);
        this.lat6t2 = dbl(L.LAT6[1]);
        this.lat6 = dbl(L.LAT6[2]);
        this.d2 = L.D2.map(dbl);
        this.lat7 = dbl(L.LAT7);
        this.lat7max = this.lat7 + flt(L.MOD) + 1;
        this.d3 = L.D3.map(dbl);
        this.lat8t1 = dbl(L.LAT8[0]);
        this.lat8t2 = dbl(L.LAT8[1]);
        this.lat8 = dbl(L.LAT8[2]);
        this.d4 = L.D4.map(dbl);
        this.len = this.pre + this.lat1 + this.lat2 + this.lat3 + this.lat4 + this.lat5max + this.d1[3]
            + this.lat6 + this.d2[2] + this.lat7max + this.d3[3] + this.lat8 + this.d4[2];
        this.mem = new Float32Array(this.len);
        this.ptr = 0;
        this.bw = 0;
        this.damp1 = 0;
        this.damp2 = 0;
        this.d4out = 0;
    }
    process(buf, n, p) {
        var m = this.mem, len = this.len, end = len - 1;
        var self = this;
        function adv(step) { self.ptr += step; if (self.ptr > end)
            self.ptr -= len; }
        function tap(back) { var q = self.ptr - back; if (q < 0)
            q += len; return m[q]; }
        for (var i = 0, k = 0; i < n; i++, k += 2) {
            var in1 = float32(buf[k] + DENORM_BIAS), in2 = float32(buf[k + 1] + DENORM_BIAS);
            var out1, out2, ta, tb, t1, t2, t3, t4, next, din, dout, ido;
            adv(this.pre + 1);
            tb = tap(p.preDelay);
            next = m[this.ptr];
            m[this.ptr] = float32(in1 + in2);
            ta = float32(float32(tb * p.oneMinusBandwidth) + float32(p.bandwidth * this.bw));
            this.bw = ta;
            adv(this.lat1);
            dout = next;
            din = float32(ta - float32(p.lat1 * dout));
            next = m[this.ptr];
            m[this.ptr] = din;
            tb = float32(dout + float32(p.lat1 * din));
            adv(this.lat2);
            dout = next;
            din = float32(tb - float32(p.lat1 * dout));
            next = m[this.ptr];
            m[this.ptr] = din;
            ta = float32(dout + float32(p.lat1 * din));
            adv(this.lat3);
            dout = next;
            din = float32(ta - float32(p.lat3 * dout));
            next = m[this.ptr];
            m[this.ptr] = din;
            tb = float32(dout + float32(p.lat3 * din));
            adv(this.lat4);
            dout = next;
            din = float32(tb - float32(p.lat3 * dout));
            m[this.ptr] = din;
            ido = float32(dout + float32(p.lat3 * din));
            tb = float32(ido + float32(p.decay * this.d4out));
            adv(this.lat5max);
            dout = tap(this.lat5);
            din = float32(tb + float32(p.lat5 * dout));
            next = m[this.ptr];
            m[this.ptr] = din;
            ta = float32(dout - float32(p.lat5 * din));
            adv(this.d1[3]);
            t4 = next;
            next = m[this.ptr];
            m[this.ptr] = ta;
            t1 = tap(this.d1[0]);
            t2 = tap(this.d1[1]);
            t3 = tap(this.d1[2]);
            out1 = float32(-t2);
            out2 = float32(t1 + t3);
            ta = float32(float32(t4 * p.oneMinusDamping) + float32(p.damping * this.damp1));
            this.damp1 = ta;
            ta = float32(ta * p.decay);
            adv(this.lat6);
            dout = next;
            din = float32(ta - float32(p.lat6 * dout));
            next = m[this.ptr];
            m[this.ptr] = din;
            tb = float32(dout + float32(p.lat6 * din));
            t1 = tap(this.lat6t1);
            t2 = tap(this.lat6t2);
            out1 = float32(out1 - t1);
            out2 = float32(out2 - t2);
            adv(this.d2[2]);
            t3 = next;
            m[this.ptr] = tb;
            t1 = tap(this.d2[0]);
            t2 = tap(this.d2[1]);
            out1 = float32(out1 - t1);
            out2 = float32(out2 + t2);
            tb = float32(ido + float32(p.decay * t3));
            adv(this.lat7max);
            dout = tap(this.lat7);
            din = float32(tb + float32(p.lat5 * dout));
            next = m[this.ptr];
            m[this.ptr] = din;
            ta = float32(dout - float32(p.lat5 * din));
            adv(this.d3[3]);
            t4 = next;
            next = m[this.ptr];
            m[this.ptr] = ta;
            t1 = tap(this.d3[0]);
            t2 = tap(this.d3[1]);
            t3 = tap(this.d3[2]);
            out1 = float32(out1 + float32(t1 + t3));
            out2 = float32(out2 - t2);
            ta = float32(float32(t4 * p.oneMinusDamping) + float32(p.damping * this.damp2));
            this.damp2 = ta;
            ta = float32(ta * p.decay);
            adv(this.lat8);
            dout = next;
            din = float32(ta - float32(p.lat6 * dout));
            next = m[this.ptr];
            m[this.ptr] = din;
            tb = float32(dout + float32(p.lat6 * din));
            t1 = tap(this.lat8t1);
            t2 = tap(this.lat8t2);
            out1 = float32(out1 - t2);
            out2 = float32(out2 - t1);
            adv(this.d4[2]);
            t3 = next;
            m[this.ptr] = tb;
            t1 = tap(this.d4[0]);
            t2 = tap(this.d4[1]);
            out1 = float32(out1 + t2);
            out2 = float32(out2 - t1);
            this.d4out = t3;
            out1 = float32(out1 * float32(0.6 * 0.5));
            out2 = float32(out2 * float32(0.6 * 0.5));
            buf[k] = float32(float32(out1 * p.wet) + float32(p.dry * in1));
            buf[k + 1] = float32(float32(out2 * p.wet) + float32(p.dry * in2));
        }
    }
}
kernel.SpaceStage = SpaceStage;
