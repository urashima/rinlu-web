/** SPDX-License-Identifier: AGPL-3.0-or-later. Copyright notices and modification record: ./NOTICE.txt */
import {kernel, float32} from './registry.js';
class StereoStage {
    constructor() { }
    process(buf, n, p) {
        var side = float32(1 + 3.0 * p.intensity);
        var comp = float32(1 - 0.3 * p.intensity);
        for (var i = 0, k = 0; i < n; i++, k += 2) {
            var in1 = buf[k], in2 = buf[k + 1];
            var mono = float32(float32(in1 + in2) * float32(0.5));
            var l = float32(in1 - mono), r = float32(in2 - mono);
            mono = float32(mono * comp);
            buf[k] = float32(mono + float32(side * l));
            buf[k + 1] = float32(mono + float32(side * r));
        }
    }
}
kernel.StereoStage = StereoStage;
