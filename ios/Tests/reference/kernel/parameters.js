/** SPDX-License-Identifier: AGPL-3.0-or-later. Copyright notices and modification record: ./NOTICE.txt */
import {kernel, float32} from './registry.js';
var TWO_PI = 6.283185307;
var MIDI_MAX = 127;
function linearTable(min, max) {
    min = float32(min);
    max = float32(max);
    var t = new Float32Array(MIDI_MAX + 1);
    var scale = float32((max - min) / MIDI_MAX);
    for (var i = 0; i <= MIDI_MAX; i++)
        t[i] = float32(min + float32(scale * i));
    t[MIDI_MAX] = max;
    return t;
}
function expTable(min, max) {
    min = float32(min);
    max = float32(max);
    var t = new Float32Array(MIDI_MAX + 1);
    var factor = float32(Math.pow(float32(max / min), 1.0 / MIDI_MAX));
    t[0] = min;
    t[MIDI_MAX] = max;
    for (var i = 1; i < MIDI_MAX; i++)
        t[i] = float32(t[i - 1] * factor);
    return t;
}
function maxiBoostDspTable() {
    var t = new Float32Array(MIDI_MAX + 1);
    t[0] = 0;
    t[MIDI_MAX] = 30;
    var index = 0, v, tmp;
    var s1 = float32(0.1), s2 = float32(0.2), s3 = float32(0.5);
    for (v = 0; (tmp = float32(v * s1)) < 6; v++)
        t[index++] = tmp;
    for (v = 0; (tmp = float32(float32(v * s2) + 6)) < 12; v++)
        t[index++] = tmp;
    for (v = 0; (tmp = float32(float32(v * s3) + 12)) < 30; v++)
        t[index++] = tmp;
    t[126] = t[127];
    for (var i = 0; i <= MIDI_MAX; i++)
        t[i] = float32(Math.pow(10.0, t[i] / 20.0));
    return t;
}
function butterworthHighPass(omega) {
    var omega2 = float32(omega * omega);
    var twoRoot2omega = float32(float32(2.0 * Math.sqrt(2.0)) * omega);
    var tmp = float32(1 / float32(float32(4 + omega2) + twoRoot2omega));
    return {
        gain: float32(4 * tmp),
        a1: float32(float32(8 - float32(2 * omega2)) * tmp),
        a0: float32(float32(float32(twoRoot2omega - 4) - omega2) * tmp)
    };
}
function simpleLowpassCoeff(omega) {
    var cos = float32(Math.cos(omega));
    var root = float32(Math.sqrt(float32(float32(float32(cos * cos) - float32(4 * cos)) + 3)));
    return float32(float32(2 - cos) - root);
}
var fixedCache = {};
function fixedParams(fs) {
    if (fixedCache[fs])
        return fixedCache[fs];
    fs = float32(fs);
    var period = float32(1 / fs);
    var midi = { auralTune: 53, roomSize: 64, rolloff: 89, damping: 81, releaseBeta: 85 };
    var omegaMin = float32(float32(float32(TWO_PI) * float32(500)) * period);
    var omegaMax = float32(float32(float32(TWO_PI) * float32(10000)) * period);
    var factor = float32(Math.pow(float32(omegaMax / omegaMin), 1.0 / MIDI_MAX));
    var omega = omegaMin;
    for (var i = 1; i <= midi.auralTune; i++)
        omega = float32(omega * factor);
    var hp = butterworthHighPass(omega);
    var knob = expTable(1.0, 20.0);
    function lowpassAt(m) {
        var freq = float32(knob[m] * float32(1.0e3));
        return simpleLowpassCoeff(float32(float32(float32(TWO_PI) * freq) * period));
    }
    var bandwidth = lowpassAt(midi.rolloff);
    var damping = lowpassAt(midi.damping);
    var tc = expTable(0.1, 100.0)[midi.releaseBeta];
    var beta = float32(Math.exp(-float32(1 / float32(float32(tc * float32(0.001)) * fs))));
    var params = {
        fs: fs,
        aural: { gain: hp.gain, a1: hp.a1, a0: hp.a0, odd: float32(1.5), even: 0,
            wet: float32(0.377953), dry: float32(0.622047) },
        lex: { roomsize: linearTable(0.5, 1.5)[midi.roomSize],
            bandwidth: bandwidth, oneMinusBandwidth: float32(1 - bandwidth),
            damping: damping, oneMinusDamping: float32(1 - damping),
            lat1: float32(0.75), lat3: float32(0.625), lat5: float32(0.70), preDelay: 1 },
        maxi: { releaseBeta: beta, targetLevel: float32(0.32), maxOutput: float32(0.966051),
            maxDelay: Math.trunc(float32(fs * float32(0.00075))) }
    };
    fixedCache[fs] = params;
    return params;
}
var DRIVE_MAX = float32(float32(TWO_PI / 4.0 * 1.8 * 2.0 * 0.75) * float32(0.8));
var tables = {
    fidelity: linearTable(0, DRIVE_MAX),
    ambience: expTable(0.095, 0.95),
    surround: linearTable(0, float32(1.0 * float32(0.7))),
    dynamicBoost: maxiBoostDspTable()
};
var bassCache = {};
function bassTable(fs) {
    if (bassCache[fs])
        return bassCache[fs];
    var factor = float32(float32(15) / float32(127));
    var t = [];
    for (var i = 0; i <= MIDI_MAX; i++) {
        var boost = float32(0 + float32(i * factor));
        t.push(kernel.filters.calcParametric(float32(fs), float32(90), boost, float32(2.5)));
    }
    bassCache[fs] = t;
    return t;
}
function sliderToMidi(slider) {
    var knob = float32(float32(slider) / float32(10));
    return Math.trunc(float32(float32(float32(knob - 0) * float32(127)) + float32(0.5)));
}
function effectParams(input, fs) {
    var sliders = {};
    ["fidelity", "ambience", "surround", "dynamicBoost", "bass"].forEach(function (k) {
        sliders[k] = (input && typeof input[k] === "number") ? input[k] : 0;
    });
    var fixed = fixedParams(fs);
    var m = {
        fidelity: sliderToMidi(sliders.fidelity),
        ambience: sliderToMidi(sliders.ambience),
        surround: sliderToMidi(sliders.surround),
        dynamicBoost: sliderToMidi(sliders.dynamicBoost),
        bass: sliderToMidi(sliders.bass)
    };
    var drive = tables.fidelity[m.fidelity];
    var pc = Math.trunc(float32(m.ambience) * 0.34);
    var roomsize = fixed.lex.roomsize;
    var decay = float32(Math.pow(tables.ambience[pc], roomsize));
    var lat6 = float32(decay + float32(0.15));
    if (lat6 < float32(0.25))
        lat6 = float32(0.25);
    if (lat6 > float32(0.5))
        lat6 = float32(0.5);
    var wet, dry;
    if (pc > 40) {
        wet = float32(0.21 * 1.3);
        dry = float32(0.69 * 1.3);
    }
    else {
        wet = float32((pc - 12) * (1.0 / (40 - 12)) * (0.21 * 1.3));
        dry = float32(float32(0.897) + float32(float32((40 - pc) * (1.0 / (40 - 12))) * float32(1.0 - 0.897)));
    }
    var ambienceOn = sliders.ambience !== 0 && m.ambience > 12;
    var pcBoost = Math.trunc(float32(float32(1.8) * m.dynamicBoost));
    if (pcBoost > MIDI_MAX)
        pcBoost = MIDI_MAX;
    if (sliders.dynamicBoost === 0)
        pcBoost = 0;
    pcBoost = Math.trunc(float32(float32(pcBoost) * float32(0.7)));
    var gainBoost = tables.dynamicBoost[pcBoost];
    var bass = bassTable(fixed.fs)[m.bass];
    return {
        midi: m,
        aural: { on: sliders.fidelity !== 0, drive: drive, odd: fixed.aural.odd, even: fixed.aural.even,
            gain: fixed.aural.gain, a1: fixed.aural.a1, a0: fixed.aural.a0,
            wet: fixed.aural.wet, dry: fixed.aural.dry },
        lex: { on: ambienceOn, warpedMidi: pc, decay: decay, lat6: lat6, wet: wet, dry: dry,
            roomsize: roomsize, bandwidth: fixed.lex.bandwidth,
            oneMinusBandwidth: fixed.lex.oneMinusBandwidth, damping: fixed.lex.damping,
            oneMinusDamping: fixed.lex.oneMinusDamping, lat1: fixed.lex.lat1,
            lat3: fixed.lex.lat3, lat5: fixed.lex.lat5, preDelay: fixed.lex.preDelay },
        wide: { on: sliders.surround !== 0, intensity: tables.surround[m.surround] },
        bass: { on: sliders.bass !== 0, b0: bass.b0, b1: bass.b1, b2: bass.b2, a2: bass.a2,
            boostDb: bass.boost },
        maxi: { gainBoost: gainBoost, gainBoostDb: 20 * Math.log10(gainBoost),
            releaseBeta: fixed.maxi.releaseBeta, targetLevel: fixed.maxi.targetLevel,
            maxOutput: fixed.maxi.maxOutput, maxDelay: fixed.maxi.maxDelay }
    };
}
kernel.parameters = {
    float32: float32,
    linearTable: linearTable,
    expTable: expTable,
    maxiBoostDspTable: maxiBoostDspTable,
    butterworthHighPass: butterworthHighPass,
    simpleLowpassCoeff: simpleLowpassCoeff,
    fixedParams: fixedParams,
    sliderToMidi: sliderToMidi,
    effectParams: effectParams,
    tables: tables
};
