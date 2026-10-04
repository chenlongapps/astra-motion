import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frameTiming, sampleTrack, sampleValue } from '../src/frame-timing.js';
import { configFor } from '../src/browser-export.js';
import referenceMotion from '../src/reference-motion.json' with { type: 'json' };
import referenceCamera from '../src/reference-camera.json' with { type: 'json' };
import { cameraAt, referenceCameraAt } from '../src/timeline.js';

test('both output rates cover exactly 30 seconds and invalid rates fail', () => {
  assert.deepEqual(frameTiming(), { fps: 60, frames: 1800, duration: 30 });
  assert.deepEqual(frameTiming(30), { fps: 30, frames: 900, duration: 30 });
  for (const fps of [0, 24, 59.94, 120, NaN, Infinity, '60', null]) assert.throws(() => frameTiming(fps), /30.*60/);
});

test('calibrated half-frame poses interpolate positions and take the short angular path', () => {
  const track = [[0, 4, Math.PI - 0.1], [10, 8, -Math.PI + 0.1]];
  const midpoint = sampleTrack(track, 0.5, 2);
  assert.deepEqual(midpoint.slice(0, 2), [5, 6]);
  assert.ok(Math.abs(midpoint[2] - Math.PI) < 1e-12);
  assert.deepEqual(sampleTrack(track, 0, 2), track[0]);
  assert.deepEqual(sampleTrack(track, 1.5, 2), track[1]);
  assert.deepEqual(sampleTrack(track, -1, 2), track[0]);
  assert.equal(sampleValue([50, 75, 82], 0.5), 62.5);
  assert.equal(sampleValue([50, 75, 82], 2.5), 82);
});

test('every 60 fps calibration sample is finite, including the last half-frame', () => {
  for (const values of [referenceMotion, referenceCamera]) {
    assert.equal(values.length, 900);
    for (let i = 0; i < 900; i++) assert.deepEqual(sampleTrack(values, i), values[i]);
  }
  for (let i = 0; i < 1800; i++) {
    assert.ok(sampleTrack(referenceMotion, i / 2, 4).every(Number.isFinite), `Invalid motion sample ${i}`);
    assert.ok(Object.values(referenceCameraAt(i / 2)).every(Number.isFinite), `Invalid camera sample ${i}`);
  }
  assert.deepEqual(sampleTrack(referenceCamera, 737.5), referenceCamera[737]);
  assert.equal(sampleTrack(referenceCamera, 738), null);
  assert.deepEqual(referenceCameraAt(738), cameraAt(738));
});

test('H.264 levels support the macroblock rate of each resolution and frame rate', () => {
  // AVC levels 4.0, 4.2, 5.1, 5.2: maximum macroblocks per second.
  const limits = { 40: 245760, 42: 522240, 51: 983040, 52: 2073600 };
  for (const resolution of ['1080p', '4k']) for (const fps of [30, 60]) {
    const config = configFor(resolution, fps), level = parseInt(config.codec.slice(-2), 16);
    assert.ok(Math.ceil(config.width / 16) * Math.ceil(config.height / 16) * fps <= limits[level]);
    assert.equal(config.framerate, fps);
  }
  assert.throws(() => configFor('8k', 60), /1080p/);
  assert.throws(() => configFor('1080p', 24), /30.*60/);
});
