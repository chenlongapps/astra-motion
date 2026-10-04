import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openRenderer, output } from './browser.mjs';
import { selectResolution } from './render-options.mjs';
import { createFrameCapture, pngPixels } from './frame-capture.mjs';

// This is a browser smoke/integration check, using the same Chromium launcher
// as the video exporter. No golden images are needed for artistic revisions.
const report = { startedAt: new Date().toISOString(), passed: false, checks: [], failures: [], browserErrors: [], resourceFailures: [], mediaRequestCancellations: [], consoleErrors: [], screenshots: {} };
const artifactDir = path.join(output, 'screenshots');
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
    };
  });
  assert.equal(metrics.documentWidth, viewport.width, 'Page has horizontal overflow');
  assert.equal(metrics.canvas.nativeWidth, 1920);
  assert.equal(metrics.canvas.nativeHeight, 1080);
  assert.ok(Math.abs(metrics.canvas.width / metrics.canvas.height - 16 / 9) < 0.01, 'Canvas must preserve its 16:9 aspect ratio');
  assert.ok(metrics.canvas.x >= 0 && metrics.canvas.x + metrics.canvas.width <= viewport.width + 1, 'Canvas extends outside viewport');
  assert.ok(metrics.controls.y >= metrics.canvas.y + metrics.canvas.height, 'Controls overlap the animation');
  assert.ok(metrics.controlsVisible, 'Some controls extend outside the viewport');
  const target = path.join(artifactDir, filename);
  await page.screenshot({ path: target, fullPage: true });
  report.screenshots[filename.replace('.png', '')] = path.relative(output, target);
  return metrics;
}

try {
  runtime = await openRenderer({ render: false, width: 1440, height: 1000 });
  const { page } = runtime;
  page.setDefaultTimeout(15000);
  observe(page);
  // Attach asset observers before a fresh navigation so initial font/audio
  // responses, as well as runtime failures, are included in the report.
  await page.goto(runtime.url);
  await waitForReady(page);

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
        const first = await frameHash(vectorPage, 0), last = await frameHash(vectorPage, 899);
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
    const cases = [[-20, 0], [0, 0], [17.9, 17], [899, 899], [1200, 899]];
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
    const frames = [0, 45, 100, 119, 150, 212, 280, 325, 380, 428, 480, 525, 575, 620, 690, 733, 748, 810, 855, 899];
    for (const frame of frames) baseline.set(frame, (await frameHash(page, frame)).hash);
    assert.ok(new Set(baseline.values()).size >= 18, 'Distinct moments should produce distinct drawings');
    let seed = 0x0f055;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    const shuffled = [...frames];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    for (const frame of shuffled) {
      await page.evaluate(f => window.animation.seek(f), Math.floor(random() * 900));
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
      assert.ok(Math.abs(sample.frame - Math.floor(sample.audioTime * 30)) <= 2, `Audio/frame discrepancy at ${sample.audioTime}s`);
    }
    assert.ok(samples.at(-1).frame > samples[0].frame);
    return { samples, maximumFrameClockDifference: Math.max(...samples.map(s => Math.abs(s.frame - Math.floor(s.audioTime * 30)))) };
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
    await seekWithControl(page, 450);
    await page.waitForFunction(() => window.animation.playing && window.animation.frame >= 453);
    const state = await getState(page);
    assert.equal(state.playing, true);
    assert.ok(state.audioTime >= 15 && state.audioTime < 18);
    assert.ok(Math.abs(state.frame - Math.floor(state.audioTime * 30)) <= 2);
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

  await check('Complete 30-second playback stays synchronized and stops on exactly frame 899', async () => {
    await page.evaluate(() => { window.animation.pause(); window.animation.seek(0); });
    await page.evaluate(() => document.querySelector('#play').click());
    const samples = [], deadline = performance.now() + 40000;
    while (performance.now() < deadline) {
      await delay(250);
      const sample = await getState(page);
      samples.push({ frame: sample.frame, audioTime: sample.audioTime, playing: sample.playing });
      if (!sample.playing && sample.frame === 899) break;
    }
    const state = await getState(page);
    assert.ok(samples.length >= 50, 'Continuous playback ended too early');
    for (let i = 1; i < samples.length; i++) {
      assert.ok(samples[i].audioTime >= samples[i - 1].audioTime, 'Audio clock moved backward');
      assert.ok(samples[i].frame >= samples[i - 1].frame, 'Playback frame moved backward');
    }
    const maximumFrameClockDifference = Math.max(...samples.map(s => Math.abs(s.frame - Math.min(899, Math.floor(s.audioTime * 30)))));
    assert.ok(maximumFrameClockDifference <= 2, `Playback clock deviated by ${maximumFrameClockDifference} frames`);
    assert.equal(state.frame, 899);
    assert.equal(state.seek, 899);
    assert.equal(state.playing, false);
    assert.equal(state.audioPaused, true);
    // The generated PCM track and the picture both end at 30 seconds.
    assert.ok(state.audioTime >= 29.99 && state.audioTime <= 30.1, `Unexpected finish time: ${state.audioTime}`);
    assert.equal(state.label, '重播');
    assert.equal(state.time, '00:30 / 00:30');
    assert.equal((await frameHash(page)).hash, baseline.get(899));
    await delay(180);
    assert.equal((await getState(page)).frame, 899);
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
    await seekWithControl(page, 899);
    const state = await getState(page);
    assert.equal(state.frame, 899);
    assert.equal(state.playing, false);
    assert.equal(state.audioPaused, true);
    assert.equal(state.label, '重播');
    assert.equal((await frameHash(page)).hash, baseline.get(899));
    return state;
  });

  await check('Desktop layout preserves 16:9 and controls outside the image', () => layout(page, { width: 1440, height: 1000 }, 'desktop.png'));
  await check('Mobile layout preserves 16:9 with no horizontal overflow', () => layout(page, { width: 390, height: 844 }, 'mobile.png'));

  await check('Export mode uses the same pixels at native 1920×1080', async () => {
    const exportPage = await runtime.browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    observe(exportPage);
    try {
      await exportPage.goto(`${runtime.url}?render`);
      await exportPage.evaluate(() => window.animationReady);
      for (const frame of [0, 428, 525, 899]) assert.equal((await frameHash(exportPage, frame)).hash, baseline.get(frame), `Export frame ${frame} differs from player`);
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
      await exportPage.goto(`${runtime.url}?render&resolution=4k`);
      await exportPage.evaluate(() => window.animationReady);
      const hashes = new Map();
      for (const frame of [0, 428, 525, 899, 428, 0, 899]) {
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
      assert.equal(info.hash, hashes.get(899), '4K screenshot resampled or clipped the native canvas');
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
        await exportPage.goto(`${runtime.url}?render&resolution=${name}`);
        await exportPage.evaluate(() => window.animationReady);
        capture = await createFrameCapture(exportPage, resolution);
        for (const frame of [899, 0, 428, 427, 429, 525, 899]) {
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
    const managed = await openRenderer({ resolution, handleSignals: false });
    let capture;
    try {
      for (const signal of signals) assert.deepEqual(process.listeners(signal), handlers.get(signal), `Managed exporter installed a ${signal} handler`);
      capture = await createFrameCapture(managed.page, resolution);
      for (const frame of [0, 428, 899]) {
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
