import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import timing from '../src/timing.json' with { type: 'json' };
import { compose } from './audio/score.mjs';
import { SAMPLE_RATE, synthesize, renderSoundtrack } from './audio/synth.mjs';
import { generateAudio } from './generate-audio.mjs';

test('New acoustic voices render audible, repeatable samples with quiet endpoints', () => {
  for (const kind of ['piano', 'pizz', 'flute', 'woodblock', 'brush']) for (const note of [55, 74, 84]) {
    const event = { kind, note, duration: 0.35, seed: 1234 };
    const signal = synthesize(event);
    assert.deepEqual(signal, synthesize(event), `${kind} at ${note} is not deterministic`);
    let peak = 0, sum = 0;
    for (const sample of signal) {
      assert.ok(Number.isFinite(sample), `${kind} at ${note} has a non-finite sample`);
      peak = Math.max(peak, Math.abs(sample)); sum += sample;
    }
    assert.ok(peak > 0.04 && peak < 2, `${kind} at ${note} is silent or excessively loud`);
    assert.ok(Math.abs(sum / signal.length) < 0.01, `${kind} at ${note} has a DC offset`);
    assert.equal(Math.abs(signal[0]), 0);
    assert.ok(Math.abs(signal.at(-1)) < 0.00001, `${kind} at ${note} ends abruptly`);
  }
});

test('The dance downbeat follows the shared cue when its frame changes', () => {
  const shifted = { ...timing, cues: { ...timing.cues, beatDance: timing.cues.beatDance + 6 } };
  for (const current of [timing, shifted]) {
    const score = compose(current), start = current.cues.beatDance / current.fps;
    assert.ok(score.music.some(e => e.kind === 'kick' && e.time === start));
    assert.ok(score.music.some(e => e.kind === 'bass' && e.time === start));
    assert.ok(score.groups.every(group => group.frame === current.cues[group.cue]));
  }
});

test('The comic pause leaves space between calming down and the zoom pickup', () => {
  const score = compose(timing);
  const start = timing.cues.calm / timing.fps, end = timing.cues.zoom / timing.fps;
  assert.ok(!score.music.some(e => e.time >= start && e.time < end));
  assert.ok(score.music.filter(e => e.time < start).every(e => e.time + e.duration <= start + 1e-9));
  assert.ok(score.music.some(e => e.time >= end && e.time < timing.cues.beatDance / timing.fps));
  assert.deepEqual(score, compose(timing));
});

test('A musical pause silences the room tail while keeping action effects audible', () => {
  const score = {
    music: [{ kind: 'pad', time: 0, duration: 2.5, note: 60, gain: 0.1, seed: 7 }],
    effects: [{ kind: 'pop', time: 1, duration: 0.14, note: 72, gain: 0.1, seed: 9 }],
    groups: [], musicPauses: [{ start: 0.8, end: 1.3, depth: 1 }],
  };
  const { mix, music, effects } = renderSoundtrack(score, { frames: 75, fps: 30 });
  const silentAt = Math.round(0.9 * SAMPLE_RATE), effectAt = Math.round(1.02 * SAMPLE_RATE);
  for (let c = 0; c < 2; c++) {
    assert.ok(Math.abs(music[c][silentAt]) > 0.001, 'The source music should still contain a room tail');
    assert.equal(mix[c][silentAt], 0);
    assert.equal(mix[c][effectAt], effects[c][effectAt]);
    assert.ok(Math.abs(mix[c][effectAt]) > 0.001, 'The action effect was silenced along with the music');
  }
});

test('Imported BGM replaces synthesis without adding a room or procedural pauses', () => {
  const length = SAMPLE_RATE * 2;
  const background = [247, 311].map(hz => Float32Array.from({ length }, (_, i) => Math.sin(2 * Math.PI * hz * i / SAMPLE_RATE) * 0.1));
  const original = background.map(channel => channel.slice());
  const score = {
    music: [{ kind: 'must-not-be-synthesized', time: 0, duration: 2, gain: 0.1 }],
    effects: [], groups: [], musicPauses: [{ start: 0.8, end: 1.3, depth: 1 }],
  };
  const { mix, music } = renderSoundtrack(score, { frames: 60, fps: 30 }, { background });
  const at = Math.round(1.02 * SAMPLE_RATE);
  assert.deepEqual(background, original, 'Importing music modified the input recording');
  assert.deepEqual(music, original, 'Extra synthetic room reflections were added to the recording');
  for (let c = 0; c < 2; c++) {
    assert.ok(Math.abs(mix[c][at]) > 0.01);
    assert.equal(mix[c][at], background[c][at], 'A procedural pause altered the supplied recording');
    assert.equal(Math.abs(mix[c][0]), 0);
    assert.ok(Math.abs(mix[c].at(-1)) < 0.00001);
  }
});

test('Imported BGM must have exactly two channels and match the animation length', () => {
  const score = { music: [], effects: [], groups: [] }, current = { frames: 1, fps: 30 };
  const channel = new Float32Array(SAMPLE_RATE / 30);
  for (const background of [null, [channel], [channel, channel, channel], [channel, channel.subarray(1)]]) {
    assert.throws(() => renderSoundtrack(score, current, { background }), /background samples per stereo channel/);
  }
});

test('A missing BGM fails without replacing the soundtrack or switching to synthesis', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'astra-audio-source-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'generated.wav'), reportFile = path.join(directory, 'report.json');
  await writeFile(file, 'existing soundtrack'); await writeFile(reportFile, 'existing report');
  await assert.rejects(generateAudio({ file, reportFile, sourceFile: path.join(directory, 'missing.m4a') }), { code: 'ENOENT' });
  assert.equal(await readFile(file, 'utf8'), 'existing soundtrack');
  assert.equal(await readFile(reportFile, 'utf8'), 'existing report');
  assert.deepEqual((await readdir(directory)).sort(), ['generated.wav', 'report.json']);
});
