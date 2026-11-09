// Self-check: node --experimental-strip-types src/services/vadGate.check.ts
import assert from 'node:assert/strict';
import { isVoiced } from './vadGate.ts';

const base = { prob: null, rms: 0.02, rmsThreshold: 0.03, sensitivity: 1, speaking: false, active: false };

assert.equal(isVoiced({ ...base, rms: 0.05 }), true, 'no Silero -> loud RMS is voice');
assert.equal(isVoiced({ ...base, rms: 0.01 }), false, 'no Silero -> quiet RMS is silence');
assert.equal(isVoiced({ ...base, prob: 0.1, rms: 0.2 }), false, 'loud keyboard, low prob -> silence');
assert.equal(isVoiced({ ...base, prob: 0.8 }), true, 'speech prob -> voice even if quiet');
assert.equal(isVoiced({ ...base, prob: 0.4 }), false, 'onset needs > 0.5');
assert.equal(isVoiced({ ...base, prob: 0.4, active: true }), true, 'sustain hysteresis at 0.35');
assert.equal(isVoiced({ ...base, prob: 0.9, speaking: true, rms: 0.01 }), false, 'quiet speaker echo never barges in');
assert.equal(isVoiced({ ...base, prob: 0.9, speaking: true, rms: 0.05 }), true, 'loud user speech barges in');
assert.equal(isVoiced({ ...base, prob: 0.3, sensitivity: 2 }), true, 'high sensitivity lowers threshold');
assert.equal(isVoiced({ ...base, prob: 0.85, sensitivity: 0.5 }), false, 'low sensitivity caps at 0.9');

console.log('vadGate: all checks passed');
