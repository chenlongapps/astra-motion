import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, mkdtemp, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openRenderer, output } from './browser.mjs';
import { selectFrameRate, selectResolution } from './render-options.mjs';
import { createFrameCapture, pngPixels } from './frame-capture.mjs';
import { BASE_FPS, frameTiming } from '../src/frame-timing.js';

// This is a browser smoke/integration check, using the same Chromium launcher
// as the video exporter. No golden images are needed for artistic revisions.
const { fps, frames: frameCount } = frameTiming(selectFrameRate(process.argv.slice(2))), lastFrame = frameCount - 1;
const sceneFrame = f => f === 899 ? lastFrame : f * fps / BASE_FPS;
const clockTolerance = Math.ceil(fps / 15);
const report = { startedAt: new Date().toISOString(), passed: false, fps, frameCount, checks: [], failures: [], browserErrors: [], resourceFailures: [], mediaRequestCancellations: [], consoleErrors: [], screenshots: {} };
const artifactDir = path.join(output, 'screenshots', `${fps}fps`);
await mkdir(artifactDir, { recursive: true });
let runtime;

async function check(name, fn) {
  const started = performance.now();
  try {
    const details = await fn();
    report.checks.push({ name, passed: true, durationMs: Math.round(performance.now() - started), ...(details === undefined ? {} : { details }) });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.checks.push({ name, passed: false, durationMs: Math.round(performance.now() - started), error: error.message });
    report.failures.push({ name, error: error.stack || String(error) });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

function observe(page) {
  const requests = new Map();
  page.on('Runtime.exceptionThrown', ({ exceptionDetails }) => report.browserErrors.push(exceptionDetails.exception?.description ?? exceptionDetails.text));
  page.on('Runtime.consoleAPICalled', ({ type, args }) => { if (type === 'error') report.consoleErrors.push(args.map(arg => arg.value ?? arg.description).join(' ')); });
  page.on('Network.requestWillBeSent', ({ requestId, request }) => { if (request.url.startsWith('http:')) requests.set(requestId, request.url); });
  page.on('Network.loadingFailed', ({ requestId, errorText, type }) => {
    const failure = { url: requests.get(requestId), error: errorText };
    // Chromium cancels outstanding byte-range media requests when seeking or
    // closing a page. Track these separately from actual asset load failures;
    // playback, audio readiness, and audio.error are verified independently.
    if (type === 'Media' && failure.error === 'net::ERR_ABORTED') report.mediaRequestCancellations.push(failure);
    else report.resourceFailures.push(failure);
  });
  page.on('Network.responseReceived', ({ response }) => { if (response.status >= 400) report.resourceFailures.push({ url: response.url, status: response.status }); });
}

const getState = page => page.evaluate(() => {
  const audio = document.querySelector('#soundtrack');
  return { frame: window.animation.frame, playing: window.animation.playing, audioTime: audio.currentTime, audioPaused: audio.paused, audioEnded: audio.ended, muted: audio.muted, label: document.querySelector('#play').getAttribute('aria-label'), time: document.querySelector('#time').value, seek: Number(document.querySelector('#seek').value) };
});

async function frameHash(page, frame) {
  return page.evaluate(async f => {
    if (f !== null) window.renderFrame(f);
    const canvas = document.querySelector('#film');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const digest = await crypto.subtle.digest('SHA-256', pixels);
    return { frame: window.animation.frame, hash: [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('') };
  }, frame ?? null);
}

async function seekWithControl(page, frame) {
  await page.evaluate(value => {
    const control = document.querySelector('#seek'); control.value = String(value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }, frame);
}

async function waitForReady(page) {
  await page.evaluate(() => window.animationReady);
  await page.waitForFunction(() => document.querySelector('#soundtrack').readyState >= HTMLMediaElement.HAVE_FUTURE_DATA);
}

async function pressKey(page, key, modifiers = 0) {
  const code = { Enter: 13, Escape: 27, Tab: 9, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35 }[key];
  const params = { key, code: key, windowsVirtualKeyCode: code, modifiers };
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params, ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
}

async function openExportDialog(page) {
  await page.evaluate(() => document.querySelector('#export').click());
  await page.waitForFunction(() => document.querySelector('#export-dialog').open);
}

async function dialogLayout(page, viewport, filename) {
  await page.setViewportSize(viewport);
  const metrics = await page.evaluate(() => {
    const dialog = document.querySelector('#export-dialog'), body = dialog.querySelector('.export-body');
    const box = dialog.getBoundingClientRect(), preview = dialog.querySelector('.export-preview-panel').getBoundingClientRect(), settings = dialog.querySelector('.export-settings').getBoundingClientRect();
    const actions = [...dialog.querySelectorAll('.export-actions button')].filter(node => node.getClientRects().length);
    return {
      state: dialog.dataset.state, modal: dialog.matches(':modal'),
      viewport: { width: innerWidth, height: innerHeight },
      dialog: { x: box.x, y: box.y, right: box.right, bottom: box.bottom },
      body: { clientHeight: body.clientHeight, scrollHeight: body.scrollHeight },
      twoColumns: preview.right <= settings.x, stacked: settings.y >= preview.bottom,
      overflow: document.documentElement.scrollWidth > innerWidth || dialog.scrollWidth > dialog.clientWidth || body.scrollWidth > body.clientWidth,
      actionsVisible: actions.length > 0 && actions.every(node => { const b = node.getBoundingClientRect(); return b.x >= 0 && b.right <= innerWidth && b.y >= 0 && b.bottom <= innerHeight; }),
    };
  });
  assert.ok(metrics.modal, 'Export window is not modal');
  assert.ok(metrics.dialog.x >= 0 && metrics.dialog.right <= viewport.width && metrics.dialog.y >= 0 && metrics.dialog.bottom <= viewport.height, 'Export window extends outside the viewport');
  assert.equal(metrics.overflow, false, 'Export window has horizontal overflow');
  assert.ok(metrics.actionsVisible, 'Export actions are outside the viewport');
  assert.ok(viewport.width > 650 ? metrics.twoColumns : metrics.stacked, 'Export preview and settings use the wrong layout');
  if (viewport.height <= 480) assert.ok(metrics.body.scrollHeight > metrics.body.clientHeight, 'Short export window should scroll internally');
  const target = path.join(artifactDir, filename);
  await page.screenshot({ path: target });
  report.screenshots[filename.replace('.png', '')] = path.relative(output, target);
  return metrics;
}

async function layout(page, viewport, filename) {
  await page.setViewportSize(viewport);
  await page.evaluate(() => { window.animation.pause(); window.animation.seek(420); });
  const metrics = await page.evaluate(() => {
    const canvas = document.querySelector('#film'), box = canvas.getBoundingClientRect();
    const controls = document.querySelector('.controls').getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      canvas: { x: box.x, y: box.y, width: box.width, height: box.height, nativeWidth: canvas.width, nativeHeight: canvas.height },
      controls: { x: controls.x, y: controls.y, right: controls.right, bottom: controls.bottom },
      controlsVisible: [...document.querySelectorAll('.controls button, .controls input')].every(node => { const b = node.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.x >= 0 && b.right <= innerWidth; }),
      export: (() => { const b = document.querySelector('#export').getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; })(),
      headingRight: document.querySelector('.heading').getBoundingClientRect().right,
      dialogClosed: !document.querySelector('#export-dialog').open,
    };
  });
  assert.equal(metrics.documentWidth, viewport.width, 'Page has horizontal overflow');
  assert.equal(metrics.canvas.nativeWidth, 1920);
  assert.equal(metrics.canvas.nativeHeight, 1080);
  assert.ok(Math.abs(metrics.canvas.width / metrics.canvas.height - 16 / 9) < 0.01, 'Canvas must preserve its 16:9 aspect ratio');
  assert.ok(metrics.canvas.x >= 0 && metrics.canvas.x + metrics.canvas.width <= viewport.width + 1, 'Canvas extends outside viewport');
  assert.ok(metrics.controls.y >= metrics.canvas.y + metrics.canvas.height, 'Controls overlap the animation');
  assert.ok(metrics.controlsVisible, 'Some controls extend outside the viewport');
  assert.ok(metrics.dialogClosed, 'Export window should be closed');
  assert.ok(metrics.export.width > 0 && metrics.export.height > 0 && metrics.export.x >= 0 && metrics.export.right <= viewport.width, 'Export entry extends outside the viewport');
  assert.ok(metrics.export.bottom <= metrics.canvas.y, 'Export entry should be above the animation');
  assert.ok(Math.abs(metrics.export.right - metrics.headingRight) < 1, 'Export entry should be at the right edge of the heading');
  const target = path.join(artifactDir, filename);
  await page.screenshot({ path: target, fullPage: true });
  report.screenshots[filename.replace('.png', '')] = path.relative(output, target);
  return metrics;
}

try {
  runtime = await openRenderer({ render: false, fps, width: 1440, height: 1000 });
  const { page } = runtime;
  page.setDefaultTimeout(15000);
  observe(page);
  // Attach asset observers before a fresh navigation so initial font/audio
  // responses, as well as runtime failures, are included in the report.
  await page.goto(`${runtime.url}?fps=${fps}`);
  await waitForReady(page);

  await check('Web export enables supported resolutions without loading its AAC resource', async () => {
    await page.evaluate(() => window.exportReady);
    const state = await page.evaluate(() => ({ resolution: document.querySelector('#resolution button[aria-pressed="true"]').value, exportDisabled: document.querySelector('#export').disabled, startDisabled: document.querySelector('#export-start').disabled, downloadDisabled: document.querySelector('#download').disabled, dialogClosed: !document.querySelector('#export-dialog').open, busy: document.querySelector('#export-dialog').getAttribute('aria-busy'), audioLoaded: performance.getEntriesByType('resource').some(entry => entry.name.endsWith('generated.m4a')) }));
    assert.deepEqual(state, { resolution: '1080p', exportDisabled: false, startDisabled: false, downloadDisabled: true, dialogClosed: true, busy: 'false', audioLoaded: false });
    return state;
  });

  await check('Player frame bounds, cue times and keyboard stepping follow the selected frame rate', async () => {
    const results = [], probe = await runtime.browser.newPage();
    try {
      for (const rate of [30, 60]) {
        await probe.goto(`${runtime.url}?fps=${rate}`); await probe.evaluate(() => window.animationReady);
        const metadata = await probe.evaluate(() => ({ fps: window.animation.fps, frames: window.animation.frames, duration: window.animation.duration, cut: window.animation.cues.cut, max: Number(document.querySelector('#seek').max) }));
        assert.deepEqual(metadata, { fps: rate, frames: rate * 30, duration: 30, cut: rate * 5, max: rate * 30 - 1 });
        await probe.evaluate(() => { window.animation.seek(window.animation.fps * 15); document.activeElement.blur(); });
        await pressKey(probe, 'ArrowRight');
        assert.equal((await getState(probe)).frame, rate * 15 + 1);
        await pressKey(probe, 'ArrowLeft', 8);
        const stepped = await getState(probe);
        assert.equal(stepped.frame, rate * 14 + 1);
        assert.ok(Math.abs(stepped.audioTime - (14 + 1 / rate)) < 0.001);
        await seekWithControl(probe, rate * 30 - 1);
        assert.equal((await getState(probe)).label, '重播');
        results.push(metadata);
      }
      await probe.goto(runtime.url); await probe.evaluate(() => window.animationReady);
      assert.equal(await probe.evaluate(() => window.animation.fps), 60);
      for (const query of ['?fps=24', '?fps=', '?fps=30&fps=60']) {
        await probe.goto(`${runtime.url}${query}`);
        const error = await probe.evaluate(() => window.animationReady.then(() => null, error => error.message));
        assert.match(error, /帧率/);
        assert.equal(await probe.evaluate(() => document.querySelector('#play').disabled && !window.animation.ready), true);
      }
      return results;
    } finally { await probe.close(); }
  });

  await check('60 fps samples match 30 fps at shared times and render deterministic moving half-frames', async () => {
    const result = await page.evaluate(async () => {
      const { Renderer } = await import('/src/renderer.js');
      const low = new Renderer(document.createElement('canvas'), 1, 30), high = new Renderer(document.createElement('canvas'), 1, 60);
      const hash = async (renderer, frame) => {
        renderer.renderFrame(frame);
        const data = renderer.c.getImageData(0, 0, renderer.canvas.width, renderer.canvas.height).data;
        return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].join(',');
      };
      const frames = [0, 17, 60, 131, 132, 150, 151, 167, 168, 285, 303, 415, 442, 449, 520, 521, 569, 570, 571, 591, 604, 690, 737, 738, 751, 755, 767, 770, 780, 783, 795, 801, 812, 815, 825, 826, 842, 843, 898, 899];
      const samples = [], drawTimes = [];
      try {
        for (const frame of frames) {
          const original = await hash(low, frame), even = await hash(high, frame * 2), odd = await hash(high, frame * 2 + 1);
          high.renderFrame(0);
          const repeated = await hash(high, frame * 2 + 1);
          const start = performance.now(); high.renderFrame(frame * 2 + 1); drawTimes.push(performance.now() - start);
          samples.push({ frame, sharedPixels: original === even, middleMoves: odd !== even, deterministic: odd === repeated });
        }
        return { samples, meanDrawMs: drawTimes.reduce((a, b) => a + b, 0) / drawTimes.length, maximumDrawMs: Math.max(...drawTimes) };
      } finally {
        for (const renderer of [low, high]) { renderer.canvas.width = renderer.canvas.height = 1; renderer.texture.width = renderer.texture.height = 1; }
      }
    });
    for (const sample of result.samples) {
      assert.ok(sample.sharedPixels, `30/60 fps differ at source frame ${sample.frame}`);
      assert.ok(sample.middleMoves, `60 fps repeated source frame ${sample.frame}`);
      assert.ok(sample.deterministic, `Half-frame ${sample.frame + 0.5} depends on drawing history`);
    }
    for (const sourceFrame of [150.5, 442.5, 780.5, 826.5, 899.5]) {
      const frame = Math.min(lastFrame, Math.floor(sourceFrame * fps / BASE_FPS));
      await seekWithControl(page, frame);
      await page.screenshot({ path: path.join(artifactDir, `interpolated-${frame}.png`) });
    }
    return result;
  });

  await check('Export capability and keyboard selection distinguish 4K30 from unsupported 4K60', async () => {
    const limited = await runtime.browser.newPage();
    try {
      await limited.send('Page.addScriptToEvaluateOnNewDocument', { source: 'const nativeSupport = VideoEncoder.isConfigSupported.bind(VideoEncoder); VideoEncoder.isConfigSupported = async config => config.width === 3840 && config.framerate === 60 ? { supported: false, config } : nativeSupport(config);' });
      await limited.goto(runtime.url); await limited.evaluate(() => window.exportReady);
      await openExportDialog(limited);
      await limited.evaluate(() => document.querySelector('#resolution-4k').click());
      const state = await limited.evaluate(() => ({ resolution: document.querySelector('#resolution button[aria-pressed="true"]').value, fps: document.querySelector('#export-fps button[aria-pressed="true"]').value, unavailable: document.querySelector('#fps-60').disabled, startEnabled: !document.querySelector('#export-start').disabled, filename: document.querySelector('#export-filename').textContent }));
      assert.deepEqual(state, { resolution: '4k', fps: '30', unavailable: true, startEnabled: true, filename: 'astra-motion-4k-30fps.mp4' });
      await limited.evaluate(() => { document.querySelector('#fps-60').dispatchEvent(new Event('click')); document.querySelector('#fps-30').focus(); });
      await pressKey(limited, 'ArrowRight');
      assert.equal(await limited.evaluate(() => document.querySelector('#export-frame-rate').textContent), '30 fps');
      await limited.evaluate(() => document.querySelector('#resolution-1080p').click());
      await pressKey(limited, 'End');
      assert.equal(await limited.evaluate(() => document.querySelector('#export-frame-rate').textContent), '60 fps');
      return state;
    } finally { await limited.close(); }
  });

  await check('Browser exports submit contiguous microsecond timestamps at both frame rates and cancel cleanly', async () => {
    const probe = await runtime.browser.newPage(), results = [];
    try {
      await probe.goto(runtime.url); await probe.evaluate(() => window.exportReady);
      for (const rate of [30, 60]) {
        await probe.evaluate(async fps => {
          const { exportVideo } = await import('/src/browser-export.js');
          const NativeEncoder = VideoEncoder;
          window.timingSamples = [];
          window.VideoEncoder = class extends EventTarget {
            static async isConfigSupported(config) { return { supported: true, config }; }
            constructor() { super(); this.state = 'unconfigured'; this.encodeQueueSize = 0; }
            configure(config) { this.state = 'configured'; window.timingConfig = config; }
            encode(frame, options) { window.timingSamples.push({ timestamp: frame.timestamp, duration: frame.duration, key: options.keyFrame }); this.encodeQueueSize++; }
            close() { this.state = 'closed'; }
          };
          window.timingAbort = new AbortController();
          window.timingExport = exportVideo({ fps, signal: window.timingAbort.signal, onProgress: progress => { window.timingProgress = progress; } }).then(() => 'unexpected success', error => error.name).finally(() => { window.VideoEncoder = NativeEncoder; });
        }, rate);
        await probe.waitForFunction(() => window.timingSamples.length === 3);
        const state = await probe.evaluate(() => ({ samples: window.timingSamples, fps: window.timingConfig.framerate, total: window.timingProgress.total }));
        assert.equal(state.fps, rate); assert.equal(state.total, rate * 30);
        for (const [i, sample] of state.samples.entries()) {
          assert.equal(sample.timestamp, Math.round(i * 1e6 / rate));
          assert.equal(sample.duration, Math.round((i + 1) * 1e6 / rate) - sample.timestamp);
          assert.equal(sample.key, i === 0);
        }
        assert.equal(await probe.evaluate(() => { window.timingAbort.abort(); return window.timingExport; }), 'AbortError');
        results.push(state);
      }
      assert.deepEqual(probe.errors, []);
      return results;
    } finally { await probe.close(); }
  });

  await check('Export dialog pauses at the current frame, traps keyboard focus, and returns it on close', async () => {
    await page.evaluate(async () => { window.animation.seek(321); await window.animation.play(); });
    await page.waitForFunction(() => window.animation.playing);
    await page.evaluate(() => document.querySelector('#export').focus());
    await pressKey(page, 'Enter');
    await page.waitForFunction(() => document.querySelector('#export-dialog').open);
    const opened = await page.evaluate(() => {
      const preview = document.querySelector('#export-preview'), copy = document.createElement('canvas');
      copy.width = preview.width; copy.height = preview.height; copy.getContext('2d').drawImage(document.querySelector('#film'), 0, 0, copy.width, copy.height);
      const expected = copy.getContext('2d').getImageData(0, 0, copy.width, copy.height).data, actual = preview.getContext('2d').getImageData(0, 0, preview.width, preview.height).data;
      return { frame: window.animation.frame, playing: window.animation.playing, paused: document.querySelector('#soundtrack').paused, modal: document.querySelector('#export-dialog').matches(':modal'), focused: document.activeElement.id, snapshotMatches: actual.every((value, i) => value === expected[i]), filename: document.querySelector('#export-filename').textContent };
    });
    assert.ok(opened.modal && opened.paused && opened.snapshotMatches, JSON.stringify(opened)); assert.equal(opened.playing, false);
    assert.equal(opened.focused, 'resolution-1080p'); assert.equal(opened.filename, 'astra-motion-1080p-60fps.mp4');
    await page.evaluate(() => document.querySelector('#export-start').focus());
    await pressKey(page, 'Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'export-close');
    await pressKey(page, 'Tab', 8);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'export-start');
    await page.evaluate(async () => { await window.animation.play(); window.animation.seek(789); document.querySelector('#export-dialog').dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true })); });
    assert.equal((await getState(page)).frame, opened.frame);
    assert.equal((await getState(page)).playing, false);
    await pressKey(page, 'Escape');
    await page.waitForFunction(() => !document.querySelector('#export-dialog').open && document.activeElement.id === 'export');
    await openExportDialog(page);
    await page.evaluate(() => document.querySelector('#export-close').click());
    await page.waitForFunction(() => !document.querySelector('#export-dialog').open && document.activeElement.id === 'export');
    assert.equal((await getState(page)).frame, opened.frame);
    return { ...opened, keyboardFocusContained: true, escapeAndCloseRestoreFocus: true, reopenPreservesFrame: true };
  });

  await check('Unsupported WebCodecs leaves normal playback ready with an actionable export message', async () => {
    const unsupported = await runtime.browser.newPage();
    try {
      await unsupported.send('Page.addScriptToEvaluateOnNewDocument', { source: 'Object.defineProperty(window, "VideoEncoder", { value: undefined, configurable: true });' });
      await unsupported.goto(runtime.url);
      await unsupported.evaluate(() => window.exportReady);
      await openExportDialog(unsupported);
      const state = await unsupported.evaluate(() => ({ ready: window.animation.ready, playEnabled: !document.querySelector('#play').disabled, entryEnabled: !document.querySelector('#export').disabled, startDisabled: document.querySelector('#export-start').disabled, resolutionDisabled: [...document.querySelectorAll('#resolution button')].every(button => button.disabled), focused: document.activeElement.id, message: document.querySelector('#export-status').textContent }));
      assert.ok(state.ready && state.playEnabled && state.entryEnabled && state.startDisabled && state.resolutionDisabled);
      assert.equal(state.focused, 'export-close');
      assert.match(state.message, /Chrome|Edge/);
      assert.equal(unsupported.errors.length, 0);
      return state;
    } finally { await unsupported.close(); }
  });

  await check('Unsupported 4K is explicitly labelled while 1080p export remains available', async () => {
    const limited = await runtime.browser.newPage();
    try {
      await limited.send('Page.addScriptToEvaluateOnNewDocument', { source: 'const nativeSupport = VideoEncoder.isConfigSupported.bind(VideoEncoder); VideoEncoder.isConfigSupported = async config => config.width === 3840 ? { supported: false, config } : nativeSupport(config);' });
      await limited.goto(runtime.url); await limited.evaluate(() => window.exportReady);
      await openExportDialog(limited);
      await limited.evaluate(() => document.querySelector('#resolution-4k').dispatchEvent(new Event('click')));
      await pressKey(limited, 'ArrowRight');
      const state = await limited.evaluate(() => ({ exportEnabled: !document.querySelector('#export-start').disabled, resolution: document.querySelector('#resolution button[aria-pressed="true"]').value, disabled: document.querySelector('#resolution-4k').disabled, label: document.querySelector('#resolution-4k').textContent, focused: document.activeElement.id }));
      assert.ok(state.exportEnabled && state.disabled); assert.equal(state.resolution, '1080p'); assert.match(state.label, /设备不支持/);
      assert.equal(state.focused, 'resolution-1080p');
      return state;
    } finally { await limited.close(); }
  });

  await check('Missing AAC and encoder errors restore controls and preserve the preview position', async () => {
    const fault = await runtime.browser.newPage();
    try {
      await fault.goto(runtime.url); await fault.evaluate(() => window.exportReady);
      await fault.send('Network.setBlockedURLs', { urls: ['*generated.m4a'] });
      await fault.evaluate(() => window.animation.seek(321));
      await openExportDialog(fault);
      await fault.evaluate(() => document.querySelector('#export-start').click());
      await fault.waitForFunction(() => !document.querySelector('#export-error').hidden && document.querySelector('#export-dialog').getAttribute('aria-busy') === 'false');
      assert.equal(await fault.evaluate(() => window.animation.frame), 321);
      await fault.send('Network.setBlockedURLs', { urls: [] });
      await fault.evaluate(() => {
        const NativeEncoder = VideoEncoder;
        window.nativeEncoder = NativeEncoder;
        window.VideoEncoder = class extends NativeEncoder {
          constructor(init) { super(init); this.failEncoding = () => init.error(new Error('simulated encoding failure')); }
          encode() { queueMicrotask(this.failEncoding); }
        };
        document.querySelector('#export-start').click();
      });
      await fault.waitForFunction(() => !document.querySelector('#export-error').hidden && document.querySelector('#export-dialog').getAttribute('aria-busy') === 'false');
      const state = await fault.evaluate(() => ({ frame: window.animation.frame, playEnabled: !document.querySelector('#play').disabled, seekEnabled: !document.querySelector('#seek').disabled, exportEnabled: !document.querySelector('#export-start').disabled, closeEnabled: !document.querySelector('#export-close').disabled, settingsEnabled: !document.querySelector('#resolution button[aria-pressed="true"]').disabled, downloadDisabled: document.querySelector('#download').disabled, focused: document.activeElement.id, state: document.querySelector('#export-dialog').dataset.state, error: document.querySelector('#export-error').textContent }));
      assert.equal(state.frame, 321); assert.ok(state.playEnabled && state.seekEnabled && state.exportEnabled && state.closeEnabled && state.settingsEnabled && state.downloadDisabled);
      assert.equal(state.focused, 'export-start'); assert.equal(state.state, 'settings');
      assert.match(state.error, /simulated encoding failure/);
      await fault.evaluate(() => { window.VideoEncoder = window.nativeEncoder; document.querySelector('#export-start').click(); });
      await fault.waitForFunction(() => document.querySelector('#export-progress').value >= 1 && document.querySelector('#export-error').hidden);
      await fault.evaluate(() => document.querySelector('#export-cancel').click());
      await fault.waitForFunction(() => !window.animation.exporting);
      assert.equal(await fault.evaluate(() => document.querySelector('#export-dialog').dataset.state), 'settings');
      assert.equal(fault.errors.length, 0);
      return state;
    } finally { await fault.close(); }
  });

  await check('Cancellation interrupts a full encoder queue and ignores duplicate export or playback actions', async () => {
    const cancelled = await runtime.browser.newPage();
    try {
      await cancelled.goto(runtime.url); await cancelled.evaluate(() => window.exportReady);
      await cancelled.evaluate(() => {
        const support = VideoEncoder.isConfigSupported.bind(VideoEncoder);
        window.encoderInstances = 0; window.encoderCloses = 0;
        window.VideoEncoder = class extends EventTarget {
          static isConfigSupported(config) { return support(config); }
          constructor() { super(); window.encoderInstances++; this.state = 'unconfigured'; this.encodeQueueSize = 0; }
          configure() { this.state = 'configured'; }
          encode() { this.encodeQueueSize++; }
          close() { this.state = 'closed'; window.encoderCloses++; }
        };
        window.animation.seek(456); document.querySelector('#export').click(); document.querySelector('#export-start').click();
        document.querySelector('#export-start').dispatchEvent(new Event('click'));
      });
      await cancelled.waitForFunction(() => document.querySelector('#export-progress').value >= 3);
      const busy = await cancelled.evaluate(async () => {
        await window.animation.play(); window.animation.seek(789);
        document.querySelector('#export-close').click();
        document.querySelector('#resolution-4k').dispatchEvent(new Event('click'));
        return { frame: window.animation.frame, playing: window.animation.playing, disabled: ['play', 'replay', 'seek', 'resolution-1080p', 'resolution-4k', 'fps-30', 'fps-60', 'export', 'export-start', 'export-close', 'download'].every(id => document.getElementById(id).disabled), resolution: document.querySelector('#resolution button[aria-pressed="true"]').value, instances: window.encoderInstances, focused: document.activeElement.id };
      });
      assert.equal(busy.frame, 456); assert.equal(busy.playing, false); assert.equal(busy.instances, 1); assert.ok(busy.disabled);
      assert.equal(busy.resolution, '1080p');
      assert.equal(busy.focused, 'export-cancel');
      await pressKey(cancelled, 'Tab');
      assert.equal(await cancelled.evaluate(() => document.activeElement.id), 'export-cancel');
      await pressKey(cancelled, 'Escape');
      assert.equal(await cancelled.evaluate(() => document.querySelector('#export-dialog').open), true);
      await cancelled.evaluate(() => document.querySelector('#export-cancel').click());
      await cancelled.waitForFunction(() => document.querySelector('#export-dialog').getAttribute('aria-busy') === 'false');
      const state = await cancelled.evaluate(() => ({ frame: window.animation.frame, closed: window.encoderCloses, status: document.querySelector('#export-status').textContent, playEnabled: !document.querySelector('#play').disabled, errorHidden: document.querySelector('#export-error').hidden, focused: document.activeElement.id, settingsEnabled: !document.querySelector('#resolution button[aria-pressed="true"]').disabled, closeEnabled: !document.querySelector('#export-close').disabled }));
      assert.equal(state.frame, 456); assert.equal(state.closed, 1); assert.ok(state.playEnabled && state.errorHidden); assert.match(state.status, /已取消/);
      assert.ok(state.settingsEnabled && state.closeEnabled); assert.equal(state.focused, 'export-start');
      assert.equal(cancelled.errors.length, 0);
      return state;
    } finally { await cancelled.close(); }
  });

  await check('Export dialog shows measured progress, retains completed downloads, and supports re-export', async () => {
    const completed = await runtime.browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const directory = await mkdtemp(path.join(tmpdir(), 'astra-export-dialog-'));
    // Replace only the exporter in this page with a gated, non-video fixture.
    // This checks UI and actual repeated downloads without encoding a movie.
    const fixtureSource = `
      export async function getExportSupport() { return Object.fromEntries(['1080p', '4k'].map(resolution => [resolution, { 30: { supported: true, reason: '' }, 60: { supported: true, reason: '' } }])); }
      export async function exportVideo({ resolution, fps, signal, onProgress }) {
        window.fixtureCalls = (window.fixtureCalls ?? 0) + 1;
        (window.fixtureResolutions ??= []).push(resolution);
        (window.fixtureRates ??= []).push(fps);
        const total = fps * 30;
        onProgress({ stage: 'preparing', completed: 0, total });
        onProgress({ stage: 'rendering', completed: total * 0.37, total });
        const gate = name => new Promise((resolve, reject) => {
          window[name] = resolve;
          signal.addEventListener('abort', () => reject(new DOMException('已取消导出。', 'AbortError')), { once: true });
        });
        await gate('finishFixtureFrames');
        onProgress({ stage: 'finalizing', completed: total, total });
        await gate('finishFixtureMux');
        return new Blob([new Uint8Array(2 * 1024 ** 2).fill(42)], { type: 'video/mp4' });
      }
    `;
    try {
      completed.on('Fetch.requestPaused', ({ requestId }) => {
        void completed.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }], body: Buffer.from(fixtureSource).toString('base64') }).catch(error => completed.errors.push(error.message));
      });
      await completed.send('Fetch.enable', { patterns: [{ urlPattern: '*src/browser-export.js', requestStage: 'Request' }] });
      await completed.goto(runtime.url); await completed.evaluate(() => window.exportReady);
      await completed.evaluate(() => {
        window.exportUrls = []; window.revokedExportUrls = [];
        const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = blob => { const url = create(blob); window.exportUrls.push(url); return url; };
        URL.revokeObjectURL = url => { window.revokedExportUrls.push(url); revoke(url); };
        window.animation.seek(420);
      });
      await openExportDialog(completed);
      await pressKey(completed, 'ArrowRight');
      assert.deepEqual(await completed.evaluate(() => ({ selected: document.querySelector('#resolution button[aria-pressed="true"]').value, pressed: document.querySelectorAll('#resolution button[aria-pressed="true"]').length, focused: document.activeElement.id, filename: document.querySelector('#export-filename').textContent })), { selected: '4k', pressed: 1, focused: 'resolution-4k', filename: 'astra-motion-4k-60fps.mp4' });
      const qualityLayout = await dialogLayout(completed, { width: 1440, height: 1000 }, 'export-quality-4k.png');
      await pressKey(completed, 'Enter');
      assert.equal(await completed.evaluate(() => document.querySelectorAll('#resolution button[aria-pressed="true"]').length), 1);
      await pressKey(completed, 'ArrowLeft');
      assert.equal(await completed.evaluate(() => document.querySelector('#resolution button[aria-pressed="true"]').value), '1080p');
      const viewports = [{ width: 1440, height: 1000, name: 'desktop' }, { width: 390, height: 844, name: 'mobile' }, { width: 300, height: 700, name: 'narrow' }];
      const layouts = [qualityLayout];
      for (const viewport of viewports) layouts.push(await dialogLayout(completed, viewport, `export-settings-${viewport.name}.png`));
      layouts.push(await dialogLayout(completed, { width: 300, height: 480 }, 'export-settings-short.png'));
      await completed.evaluate(() => document.querySelector('#export-start').click());
      await completed.waitForFunction(() => document.querySelector('#export-progress').value === 666);
      const progress = await completed.evaluate(() => ({ state: document.querySelector('#export-dialog').dataset.state, percent: document.querySelector('#export-percent').value, progress: document.querySelector('#export-progress').value, settingsDisabled: [...document.querySelectorAll('#resolution button')].every(button => button.disabled), closeDisabled: document.querySelector('#export-close').disabled, cancelVisible: !document.querySelector('#export-cancel').hidden, status: document.querySelector('#export-status').textContent }));
      assert.equal(progress.state, 'exporting'); assert.equal(progress.percent, '37%'); assert.equal(progress.progress, 666);
      assert.ok(progress.settingsDisabled && progress.closeDisabled && progress.cancelVisible); assert.match(progress.status, /正在导出/);
      for (const viewport of viewports) layouts.push(await dialogLayout(completed, viewport, `export-progress-${viewport.name}.png`));
      await completed.evaluate(() => window.finishFixtureFrames());
      await completed.waitForFunction(() => document.querySelector('#export-percent').value === '100%');
      assert.match(await completed.evaluate(() => document.querySelector('#export-status').textContent), /封装 MP4/);
      assert.equal(await completed.evaluate(() => document.querySelector('#download').hidden), true);
      await completed.evaluate(() => window.finishFixtureMux());
      await completed.waitForFunction(() => document.querySelector('#export-dialog').dataset.state === 'complete');
      const ready = await completed.evaluate(() => ({ frame: window.animation.frame, playing: window.animation.playing, filename: document.querySelector('#download').dataset.filename, fileSize: document.querySelector('#export-size').textContent, downloadEnabled: !document.querySelector('#download').disabled && !document.querySelector('#download').hidden, againVisible: !document.querySelector('#export-again').hidden, closeEnabled: !document.querySelector('#export-close').disabled, focused: document.activeElement.id }));
      assert.equal(ready.frame, 420); assert.equal(ready.playing, false); assert.equal(ready.filename, 'astra-motion-1080p-60fps.mp4');
      assert.equal(ready.fileSize, '2.0 MB'); assert.ok(ready.downloadEnabled && ready.againVisible && ready.closeEnabled); assert.equal(ready.focused, 'download');
      for (const viewport of viewports) layouts.push(await dialogLayout(completed, viewport, `export-complete-${viewport.name}.png`));
      let firstDownload;
      for (const attempt of ['first', 'repeat', 'reopen']) {
        if (attempt === 'reopen') {
          await pressKey(completed, 'Escape');
          await completed.waitForFunction(() => !document.querySelector('#export-dialog').open && document.activeElement.id === 'export');
          await openExportDialog(completed);
          assert.equal(await completed.evaluate(() => document.querySelector('#export-dialog').dataset.state), 'complete');
          assert.equal(await completed.evaluate(() => document.activeElement.id), 'download');
        }
        const downloadDirectory = path.join(directory, attempt);
        await mkdir(downloadDirectory);
        await completed.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDirectory });
        await completed.evaluate(() => document.querySelector('#download').click());
        const file = path.join(downloadDirectory, ready.filename), deadline = performance.now() + 15000;
        while (true) {
          try { if ((await stat(file)).size === 2 * 1024 ** 2) break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (performance.now() > deadline) throw new Error(`Fixture download timed out: ${attempt}`);
          await delay(50);
        }
        const bytes = await readFile(file);
        if (firstDownload) assert.deepEqual(bytes, firstDownload, 'Repeated fixture download differs');
        else firstDownload = bytes;
      }
      assert.deepEqual(await completed.evaluate(() => ({ calls: window.fixtureCalls, resolutions: window.fixtureResolutions, urls: window.exportUrls.length, revoked: window.revokedExportUrls.length })), { calls: 1, resolutions: ['1080p'], urls: 1, revoked: 0 });
      await completed.evaluate(() => {
        document.querySelector('#export-again').click();
        const resolution = document.querySelector('#resolution-4k'); resolution.focus(); resolution.click();
        document.querySelector('#fps-30').click();
      });
      const settings = await completed.evaluate(() => ({ state: document.querySelector('#export-dialog').dataset.state, filename: document.querySelector('#export-filename').textContent, dimensions: document.querySelector('#export-dimensions').textContent, enabled: !document.querySelector('#resolution button[aria-pressed="true"]').disabled, focused: document.activeElement.id }));
      assert.equal(settings.state, 'settings'); assert.equal(settings.filename, 'astra-motion-4k-30fps.mp4'); assert.match(settings.dimensions, /3840 × 2160/); assert.ok(settings.enabled); assert.equal(settings.focused, 'resolution-4k');
      await completed.evaluate(() => document.querySelector('#export-close').click());
      await completed.waitForFunction(() => !document.querySelector('#export-dialog').open);
      await openExportDialog(completed);
      assert.equal(await completed.evaluate(() => document.querySelector('#export-dialog').dataset.state), 'complete', 'Closing new settings should retain the last downloadable result');
      assert.equal(await completed.evaluate(() => document.querySelector('#export-filename').textContent), ready.filename);
      assert.equal(await completed.evaluate(() => document.querySelector('#export-frame-rate').textContent), '60 fps');
      await completed.evaluate(() => { document.querySelector('#export-again').click(); document.querySelector('#resolution-4k').click(); document.querySelector('#fps-30').click(); document.querySelector('#export-start').click(); });
      await completed.waitForFunction(() => window.fixtureCalls === 2);
      assert.deepEqual(await completed.evaluate(() => window.fixtureResolutions), ['1080p', '4k']);
      assert.deepEqual(await completed.evaluate(() => window.fixtureRates), [60, 30]);
      assert.equal(await completed.evaluate(() => document.querySelector('#export-progress').max), 900);
      assert.deepEqual(await completed.evaluate(() => ({ urls: window.exportUrls.length, revoked: window.revokedExportUrls })), { urls: 1, revoked: [await completed.evaluate(() => window.exportUrls[0])] });
      await completed.evaluate(() => document.querySelector('#export-cancel').click());
      await completed.waitForFunction(() => !window.animation.exporting);
      assert.equal(await completed.evaluate(() => document.querySelector('#export-dialog').dataset.state), 'settings');
      assert.equal(completed.errors.length, 0, completed.errors.join('\n'));
      return { progress, ready, repeatedDownloads: 3, sameUrlRetainedOnReopen: true, reExportReleasesOldUrl: true, layouts };
    } finally {
      await completed.close(); await rm(directory, { recursive: true, force: true });
    }
  });

  await check('Font loading gates readiness in player and export modes', async () => {
    const results = [];
    for (const render of [false, true]) {
      const loadingPage = await runtime.browser.newPage();
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      let requested = false;
      try {
        loadingPage.on('Fetch.requestPaused', ({ requestId }) => {
          requested = true;
          void gate.then(() => loadingPage.send('Fetch.continueRequest', { requestId })).catch(() => {});
        });
        await loadingPage.send('Fetch.enable', { patterns: [{ urlPattern: '*ZCOOLKuaiLe-Regular.ttf', requestStage: 'Request' }] });
        await loadingPage.goto(`${runtime.url}${render ? '?render' : ''}`);
        const deadline = performance.now() + 15000;
        while (!requested) {
          if (performance.now() >= deadline) throw new Error('Expected font request did not arrive.');
          await delay(20);
        }
        await loadingPage.waitForFunction(() => !!window.animation);
        const pending = await loadingPage.evaluate(() => ({ ready: window.animation.ready, loadingVisible: !document.querySelector('#loading').hidden, allDisabled: [...document.querySelectorAll('#play, #seek, #mute, #replay')].every(el => el.disabled) }));
        assert.deepEqual(pending, { ready: false, loadingVisible: true, allDisabled: true });
        release();
        await loadingPage.evaluate(() => window.animationReady);
        assert.equal(await loadingPage.evaluate(() => window.animation.ready), true);
        results.push({ mode: render ? 'export' : 'player', pending, readyAfterFonts: true });
      } finally { release(); await loadingPage.close(); }
    }
    return results;
  });

  await check('A missing font leaves controls disabled and reports the failure', async () => {
    const results = [];
    for (const render of [false, true]) {
      const failedPage = await runtime.browser.newPage();
      try {
        await failedPage.send('Network.setBlockedURLs', { urls: ['*ZCOOLKuaiLe-Regular.ttf'] });
        await failedPage.goto(`${runtime.url}${render ? '?render' : ''}`);
        await failedPage.waitForFunction(() => !!window.animationReady);
        const failure = await failedPage.evaluate(async () => {
          const error = await window.animationReady.then(() => null, e => e.message);
          return { error, ready: window.animation.ready, errorVisible: !document.querySelector('#error').hidden, errorText: document.querySelector('#error').textContent, allDisabled: [...document.querySelectorAll('#play, #seek, #mute, #replay')].every(el => el.disabled) };
        });
        assert.ok(failure.error, 'Font loading must reject readiness');
        assert.equal(failure.ready, false); assert.equal(failure.errorVisible, true); assert.equal(failure.allDisabled, true);
        assert.match(failure.errorText, /加载失败/);
        results.push({ mode: render ? 'export' : 'player', ...failure });
      } finally { await failedPage.close(); }
    }
    return results;
  });

  await check('Vector pet renders without requesting any sprite asset in player, 1080p, or 4K modes', async () => {
    const results = [];
    for (const query of ['', '?render', '?render&resolution=4k']) {
      const vectorPage = await runtime.browser.newPage();
      let spriteRequests = 0;
      try {
        vectorPage.on('Network.requestWillBeSent', ({ request }) => { if (request.url.includes('/sprites/')) spriteRequests++; });
        await vectorPage.send('Network.setBlockedURLs', { urls: ['*/sprites/*'] });
        await vectorPage.goto(`${runtime.url}${query}`);
        await vectorPage.evaluate(() => window.animationReady);
        const first = await frameHash(vectorPage, 0), last = await frameHash(vectorPage, await vectorPage.evaluate(() => window.animation.frames - 1));
        assert.equal(spriteRequests, 0, 'The vector character still downloads a sprite');
        assert.notEqual(first.hash, last.hash);
        assert.equal(await vectorPage.evaluate(() => window.animation.ready && document.querySelector('#error').hidden), true);
        results.push({ mode: query || 'player', spriteRequests, ready: true });
      } finally { await vectorPage.close(); }
    }
    return results;
  });

  await check('Every pet action and expression uses native paths with deterministic pose cadence at multiple scales', async () => {
    const result = await page.evaluate(async () => {
      const { character } = await import('/src/character.js');
      const actions = ['idle', 'walkRight', 'walkLeft', 'wave', 'jump', 'dizzy', 'think', 'celebrate'];
      const expressions = ['neutral', 'happy', 'blink', 'dizzy', 'wink'];
      const counts = [7, 8, 8, 4, 5, 8, 6, 6], results = [];
      for (const scale of [1, 2, 4]) {
        const canvas = document.createElement('canvas'); canvas.width = 240 * scale; canvas.height = 240 * scale;
        const c = canvas.getContext('2d');
        let bitmaps = 0;
        c.drawImage = () => { bitmaps++; throw new Error('A character path fell back to a bitmap'); };
        const draw = async (pose, frame) => {
          c.resetTransform(); c.clearRect(0, 0, canvas.width, canvas.height); c.scale(scale, scale);
          character(c, { x: 120, y: 100, ...pose }, frame);
          const pixels = c.getImageData(0, 0, canvas.width, canvas.height).data;
          let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
          for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 127) {
            const x = (i - 3) / 4 % canvas.width, y = Math.floor((i - 3) / 4 / canvas.width);
            minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
          }
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map(v => v.toString(16).padStart(2, '0')).join('');
          const t = c.getTransform();
          return { hash, bounds: [minX, minY, maxX, maxY].map(n => n / scale), transform: [t.a, t.b, t.c, t.d, t.e, t.f] };
        };
        const actionResults = [];
        for (const [i, action] of actions.entries()) {
          const first = await draw({ action }, 0), samePose = await draw({ action }, 2);
          const hashes = new Set([first.hash]);
          for (let column = 1; column < counts[i]; column++) hashes.add((await draw({ action }, column * 3)).hash);
          await draw({ action: 'jump' }, 777);
          const repeated = await draw({ action }, 0), looped = await draw({ action }, counts[i] * 3);
          actionResults.push({ action, first, samePose, repeated, looped, uniquePoses: hashes.size });
        }
        const expressionHashes = [];
        for (const expression of expressions) expressionHashes.push((await draw({ action: 'idle', expression }, 0)).hash);
        results.push({ scale, bitmaps, actions: actionResults, expressionHashes });
      }
      return results;
    });
    for (const drawing of result) {
      assert.equal(drawing.bitmaps, 0);
      assert.equal(new Set(drawing.expressionHashes).size, 5, 'Expressions must remain visibly distinct');
      for (const action of drawing.actions) {
        assert.equal(action.first.hash, action.samePose.hash, `${action.action} changed inside its three-frame pose hold`);
        assert.deepEqual(action.first, action.repeated, `${action.action} depends on previous drawing history`);
        assert.deepEqual(action.first, action.looped, `${action.action} does not loop at its original cadence`);
        assert.ok(action.uniquePoses >= 2, `${action.action} has no animation`);
        assert.deepEqual(action.first.transform, [drawing.scale, 0, 0, drawing.scale, 0, 0], 'Character leaked a canvas transform');
      }
      const idle = drawing.actions[0].first.bounds;
      assert.ok(Math.abs(idle[3] - 198) <= 1.5, 'Neutral feet moved away from the original y=98 anchor');
      assert.ok(idle[0] >= 48 && idle[2] <= 192 && idle[1] >= 37 && idle[1] <= 42, 'Cloud silhouette no longer matches the original rig footprint');
    }
    assert.equal(new Set(result.map(drawing => drawing.actions[0].first.hash)).size, 3, 'Output scales must rasterize their own native paths');
    return result.map(({ scale, bitmaps, actions, expressionHashes }) => ({ scale, bitmaps, expressionCount: new Set(expressionHashes).size, actions: actions.map(({ action, uniquePoses }) => ({ action, uniquePoses })), neutralBounds: actions[0].first.bounds }));
  });

  await check('Fonts, soundtrack, and controls are ready before playback', async () => {
    const ready = await page.evaluate(() => {
      const audio = document.querySelector('#soundtrack');
      return { ready: window.animation.ready, fontsStatus: document.fonts.status, fonts: [...document.fonts].map(f => ({ family: f.family, status: f.status })), fontChecks: ['26px "Patrick Hand"', '40px "Lilita One"', '700 100px "Caveat"'].map(font => ({ font, loaded: document.fonts.check(font) })), audio: { src: audio.currentSrc, readyState: audio.readyState, duration: audio.duration, error: audio.error?.message ?? null }, disabled: [...document.querySelectorAll('#play, #seek, #mute, #replay')].some(el => el.disabled), loadingHidden: document.querySelector('#loading').hidden, errorHidden: document.querySelector('#error').hidden };
    });
    assert.equal(ready.ready, true);
    assert.equal(ready.fontsStatus, 'loaded');
    assert.ok(ready.fonts.length >= 3 && ready.fonts.every(f => f.status === 'loaded'));
    assert.ok(ready.fontChecks.every(f => f.loaded));
    assert.ok(ready.audio.readyState >= 3 && ready.audio.duration >= 29.99);
    assert.ok(ready.audio.src.endsWith('/audio/generated.wav'));
    assert.ok(Math.abs(ready.audio.duration - 30) < 0.001);
    assert.equal(ready.audio.error, null);
    assert.equal(ready.disabled, false);
    assert.equal(ready.loadingHidden, true);
    assert.equal(ready.errorHidden, true);
    return ready;
  });

  await check('Direct frame rendering clamps bounds and floors fractions', async () => {
    const cases = [[-20, 0], [0, 0], [17.9, 17], [lastFrame, lastFrame], [frameCount + 300, lastFrame]];
    const results = await page.evaluate(tests => tests.map(([input, expected]) => ({ input, expected, returned: window.renderFrame(input), frame: window.animation.frame })), cases);
    for (const result of results) { assert.equal(result.returned, result.expected); assert.equal(result.frame, result.expected); }
    return results;
  });

  await check('Pet reaches stay anchored under parent transforms, actor scale, and rotation', async () => {
    const results = await page.evaluate(async () => {
      const { character } = await import('/src/character.js');
      const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 800;
      const c = canvas.getContext('2d'), ellipse = c.ellipse.bind(c);
      const hands = [];
      c.ellipse = (x, y, ...args) => { if (args[0] === 11 && args[1] === 9) { const point = c.getTransform().transformPoint({ x, y }); hands.push([point.x, point.y]); } ellipse(x, y, ...args); };
      const poses = [{ scale: 1, height: 118, angle: 0 }, { scale: 1.72, height: 97, angle: 0.61 }, { scale: 0.5, height: 126, angle: -1.17 }];
      return poses.map((pose, i) => {
        c.resetTransform(); c.translate(34, -18); c.rotate(0.1); c.scale(1.32, 1.32);
        const parent = c.getTransform(), x = 200, y = 500;
        const targets = [[-300, -280], [350, -430]];
        hands.length = 0;
        character(c, { ...pose, x, y, leftTarget: targets[0], rightTarget: targets[1] }, i * 343);
        const expected = targets.map(([dx, dy]) => { const point = parent.transformPoint({ x: x + dx, y: y + dy }); return [point.x, point.y]; });
        return { pose, hands: [...hands], expected, transformBefore: [...parent.toFloat64Array()], transformAfter: [...c.getTransform().toFloat64Array()] };
      });
    });
    for (const result of results) {
      assert.equal(result.hands.length, 2);
      // Native Canvas scale matrices introduce tiny float rounding errors.
      result.hands.forEach((point, i) => assert.ok(Math.hypot(point[0] - result.expected[i][0], point[1] - result.expected[i][1]) < 0.001, 'A hand moved away from its panel target'));
      assert.deepEqual(result.transformBefore, result.transformAfter, 'Character drawing leaked a canvas transform');
    }
    return results;
  });

  await check('Camera holds remain fixed, including the former maximum-shake scene', async () => {
    const result = await page.evaluate(async () => {
      const { cameraAt, referenceCameraAt } = await import('/src/timeline.js');
      const ranges = [[0, 15], [28, 104], [124, 233], [253, 360], [375, 481], [501, 595], [615, 690], [705, 899]];
      const holds = ranges.map(([start, end]) => {
        const pose = cameraAt(start);
        let maximumDrift = 0;
        for (let f = start; f <= end; f++) { const p = cameraAt(f); maximumDrift = Math.max(maximumDrift, Math.abs(p.s - pose.s), Math.abs(p.x - pose.x), Math.abs(p.y - pose.y)); }
        return { start, end, pose, maximumDrift };
      });
      const transitions = [[15, 28], [104, 124], [233, 253], [360, 375], [481, 501], [595, 615], [690, 705]].map(([start, end]) => {
        const a = cameraAt(start), b = cameraAt(end);
        const samples = Array.from({ length: end - start + 1 }, (_, i) => cameraAt(start + i));
        const monotonic = ['s', 'x', 'y'].every(key => samples.every((p, i) => !i || (b[key] >= a[key] ? p[key] >= samples[i - 1][key] : p[key] <= samples[i - 1][key])));
        return { start, end, monotonic };
      });
      return { holds, transitions, calibration: referenceCameraAt(535), displayed: cameraAt(535) };
    });
    assert.ok(result.holds.every(h => h.maximumDrift === 0), 'A held shot still has global frame-to-frame movement');
    assert.ok(result.transitions.every(t => t.monotonic), 'An intentional camera transition jitters or overshoots');
    assert.notDeepEqual(result.calibration, result.displayed, 'Source-camera shake must not be used for display');
    return result;
  });

  await check('Ink motion bends lines while fills, text, endpoints, and transforms stay fixed', async () => {
    const result = await page.evaluate(async () => {
      const { withInkMotion, strokeInk, pathContours } = await import('/src/ink.js');
      const { box, line, text, C } = await import('/src/sketch.js');
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      const c = canvas.getContext('2d');
      const hash = async (x, y, w, h) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', c.getImageData(x, y, w, h).data))].map(v => v.toString(16).padStart(2, '0')).join('');
      const draw = async frame => {
        c.resetTransform(); c.fillStyle = C.paper; c.fillRect(0, 0, 320, 180);
        withInkMotion(c, frame, 1.2, () => {
          box(c, 20, 30, 180, 110, C.orange, 12, 3.8);
          line(c, [226, 60, 298, 60], C.ink, 3);
          text(c, 'steady', 212, 125, 24);
        }, 0.75);
        return { pixels: await hash(0, 0, 320, 180), fill: await hash(60, 60, 100, 60), text: await hash(210, 102, 108, 50), transform: [...c.getTransform().toFloat64Array()] };
      };
      const first = await draw(100), changed = await draw(108);
      await draw(700); const repeated = await draw(100);
      const sample = frame => {
        const points = [];
        const recording = { lineWidth: 3, globalAlpha: 1, beginPath() {}, moveTo(x, y) { points.push([x, y]); }, lineTo(x, y) { points.push([x, y]); }, closePath() {}, stroke() {} };
        withInkMotion(recording, frame, 1.2, () => strokeInk(recording, [{ points: [10, 60, 150, 60], closed: false }]));
        return { points, width: recording.lineWidth, motionLeaked: strokeInk(recording, [{ points: [10, 60, 150, 60], closed: false }]) };
      };
      return { first, changed, repeated, lineA: sample(100), lineB: sample(108), unsupported: pathContours('M0 0 A10 10 0 0 0 20 20'), curves: pathContours('M0 0 Q10 -10 20 0 C30 10 40 -10 50 0 Z M70 0 L90 0') };
    });
    assert.notEqual(result.first.pixels, result.changed.pixels, 'Ink should visibly change between frames');
    assert.equal(result.first.fill, result.changed.fill, 'Line motion moved the flat-color interior');
    assert.equal(result.first.text, result.changed.text, 'Line motion moved or distorted text');
    assert.deepEqual(result.first.transform, result.changed.transform, 'Line motion altered the canvas transform');
    assert.deepEqual(result.first, result.repeated, 'Ink depends on draw order instead of frame number');
    assert.notDeepEqual(result.lineA.points, result.lineB.points, 'The stroke itself did not bend');
    for (const line of [result.lineA, result.lineB]) {
      assert.deepEqual(line.points[0], [10, 60]); assert.deepEqual(line.points.at(-1), [150, 60]);
      assert.ok(line.points.every(([x, y]) => x >= 10 && x <= 150 && Math.abs(y - 60) <= 1.2), 'Stroke bends exceed their local bounds');
      assert.equal(line.width, 3); assert.equal(line.motionLeaked, false);
    }
    assert.equal(result.unsupported, null, 'Unsupported SVG commands must retain native rendering');
    assert.equal(result.curves.length, 2); assert.equal(result.curves[0].closed, true); assert.equal(result.curves[1].closed, false);
    return { deterministic: true, anchoredEndpoints: true, stationaryFillAndText: true, localBendLimit: 1.2, hashes: { first: result.first.pixels, changed: result.changed.pixels, repeated: result.repeated.pixels } };
  });

  await check('Small line echoes use two faint delayed strokes without moving their anchors', async () => {
    const result = await page.evaluate(async () => {
      const { withInkMotion, strokeInk } = await import('/src/ink.js');
      const sample = (frame, echo) => {
        let points = [];
        const layers = [];
        const c = { lineWidth: 3, globalAlpha: 0.6, beginPath() { points = []; }, moveTo(x, y) { points.push([x, y]); }, lineTo(x, y) { points.push([x, y]); }, closePath() {}, stroke() { layers.push({ points, alpha: this.globalAlpha, width: this.lineWidth }); } };
        withInkMotion(c, frame, 1.5, () => strokeInk(c, [{ points: [10, 60, 150, 60], closed: false }]), echo);
        return { layers, restoredAlpha: c.globalAlpha, restoredWidth: c.lineWidth, motionLeaked: strokeInk(c, [{ points: [10, 60, 150, 60], closed: false }]) };
      };
      const first = sample(525, 1), changed = sample(526, 1);
      sample(100, 0.7);
      return { first, changed, repeated: sample(525, 1), disabled: sample(525, 0) };
    });
    assert.equal(result.first.layers.length, 3, 'Expected two ghosts and one crisp main stroke');
    assert.equal(result.disabled.layers.length, 1, 'Panel strokes must not acquire unrequested ghosts');
    assert.deepEqual(result.first, result.repeated, 'Ghosts depend on previous playback history');
    assert.notDeepEqual(result.first.layers, result.changed.layers, 'Local stroke flutter is not visible on adjacent frames');
    assert.notDeepEqual(result.first.layers[1].points, result.first.layers[2].points, 'Ghosts are not offset from the main stroke');
    for (const drawing of [result.first, result.changed, result.repeated]) {
      assert.equal(drawing.restoredAlpha, 0.6); assert.equal(drawing.restoredWidth, 3); assert.equal(drawing.motionLeaked, false);
      for (const layer of drawing.layers) {
        assert.deepEqual(layer.points[0], [10, 60]); assert.deepEqual(layer.points.at(-1), [150, 60]);
        assert.ok(layer.points.every(([x, y]) => x >= 10 && x <= 150 && Math.abs(y - 60) <= 4.5), 'Ghost offset exceeds its small local range');
      }
      assert.equal(drawing.layers[0].alpha, 0.6 * 0.1); assert.equal(drawing.layers[1].alpha, 0.6 * 0.28); assert.equal(drawing.layers[2].alpha, 0.6);
      assert.ok(drawing.layers.slice(0, 2).every(layer => layer.width < drawing.layers[2].width), 'Ghost strokes should remain thinner than the main line');
    }
    return { ghostLayers: 2, delaysInFrames: [4, 2], maximumGhostOpacity: 0.28, anchoredEndpoints: true, deterministic: true, stateRestored: true };
  });

  const baseline = new Map();
  await check('Pixel determinism after seeded random seeks across all scenes', async () => {
    const frames = [0, 45, 100, 119, 150, 212, 280, 325, 380, 428, 480, 525, 575, 620, 690, 733, 748, 810, 855, 899].map(sceneFrame);
    for (const frame of frames) baseline.set(frame, (await frameHash(page, frame)).hash);
    assert.ok(new Set(baseline.values()).size >= 18, 'Distinct moments should produce distinct drawings');
    let seed = 0x0f055;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    const shuffled = [...frames];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    for (const frame of shuffled) {
      await page.evaluate(f => window.animation.seek(f), Math.floor(random() * frameCount));
      const actual = await frameHash(page, frame);
      assert.equal(actual.frame, frame);
      assert.equal(actual.hash, baseline.get(frame), `Frame ${frame} changed after another frame was drawn`);
      assert.equal((await frameHash(page, frame)).hash, actual.hash, `Repeated frame ${frame} changed`);
    }
    return { algorithm: 'SHA-256 of canvas RGBA pixels', randomSeed: '0x0f055', hashes: Object.fromEntries(baseline) };
  });

  await check('Play advances and follows the soundtrack clock', async () => {
    await page.evaluate(() => { window.animation.pause(); window.animation.seek(0); });
    await page.evaluate(() => document.querySelector('#play').click());
    await page.waitForFunction(() => window.animation.playing && window.animation.frame >= 6);
    const samples = [];
    for (let i = 0; i < 5; i++) {
      await delay(180);
      samples.push(await getState(page));
    }
    for (const sample of samples) {
      assert.equal(sample.playing, true);
      assert.equal(sample.audioPaused, false);
      assert.ok(Math.abs(sample.frame - Math.floor(sample.audioTime * fps)) <= clockTolerance, `Audio/frame discrepancy at ${sample.audioTime}s`);
    }
    assert.ok(samples.at(-1).frame > samples[0].frame);
    return { samples, maximumFrameClockDifference: Math.max(...samples.map(s => Math.abs(s.frame - Math.floor(s.audioTime * fps)))) };
  });

  await check('Pause freezes pixels, frame, and audio; resume advances', async () => {
    await page.evaluate(() => document.querySelector('#play').click());
    const paused = await getState(page), hash = await frameHash(page);
    assert.equal(paused.playing, false);
    assert.equal(paused.audioPaused, true);
    await delay(350);
    const frozen = await getState(page);
    assert.equal(frozen.frame, paused.frame);
    assert.ok(Math.abs(frozen.audioTime - paused.audioTime) < 0.001);
    assert.equal((await frameHash(page)).hash, hash.hash);
    await page.evaluate(() => document.querySelector('#play').click());
    await page.waitForFunction(f => window.animation.playing && window.animation.frame > f + 3, paused.frame);
    return { paused, resumed: await getState(page) };
  });

  await check('Progress control seeks while playing and preserves audio synchronization', async () => {
    await seekWithControl(page, 15 * fps);
    await page.waitForFunction(() => window.animation.playing && window.animation.frame >= 15 * window.animation.fps + 3);
    const state = await getState(page);
    assert.equal(state.playing, true);
    assert.ok(state.audioTime >= 15 && state.audioTime < 18);
    assert.ok(Math.abs(state.frame - Math.floor(state.audioTime * fps)) <= clockTolerance);
    assert.equal(state.seek, state.frame);
    return state;
  });

  await check('Mute and unmute update audio and accessible control state', async () => {
    await page.evaluate(() => document.querySelector('#mute').click());
    assert.equal((await getState(page)).muted, true);
    assert.equal(await page.evaluate(() => document.querySelector('#mute').getAttribute('aria-pressed')), 'true');
    assert.equal(await page.evaluate(() => document.querySelector('#mute').getAttribute('aria-label')), '取消静音');
    await page.evaluate(() => document.querySelector('#mute').click());
    assert.equal((await getState(page)).muted, false);
    assert.equal(await page.evaluate(() => document.querySelector('#mute').getAttribute('aria-pressed')), 'false');
    return { mutedAndUnmuted: true };
  });

  await check(`Complete 30-second playback stays synchronized and stops on exactly frame ${lastFrame}`, async () => {
    await page.evaluate(() => { window.animation.pause(); window.animation.seek(0); });
    await page.evaluate(() => document.querySelector('#play').click());
    const samples = [], deadline = performance.now() + 40000;
    while (performance.now() < deadline) {
      await delay(250);
      const sample = await getState(page);
      samples.push({ frame: sample.frame, audioTime: sample.audioTime, playing: sample.playing });
      if (!sample.playing && sample.frame === lastFrame) break;
    }
    const state = await getState(page);
    assert.ok(samples.length >= 50, 'Continuous playback ended too early');
    for (let i = 1; i < samples.length; i++) {
      assert.ok(samples[i].audioTime >= samples[i - 1].audioTime, 'Audio clock moved backward');
      assert.ok(samples[i].frame >= samples[i - 1].frame, 'Playback frame moved backward');
    }
    const maximumFrameClockDifference = Math.max(...samples.map(s => Math.abs(s.frame - Math.min(lastFrame, Math.floor(s.audioTime * fps)))));
    assert.ok(maximumFrameClockDifference <= clockTolerance, `Playback clock deviated by ${maximumFrameClockDifference} frames`);
    assert.equal(state.frame, lastFrame);
    assert.equal(state.seek, lastFrame);
    assert.equal(state.playing, false);
    assert.equal(state.audioPaused, true);
    // The generated PCM track and the picture both end at 30 seconds.
    assert.ok(state.audioTime >= 29.99 && state.audioTime <= 30.1, `Unexpected finish time: ${state.audioTime}`);
    assert.equal(state.label, '重播');
    assert.equal(state.time, '00:30 / 00:30');
    assert.equal((await frameHash(page)).hash, baseline.get(lastFrame));
    await delay(180);
    assert.equal((await getState(page)).frame, lastFrame);
    return { state, maximumFrameClockDifference, samples };
  });

  await check('Play from the end and the replay button restart from the beginning', async () => {
    await page.evaluate(() => document.querySelector('#play').click());
    await page.waitForFunction(() => window.animation.playing && window.animation.frame > 1 && window.animation.frame < 30);
    const fromEnd = await getState(page);
    assert.ok(fromEnd.audioTime < 1);
    await seekWithControl(page, 500);
    await page.evaluate(() => document.querySelector('#replay').click());
    await page.waitForFunction(() => window.animation.playing && window.animation.frame > 1 && window.animation.frame < 30);
    const fromReplayButton = await getState(page);
    assert.ok(fromReplayButton.audioTime < 1);
    await page.evaluate(() => document.querySelector('#play').click());
    return { fromEnd, fromReplayButton };
  });

  await check('Seeking to the final frame pauses and keeps the final drawing', async () => {
    await page.evaluate(() => window.animation.play());
    await seekWithControl(page, lastFrame);
    const state = await getState(page);
    assert.equal(state.frame, lastFrame);
    assert.equal(state.playing, false);
    assert.equal(state.audioPaused, true);
    assert.equal(state.label, '重播');
    assert.equal((await frameHash(page)).hash, baseline.get(lastFrame));
    return state;
  });

  await check('Desktop layout preserves 16:9 and controls outside the image', () => layout(page, { width: 1440, height: 1000 }, 'desktop.png'));
  await check('Mobile layout preserves 16:9 with no horizontal overflow', () => layout(page, { width: 390, height: 844 }, 'mobile.png'));
  await check('Narrow mobile layout keeps the top-right export entry inside the viewport', () => layout(page, { width: 300, height: 700 }, 'mobile-narrow.png'));
  await check('Fullscreen retains the top-right export entry and opens its modal inside the viewport', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    try {
      await page.evaluate(() => document.querySelector('.player').requestFullscreen());
      const state = await page.evaluate(() => {
        const canvas = document.querySelector('#film').getBoundingClientRect(), controls = document.querySelector('.controls').getBoundingClientRect(), entry = document.querySelector('#export').getBoundingClientRect(), heading = document.querySelector('.heading').getBoundingClientRect();
        return { canvasTop: canvas.top, canvasBottom: canvas.bottom, controlsTop: controls.top, controlsBottom: controls.bottom, entryTop: entry.top, entryBottom: entry.bottom, entryRight: entry.right, headingRight: heading.right, width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.ok(state.entryTop >= 0 && state.entryBottom <= state.canvasTop && state.canvasBottom <= state.controlsTop && state.controlsBottom <= state.height);
      assert.ok(Math.abs(state.entryRight - state.headingRight) < 1 && state.entryRight <= state.width);
      assert.equal(state.overflow, false);
      await openExportDialog(page);
      const dialog = await dialogLayout(page, { width: 1440, height: 1000 }, 'export-fullscreen.png');
      assert.equal(await page.evaluate(() => !!document.fullscreenElement), true);
      return { ...state, dialog };
    } finally { await page.evaluate(() => { document.querySelector('#export-close').click(); return document.exitFullscreen(); }); }
  });

  await check('Export mode uses the same pixels at native 1920×1080', async () => {
    const exportPage = await runtime.browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    observe(exportPage);
    try {
      await exportPage.goto(`${runtime.url}?render&fps=${fps}`);
      await exportPage.evaluate(() => window.animationReady);
      for (const frame of [0, 428, 525, 899].map(sceneFrame)) assert.equal((await frameHash(exportPage, frame)).hash, baseline.get(frame), `Export frame ${frame} differs from player`);
      const state = await exportPage.evaluate(() => { const r = document.querySelector('#film').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, controlsHidden: getComputedStyle(document.querySelector('.controls')).display === 'none' }; });
      assert.deepEqual(state, { x: 0, y: 0, width: 1920, height: 1080, controlsHidden: true });
      return state;
    } finally { await exportPage.close(); }
  });

  await check('4K export draws deterministic native pixels and captures the full canvas', async () => {
    const resolution = selectResolution(['--resolution=4k']);
    const exportPage = await runtime.browser.newPage({ viewport: { width: resolution.width, height: resolution.height }, deviceScaleFactor: 1 });
    observe(exportPage);
    try {
      await exportPage.goto(`${runtime.url}?render&resolution=4k&fps=${fps}`);
      await exportPage.evaluate(() => window.animationReady);
      const hashes = new Map();
      for (const frame of [0, 428, 525, 899, 428, 0, 899].map(sceneFrame)) {
        const { hash } = await frameHash(exportPage, frame);
        if (hashes.has(frame)) assert.equal(hash, hashes.get(frame), `4K frame ${frame} changed after seeking`);
        else hashes.set(frame, hash);
      }
      const state = await exportPage.evaluate(() => {
        const canvas = document.querySelector('#film'), box = canvas.getBoundingClientRect(), transform = canvas.getContext('2d').getTransform();
        return { width: canvas.width, height: canvas.height, x: box.x, y: box.y, cssWidth: box.width, cssHeight: box.height, transform: [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f], controlsHidden: getComputedStyle(document.querySelector('.controls')).display === 'none' };
      });
      assert.deepEqual(state, { width: 3840, height: 2160, x: 0, y: 0, cssWidth: 3840, cssHeight: 2160, transform: [2, 0, 0, 2, 0, 0], controlsHidden: true });
      const png = await exportPage.screenshot();
      const info = await pngPixels(exportPage, png);
      assert.equal(info.width, resolution.width); assert.equal(info.height, resolution.height);
      assert.equal(info.hash, hashes.get(lastFrame), '4K screenshot resampled or clipped the native canvas');
      await writeFile(path.join(artifactDir, 'export-4k.png'), png);
      return { ...state, hashes: Object.fromEntries(hashes), screenshotMatchesCanvas: true };
    } finally { await exportPage.close(); }
  });

  await check('Fast PNG capture preserves native pixels at 1080p and 4K after immediate frame changes', async () => {
    const results = [];
    for (const name of ['1080p', '4k']) {
      const resolution = selectResolution([`--resolution=${name}`]);
      const exportPage = await runtime.browser.newPage({ viewport: { width: resolution.width, height: resolution.height }, deviceScaleFactor: 1 });
      observe(exportPage);
      let capture;
      try {
        await exportPage.goto(`${runtime.url}?render&resolution=${name}&fps=${fps}`);
        await exportPage.evaluate(() => window.animationReady);
        capture = await createFrameCapture(exportPage, resolution);
        for (const frame of [899, 0, 428, 427, 429, 525, 899].map(sceneFrame)) {
          await exportPage.evaluate(f => window.renderFrame(f), frame);
          const png = await capture.capture();
          const info = await pngPixels(exportPage, png);
          assert.equal(info.width, resolution.width); assert.equal(info.height, resolution.height);
          const expected = (await frameHash(exportPage)).hash;
          assert.equal(info.hash, expected, `Fast ${name} capture differs at frame ${frame}`);
        }
        results.push({ resolution: name, verifiedFrames: 7, decodedPixelsMatchCanvas: true });
      } finally {
        try { await capture?.close(); } finally { await exportPage.close(); }
      }
    }
    return results;
  });

  await check('Managed exporter serves native pixels without registering exit-on-signal handlers', async () => {
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const handlers = new Map(signals.map(signal => [signal, process.listeners(signal)]));
    const resolution = selectResolution(['--resolution=4k']);
    const managed = await openRenderer({ resolution, fps, handleSignals: false });
    let capture;
    try {
      for (const signal of signals) assert.deepEqual(process.listeners(signal), handlers.get(signal), `Managed exporter installed a ${signal} handler`);
      capture = await createFrameCapture(managed.page, resolution);
      for (const frame of [0, 428, 899].map(sceneFrame)) {
        await managed.page.evaluate(f => window.renderFrame(f), frame);
        const info = await pngPixels(managed.page, await capture.capture());
        assert.equal(info.width, resolution.width); assert.equal(info.height, resolution.height);
        assert.equal(info.hash, (await frameHash(managed.page)).hash);
      }
      assert.deepEqual(managed.errors, []);
      return { resolution: resolution.name, verifiedFrames: 3, ownsShutdown: true, decodedPixelsMatchCanvas: true };
    } finally {
      try { await capture?.close(); } finally { await managed.close(); }
    }
  });

  await check('No JavaScript, font, audio, or resource load failures', async () => {
    assert.equal(runtime.errors.length, 0, runtime.errors.join('\n'));
    assert.equal(report.browserErrors.length, 0, report.browserErrors.join('\n'));
    assert.equal(report.resourceFailures.length, 0, JSON.stringify(report.resourceFailures));
    assert.equal(report.consoleErrors.length, 0, report.consoleErrors.join('\n'));
    assert.equal(await page.evaluate(() => document.querySelector('#soundtrack').error?.message ?? null), null);
    assert.equal(await page.evaluate(() => !document.querySelector('#error').hidden), false);
    return { pageErrors: 0, failedRequests: 0, consoleErrors: 0 };
  });
} catch (error) {
  report.failures.push({ name: 'Verification setup or execution', error: error.stack || String(error) });
  console.error(error);
} finally {
  await runtime?.close();
  report.passed = report.failures.length === 0;
  report.completedAt = new Date().toISOString();
  await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
}

console.log(`${report.checks.filter(c => c.passed).length}/${report.checks.length} checks passed. Report: output/verification.json`);
if (!report.passed) process.exitCode = 1;
