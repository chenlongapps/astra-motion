import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createEncoderFeed, createExportProgress, formatClock, formatClockTime, loadPhaseEstimates, parseEncoderLine, selectPhaseEstimates } from './render-progress.mjs';

// A frozen clock and a capturing stream keep every assertion deterministic.
function harness({ estimates = {}, phases, interactive = false, columns, interval, lineInterval } = {}) {
  const writes = [];
  let at = 0;
  const stream = { write: text => writes.push(text), isTTY: interactive, columns };
  const progress = createExportProgress({ label: '1080p60', estimates, stream, interactive, now: () => at, clock: () => new Date(2026, 0, 2, 21, 14, 7), ...(phases !== undefined && { phases }), ...(interval !== undefined && { interval }), ...(lineInterval !== undefined && { lineInterval }) });
  return { progress, writes, line: index => writes[index].replace(/^\r/, '').replace(/\n$/, ''), tick: ms => { at += ms; } };
}

const PREVIOUS = { resolution: '1080p', fps: 60, frames: 1800, encoder: 'libx264', hardware: false, source: 'browser-png', timingsSeconds: { audio: 5, browserStartup: 1, draw: 5, screenshots: 200, frameWrites: 1, encoderWait: 3, encodingWall: 230, validation: 4 } };
const CURRENT = { resolution: '1080p', fps: 60, encoder: { name: 'libx264', hardware: false }, source: 'browser-png', frames: 1800 };

test('clocks format minutes, hours, and unusable values', () => {
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(9.4), '00:09');
  assert.equal(formatClock(59.6), '01:00');
  assert.equal(formatClock(60), '01:00');
  assert.equal(formatClock(3599), '59:59');
  assert.equal(formatClock(3600), '1:00:00');
  assert.equal(formatClock(3725), '1:02:05');
  assert.equal(formatClockTime(new Date(2026, 0, 2, 21, 14, 7)), '21:14:07');
  for (const value of [NaN, Infinity, -5, undefined]) assert.equal(formatClock(value), '--:--');
});

test('a warmed capture phase reports rate, remaining, total, and finish time', () => {
  const { progress, writes, line, tick } = harness();
  progress.phase('capture', 100);
  for (let frame = 0; frame < 50; frame++) { tick(100); progress.advance(1); }
  progress.flush(true);
  const status = line(writes.length - 1);
  assert.match(status, /1080p60 capture · 50\/100 \(50\.0%\)/);
  assert.match(status, /elapsed 00:05 · 10\.00 fps/);
  assert.match(status, /remaining 00:05 · total ≈00:10 · done 21:14:12/);
});

test('the first frames of a phase report estimating instead of a bogus ETA', () => {
  const { progress, writes, line, tick } = harness();
  progress.phase('capture', 1800);
  tick(50); progress.advance(1);
  progress.flush(true);
  const status = line(writes.length - 1);
  assert.match(status, /1\/1800 \(0\.1%\) · elapsed 00:00 · estimating/);
  assert.doesNotMatch(status, /remaining/);
});

test('a finished phase reports zero remaining even before it warms up', () => {
  const { progress, writes, line, tick } = harness();
  progress.phase('capture', 4);
  for (let frame = 0; frame < 4; frame++) { tick(250); progress.advance(1); }
  progress.advance(9);
  progress.end();
  const status = line(writes.length - 1);
  assert.match(status, /4\/4 \(100\.0%\)/);
  assert.match(status, /remaining 00:00 · total ≈00:01/);
});

test('a seeded phase shows its own estimate plus the pipeline tail', () => {
  const { progress, writes, line, tick } = harness({ estimates: { audio: 5, browser: 1, capture: 200, encode: 20, validate: 4 } });
  progress.phase('audio');
  tick(2000); progress.flush(true);
  const status = line(writes.length - 1);
  assert.match(status, /audio · elapsed 00:02 · ≈00:05 · remaining 03:48 · total ≈03:50 · done 21:17:55/);
});

test('non-interactive updates stay one line per lineInterval', () => {
  const { progress, writes, tick } = harness();
  progress.phase('capture', 1000);
  const initial = writes.length;
  for (let frame = 0; frame < 40; frame++) { tick(100); progress.advance(1); }
  assert.equal(writes.length, initial);
  tick(9500); progress.advance(1);
  assert.equal(writes.length, initial + 1);
  progress.end();
  assert.equal(writes.length, initial + 2);
});

