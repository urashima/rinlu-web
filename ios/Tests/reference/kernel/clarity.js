/** SPDX-License-Identifier: AGPL-3.0-or-later. Copyright notices and modification record: ./NOTICE.txt */
import {kernel, float32} from './registry.js';
var BIAS = float32(1.0e-30);
class ClarityStage {
    constructor() {
        this.o1 = 0;
        this.o2 = 0;
        this.i1 = 0;
        this.i2 = 0;
        this.p1 = 0;
        this.p2 = 0;
        this.j1 = 0;
        this.j2 = 0;
    }
    process(buf, n, p) {
        for (var i = 0, k = 0; i < n; i++, k += 2) {
            var in1 = buf[k], in2 = buf[k + 1];
            var h = float32(float32(this.o1 * p.a1) + float32(this.o2 * p.a0));
            this.o2 = this.o1;
            h = float32(h + float32(float32(float32(float32(in1 + BIAS) - float32(2 * this.i1)) + this.i2) * p.gain));
            this.o1 = h;
            this.i2 = this.i1;
            this.i1 = in1;
            h = float32(h * p.drive);
            var odd1 = float32(Math.sin(h)), even1 = h > 0 ? h : 0;
            var out1 = float32(in1 + float32(float32(p.even * even1) + float32(p.odd * odd1)));
            var h2 = float32(float32(this.p1 * p.a1) + float32(this.p2 * p.a0));
            this.p2 = this.p1;
            h2 = float32(h2 + float32(float32(float32(float32(in2 + BIAS) - float32(2 * this.j1)) + this.j2) * p.gain));
            this.p1 = h2;
            this.j2 = this.j1;
            this.j1 = in2;
            h2 = float32(h2 * p.drive);
            var odd2 = float32(Math.sin(h2)), even2 = h2 > 0 ? h2 : 0;
            var out2 = float32(in2 + float32(float32(p.even * even2) + float32(p.odd * odd2)));
            buf[k] = float32(float32(out1 * p.wet) + float32(p.dry * in1));
            buf[k + 1] = float32(float32(out2 * p.wet) + float32(p.dry * in2));
        }
    }
}
kernel.ClarityStage = ClarityStage;
