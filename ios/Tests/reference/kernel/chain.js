/** SPDX-License-Identifier: AGPL-3.0-or-later. Copyright notices and modification record: ./NOTICE.txt */
import {kernel, float32} from './registry.js';
var BIAS = float32(1.0e-30);
class ProcessingChain {
    constructor(fs, params) {
        this.aural = new kernel.ClarityStage();
        this.lex = new kernel.SpaceStage(fs, params.lex.roomsize);
        this.wide = new kernel.StereoStage();
        this.maxi = new kernel.DynamicsStage(fs);
        this.w1 = 0;
        this.w2 = 0;
        this.v1 = 0;
        this.v2 = 0;
    }
    bass(buf, n, p) {
        for (var i = 0, k = 0; i < n; i++, k += 2) {
            var in1 = buf[k], in2 = buf[k + 1];
            var out1 = float32(this.w1 + float32(p.b0 * float32(in1 + BIAS)));
            this.w1 = float32(float32(float32(in1 - out1) * p.b1) + this.w2);
            this.w2 = float32(float32(p.b2 * in1) - float32(p.a2 * out1));
            var out2 = float32(this.v1 + float32(p.b0 * float32(in2 + BIAS)));
            this.v1 = float32(float32(float32(in2 - out2) * p.b1) + this.v2);
            this.v2 = float32(float32(p.b2 * in2) - float32(p.a2 * out2));
            buf[k] = out1;
            buf[k + 1] = out2;
        }
    }
    process(buf, n, params, stages) {
        stages = stages || {};
        if (params.aural.on && stages.fidelity !== false)
            this.aural.process(buf, n, params.aural);
        if (params.lex.on && stages.ambience !== false)
            this.lex.process(buf, n, params.lex);
        if (params.wide.on && stages.surround !== false)
            this.wide.process(buf, n, params.wide);
        if (params.bass.on && stages.bass !== false)
            this.bass(buf, n, params.bass);
        if (stages.dynamicBoost !== false)
            this.maxi.process(buf, n, params.maxi);
    }
}
kernel.ProcessingChain = ProcessingChain;