test('interactive status lines refresh in place and close before notes', () => {
  const { progress, writes, tick } = harness({ interactive: true });
  progress.phase('capture', 10);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], '\r');
  assert.doesNotMatch(writes[0], /\n/);
  tick(600); progress.advance(3);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].startsWith('\r'), true);
  progress.note('Mixed imported BGM and action effects');
  // Nothing changed since the last refresh, so closing the line is just a newline.
  assert.equal(writes[writes.length - 2], '\n');
  assert.equal(writes[writes.length - 1], 'Mixed imported BGM and action effects\n');
  progress.end();
  // The note already closed the live line, so end() adds nothing.
  assert.equal(writes.length, 4);
  assert.match(writes[1], /^\r.*/);
  assert.doesNotMatch(writes[1], /\n/);
});

test('a live line never shrinks on screen between updates', () => {
  // Widths are stable inside a phase, so padding must keep every rewrite at
  // least as wide as the line it replaces; otherwise stale characters survive.
  const { progress, writes, tick } = harness({ interactive: true, estimates: { capture: 60, validate: 4 } });
  progress.phase('capture', 100);
  for (let frame = 0; frame < 40; frame++) { tick(250); progress.advance(1); }
  const widths = writes.map(text => text.length);
  assert.deepEqual(widths, widths.map(() => Math.max(...widths)));
  assert.equal(writes.at(-1).includes('estimating'), false);
  assert.doesNotMatch(writes.at(-1), /\s+$/);
});

test('live lines stay inside the terminal width', () => {
  const { progress, writes } = harness({ interactive: true, columns: 24 });
  progress.phase('capture', 1800);
  assert.equal(writes[0][0], '\r');
  assert.equal(writes[0].length, 24);
  assert.equal(writes[0].slice(1).length, 23);
  assert.doesNotMatch(writes[0], /\n/);
});

test('notes close an unchanged live line with just a newline', () => {
  const { progress, writes } = harness();
  progress.phase('capture', 1);
  progress.advance(1);
  progress.flush(true);
  const status = writes[writes.length - 1];
  progress.note('Saved the sample frames');
  assert.equal(writes.length, 4);
  assert.equal(writes[1], status);
  assert.equal(writes[2], '\n');
  assert.equal(writes[3], 'Saved the sample frames\n');
});

test('notes close the live line and phase switches never repeat it', () => {
  const { progress, writes } = harness();
  progress.phase('audio');
  progress.note('Mixed imported BGM and action effects');
  progress.phase('browser');
  assert.equal(writes.length, 4);
  assert.match(writes[1], /\n$/);
  assert.equal(writes[2], 'Mixed imported BGM and action effects\n');
  assert.match(writes[3], /browser/);
});

test('resuming a phase from FFmpeg frame counts keeps the rate unbiased', () => {
  const { progress, writes, line, tick } = harness();
  progress.phase('encode', 1800);
  progress.set(900);
  tick(20000); progress.set(1200);
  progress.flush(true);
  const status = line(writes.length - 1);
  assert.match(status, /1200\/1800 \(66\.7%\) · elapsed 00:20 · 15\.00 fps · remaining 00:40/);
});

test('the ETA tail only counts phases the run performs', () => {
  const estimates = { audio: 5, browser: 1, capture: 60, encode: 20, validate: 4 };
  const { progress, writes, line, tick } = harness({ estimates, phases: ['browser', 'capture'] });
  progress.phase('browser');
  tick(500); progress.flush(true);
  assert.match(line(writes.length - 1), /remaining 01:01 · total ≈01:01/);
  for (let frame = 0; frame < 30; frame++) { tick(100); progress.advance(1); }
  progress.phase('capture', 60);
  for (let frame = 0; frame < 30; frame++) { tick(100); progress.advance(1); }
  progress.flush(true);
  assert.match(line(writes.length - 1), /30\/60 \(50\.0%\) · elapsed 00:03 · 10\.00 fps · remaining 00:03/);
});

test('advance never runs past the phase total', () => {
  const { progress, writes, line } = harness();
  progress.phase('capture', 2);
  progress.advance(5);
  progress.flush(true);
  assert.match(line(writes.length - 1), /2\/2 \(100\.0%\)/);
  progress.end();
});

test('encoder lines split into frame counts and forwarded diagnostics', () => {
  const frames = [], forwarded = [];
  const feed = createEncoderFeed({ onFrame: frame => frames.push(frame), forward: line => forwarded.push(line) });
  feed.push('frame=  120 fps=40 q=28.0 size=    1024kB time=00:00:02.0\n');
  feed.push('fps=0.00\nspeed=1.64e+03x\nprogress=continue\n');
  assert.deepEqual(frames, [120]);
  assert.deepEqual(forwarded, []);
  feed.push('[libx264 @ 0x1] using cpu capabilities: none!\n');
  assert.deepEqual(forwarded, ['[libx264 @ 0x1] using cpu capabilities: none!']);
  feed.push('frame=7'); feed.push('0\n');
  assert.deepEqual(frames, [120, 70]);
  assert.equal(feed.pending(), '');
  feed.push('frame=8');
  assert.equal(feed.pending(), 'frame=8');
});

