import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { checkVideoEncoder, selectVideoEncoder, writeVideoFrame } from './video-encoder.mjs';
import { selectResolution } from './render-options.mjs';

function fakeEncoder(accepted = false) {
  const encoder = new EventEmitter();
  encoder.exitCode = null; encoder.stdin = new EventEmitter();
  encoder.stdin.destroyed = false; encoder.stdin.write = () => accepted;
  return encoder;
}

function assertNoPendingWrites(encoder) {
  assert.equal(encoder.listenerCount('close'), 0);
  for (const event of ['drain', 'error', 'close']) assert.equal(encoder.stdin.listenerCount(event), 0);
}

test('frame writes respect input backpressure and remove drain listeners', async () => {
  const encoder = fakeEncoder();
  const pending = writeVideoFrame(encoder, Buffer.from('PNG'));
  assert.equal(encoder.stdin.listenerCount('drain'), 1);
  encoder.stdin.emit('drain'); await pending;
  assertNoPendingWrites(encoder);
  await writeVideoFrame(fakeEncoder(true), Buffer.from('PNG'));
});

test('encoder or pipe closure cannot leave a frame write waiting forever', async () => {
  for (const target of ['encoder', 'pipe']) {
    const encoder = fakeEncoder(), pending = writeVideoFrame(encoder, Buffer.from('PNG'));
    (target === 'encoder' ? encoder : encoder.stdin).emit('close');
    await assert.rejects(pending, /stopped while waiting/);
    assertNoPendingWrites(encoder);
  }
});

test('pipe errors and already-stopped encoders fail without lingering listeners', async () => {
  const encoder = fakeEncoder(), pending = writeVideoFrame(encoder, Buffer.from('PNG'));
  encoder.stdin.emit('error', new Error('Broken pipe'));
  await assert.rejects(pending, /Broken pipe/); assertNoPendingWrites(encoder);
  for (const state of ['exit', 'destroyed']) {
    const stopped = fakeEncoder();
    if (state === 'exit') stopped.exitCode = 1; else stopped.stdin.destroyed = true;
    await assert.rejects(writeVideoFrame(stopped, Buffer.from('PNG')), /FFmpeg stopped/);
    assertNoPendingWrites(stopped);
  }
});

