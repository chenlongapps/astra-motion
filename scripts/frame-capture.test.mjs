import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFrameCapture, selectCaptureMode } from './frame-capture.mjs';

test('fast PNG is the default, with an explicit standard fallback', () => {
  assert.equal(selectCaptureMode(), 'fast');
  assert.equal(selectCaptureMode(['--capture=standard', '--resolution=4k']), 'standard');
  for (const args of [['--capture'], ['--capture='], ['--capture=jpeg'], ['--capture=fast', '--capture=standard']]) assert.throws(() => selectCaptureMode(args), /--capture/);
});

test('both capture modes use the full native viewport through the existing CDP connection', async () => {
  for (const mode of ['fast', 'standard']) {
    const calls = [], png = Buffer.from('PNG bytes');
    const page = { async screenshot(options) { calls.push(options); return png; } };
    const capture = await createFrameCapture(page, { width: 3840, height: 2160 }, mode);
    assert.deepEqual(await capture.capture(), png); await capture.capture();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], { optimizeForSpeed: mode === 'fast', clip: { x: 0, y: 0, width: 3840, height: 2160, scale: 1 } });
    await capture.close();
  }
});

test('capture failures are surfaced without silently changing modes', async () => {
  const error = new Error('Chromium capture failed');
  const page = { async screenshot() { throw error; } };
  const capture = await createFrameCapture(page, { width: 1920, height: 1080 });
  await assert.rejects(capture.capture(), failure => failure === error);
  await assert.rejects(createFrameCapture(page, { width: 1920, height: 1080 }, 'jpeg'), /Unsupported/);
});