test('encoder stats and diagnostics are told apart', () => {
  assert.deepEqual(parseEncoderLine('frame=  120 fps=40 q=28.0'), { frame: 120 });
  assert.deepEqual(parseEncoderLine('frame=20'), { frame: 20 });
  for (const line of ['', '   ', 'progress=end', 'fps=0.00', 'speed=1.64e+03x', 'bitrate=N/A', 'total_size=N/A', 'out_time_us=2000000', 'out_time_ms=2000000', 'out_time=00:00:02.000000', 'dup_frames=0', 'drop_frames=0', 'stream_0_0_q=-0.0', 'stream_0_1_q=-0.0']) assert.deepEqual(parseEncoderLine(line), {}, line);
  assert.deepEqual(parseEncoderLine('[libx264 @ 0x1] using cpu capabilities: none!'), { forward: '[libx264 @ 0x1] using cpu capabilities: none!' });
  assert.deepEqual(parseEncoderLine('Conversion failed!'), { forward: 'Conversion failed!' });
});

test('phase estimates follow the matching previous export', () => {
  assert.deepEqual(selectPhaseEstimates(PREVIOUS, CURRENT), { audio: 5, browser: 1, capture: 209, encode: 21, validate: 4 });
  assert.deepEqual(selectPhaseEstimates(PREVIOUS, { ...CURRENT, frames: 900 }), { audio: 5, browser: 1, capture: 104.5, encode: 10.5, validate: 4 });
  assert.deepEqual(selectPhaseEstimates({ ...PREVIOUS, source: 'cached-png' }, { ...CURRENT, source: 'cached-png' }), { audio: 5, browser: 1, capture: 209, encode: 230, validate: 4 });
  // Sample and refresh runs skip the encoder, so encoder checks must not block them.
  const samples = selectPhaseEstimates(PREVIOUS, { resolution: '1080p', fps: 60, source: 'browser-png', frames: 61 });
  assert.equal(samples.audio, 5); assert.equal(samples.validate, 4);
  assert.ok(Math.abs(samples.capture - 209 * 61 / 1800) < 1e-9);
  assert.ok(Math.abs(samples.encode - Math.max(0.5, 21 * 61 / 1800)) < 1e-9);
  assert.deepEqual(selectPhaseEstimates(null, CURRENT), {});
  assert.deepEqual(selectPhaseEstimates({}, CURRENT), {});
  assert.deepEqual(selectPhaseEstimates({ ...PREVIOUS, timingsSeconds: undefined }, CURRENT), {});
  // A previous run without a usable frame count still seeds unscaled durations.
  assert.deepEqual(selectPhaseEstimates({ ...PREVIOUS, frames: 0 }, CURRENT), { audio: 5, browser: 1, capture: 209, encode: 21, validate: 4 });
  assert.deepEqual(selectPhaseEstimates({ ...PREVIOUS, frames: 0 }, { ...CURRENT, frames: 900 }), { audio: 5, browser: 1, capture: 209, encode: 21, validate: 4 });
});

test('phase estimates ignore every mismatched previous export', () => {
  for (const previous of [
    { ...PREVIOUS, resolution: '4k' },
    { ...PREVIOUS, fps: 30 },
    { ...PREVIOUS, encoder: 'h264_videotoolbox' },
    { ...PREVIOUS, hardware: true },
    { ...PREVIOUS, source: 'cached-png' },
  ]) assert.deepEqual(selectPhaseEstimates(previous, CURRENT), {});
  for (const current of [
    { ...CURRENT, resolution: '4k' },
    { ...CURRENT, fps: 30 },
    { ...CURRENT, encoder: { name: 'h264_videotoolbox', hardware: true } },
    { ...CURRENT, encoder: { name: 'libx264', hardware: true } },
    { ...CURRENT, source: 'cached-png' },
  ]) assert.deepEqual(selectPhaseEstimates(PREVIOUS, current), {});
});

test('phase estimates load from disk and survive missing or broken files', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'astra-progress-estimates-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'ffprobe.json');
  await writeFile(file, JSON.stringify({ render: PREVIOUS }));
  assert.deepEqual(await loadPhaseEstimates(file, CURRENT), { audio: 5, browser: 1, capture: 209, encode: 21, validate: 4 });
  assert.deepEqual(await loadPhaseEstimates(path.join(directory, 'missing.json'), CURRENT), {});
  await writeFile(file, 'not json');
  assert.deepEqual(await loadPhaseEstimates(file, CURRENT), {});
});