test('the default and explicit CPU modes preserve slow / CRF 18', () => {
  const cpu = { name: 'libx264', hardware: false, args: ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18'] };
  assert.deepEqual(selectVideoEncoder(), cpu);
  assert.deepEqual(selectVideoEncoder(['--encoder=libx264', '--from-frames']), cpu);
});

test('VideoToolbox and --gpu select hardware-only H.264 with an independent bitrate', () => {
  const hardware = selectVideoEncoder(['--encoder=videotoolbox']);
  assert.deepEqual(hardware, {
    name: 'h264_videotoolbox', hardware: true, bitrate: '12M',
    args: ['-c:v', 'h264_videotoolbox', '-b:v', '12M', '-allow_sw', '0', '-profile:v', 'high'],
  });
  assert.deepEqual(selectVideoEncoder(['--gpu']), hardware);
  assert.deepEqual(selectVideoEncoder(['--gpu', '--encoder=videotoolbox', '--keep-frames']), hardware);
  assert.ok(!hardware.args.includes('-crf') && !hardware.args.includes('-preset'));
});

test('custom hardware bitrates are validated and normalized for FFmpeg', () => {
  for (const [input, expected] of [['8M', '8M'], ['1.5m', '1.5M'], ['8000K', '8000k'], ['0.5M', '0.5M'], ['6000000', '6000000']]) {
    const encoder = selectVideoEncoder(['--gpu', `--bitrate=${input}`]);
    assert.equal(encoder.bitrate, expected);
    assert.equal(encoder.args[encoder.args.indexOf('-b:v') + 1], expected);
  }
});

test('4K uses a larger hardware bitrate and preflights the actual export dimensions', () => {
  const args = ['--resolution=4k', '--gpu'], resolution = selectResolution(args);
  const encoder = selectVideoEncoder(args), calls = [];
  assert.equal(encoder.bitrate, '48M');
  assert.equal(selectVideoEncoder([...args, '--bitrate=32M']).bitrate, '32M');
  assert.deepEqual(selectVideoEncoder(['--resolution=4k']).args, selectVideoEncoder().args);
  checkVideoEncoder(encoder, { ...resolution, platform: 'darwin', run: (...args) => calls.push(args) });
  assert.equal(calls.length, 1);
  assert.ok(calls[0][1].includes('color=size=3840x2160:rate=60'));
  assert.ok(calls[0][1].includes('48M'));
});

test('invalid and conflicting encoder options fail rather than being ignored', () => {
  assert.throws(() => selectVideoEncoder(['--encoder=nvenc']), /Use --encoder=libx264 or --encoder=videotoolbox/);
  assert.throws(() => selectVideoEncoder(['--gpu', '--encoder=libx264']), /cannot be combined/);
  assert.throws(() => selectVideoEncoder(['--bitrate=12M']), /only supported/);
  assert.throws(() => selectVideoEncoder(['--encoder']), /Use --encoder=VALUE/);
  assert.throws(() => selectVideoEncoder(['--encoder=']), /Use --encoder=VALUE/);
  assert.throws(() => selectVideoEncoder(['--gpu', '--bitrate']), /Use --bitrate=VALUE/);
  assert.throws(() => selectVideoEncoder(['--encoder=libx264', '--encoder=videotoolbox']), /only once/);
  assert.throws(() => selectVideoEncoder(['--gpu', '--bitrate=8M', '--bitrate=12M']), /only once/);
});

test('invalid hardware bitrates are rejected before running FFmpeg', () => {
  for (const value of ['', '0', '0M', '-1M', 'NaN', 'Infinity', '12MB', '1e9', '1 M', '0.1', '999999999999999999999M']) {
    assert.throws(() => selectVideoEncoder(['--gpu', `--bitrate=${value}`]), /Use --bitrate=VALUE|positive video bitrate/);
  }
});

test('CPU preflight only checks FFmpeg availability', () => {
  const calls = [];
  checkVideoEncoder(selectVideoEncoder(), { platform: 'linux', run: (...args) => calls.push(args) });
  assert.deepEqual(calls, [['ffmpeg', ['-version'], { stdio: 'ignore' }]]);
});

test('hardware preflight rejects non-macOS without starting FFmpeg', () => {
  for (const platform of ['linux', 'win32']) {
    assert.throws(() => checkVideoEncoder(selectVideoEncoder(['--gpu']), { platform, run: () => assert.fail('FFmpeg must not run') }), /requires macOS/);
  }
});

test('hardware preflight tests a full-size frame without a file or software fallback', () => {
  const encoder = selectVideoEncoder(['--gpu', '--bitrate=8M']);
  const calls = [];
  checkVideoEncoder(encoder, { platform: 'darwin', run: (...args) => calls.push(args) });
  assert.equal(calls.length, 1);
  const [command, args, options] = calls[0];
  assert.equal(command, 'ffmpeg');
  assert.ok(args.includes('color=size=1920x1080:rate=60'));
  assert.equal(args[args.indexOf('-frames:v') + 1], '1');
  assert.equal(args[args.indexOf('-allow_sw') + 1], '0');
  assert.equal(args[args.indexOf('-b:v') + 1], '8M');
  assert.deepEqual(args.slice(-3), ['-f', 'null', '-']);
  assert.equal(options.timeout, 15000);
  checkVideoEncoder(encoder, { fps: 30, platform: 'darwin', run: (...args) => calls.push(args) });
  assert.ok(calls[1][1].includes('color=size=1920x1080:rate=30'));
});

test('failed hardware preflight includes FFmpeg diagnostics and a CPU alternative', () => {
  const error = new Error('FFmpeg failed'); error.stderr = Buffer.from('Hardware encoder not available\n');
  assert.throws(() => checkVideoEncoder(selectVideoEncoder(['--gpu']), { platform: 'darwin', run: () => { throw error; } }), failure => {
    assert.match(failure.message, /VideoToolbox hardware encoding is unavailable/);
    assert.match(failure.message, /Hardware encoder not available/);
    assert.match(failure.message, /use libx264/);
    assert.equal(failure.cause, error);
    return true;
  });
});

test('hardware preflight also explains failures without FFmpeg stderr', () => {
  const error = new Error('spawnSync ffmpeg ENOENT');
  assert.throws(() => checkVideoEncoder(selectVideoEncoder(['--gpu']), { platform: 'darwin', run: () => { throw error; } }), /VideoToolbox hardware encoding is unavailable[\s\S]*spawnSync ffmpeg ENOENT/);
});
