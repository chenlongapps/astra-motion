import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { openRenderer } from './browser.mjs';
import { selectResolution, root } from './render-options.mjs';

const resolution = selectResolution(process.argv.slice(2)), { output, width, height } = resolution;
const videoFile = path.join(output, 'astra-motion.mp4');
const report = { startedAt: new Date().toISOString(), passed: false, resolution: resolution.name, width, height, checks: [], failures: [], mediaErrors: [], browserErrors: [] };
await mkdir(path.join(output, 'screenshots'), { recursive: true });
let runtime;
async function check(name, fn) {
  try { const details = await fn(); report.checks.push({ name, passed: true, details }); console.log(`PASS ${name}`); }
  catch (error) { report.checks.push({ name, passed: false, error: error.message }); report.failures.push({ name, error: error.stack || String(error) }); console.error(`FAIL ${name}: ${error.message}`); }
}

try {
  report.mediaSha256 = createHash('sha256').update(await readFile(videoFile)).digest('hex');
  runtime = await openRenderer({ render: false, width: 1280, height: 800 });
  const { page } = runtime;
  page.setDefaultTimeout(15000);
  page.on('Runtime.exceptionThrown', ({ exceptionDetails }) => report.browserErrors.push(exceptionDetails.exception?.description ?? exceptionDetails.text));
  await page.evaluate(url => {
    window.animation.pause();
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;display:grid;place-items:center;background:#151515;height:100vh';
    const video = document.createElement('video');
    video.id = 'encoded-film'; video.preload = 'auto'; video.muted = true;
    video.style.cssText = 'display:block;width:1280px;height:720px;max-width:100vw;object-fit:contain';
    video.src = url;
    window.mp4Errors = [];
    video.addEventListener('error', () => window.mp4Errors.push({ code: video.error?.code, message: video.error?.message }));
    document.body.append(video);
  }, new URL(path.relative(root, videoFile).split(path.sep).join('/'), runtime.url).href);
  await page.waitForFunction(() => { const video = document.querySelector('video'); return video.readyState >= 3 || Boolean(video.error); });

  await check('Final MP4 metadata and decoded first frame are available in Chromium', async () => {
    const metadata = await page.evaluate(() => { const v = document.querySelector('video'); return { src: v.currentSrc, width: v.videoWidth, height: v.videoHeight, duration: v.duration, readyState: v.readyState, error: v.error ? { code: v.error.code, message: v.error.message } : null }; });
    assert.equal(metadata.width, width); assert.equal(metadata.height, height); assert.ok(Math.abs(metadata.duration - 30) < 0.001); assert.equal(metadata.error, null);
    return metadata;
  });

  await check('Actual MP4 seeks resolve and decode at 0, 15, and 29.966 seconds', async () => {
    const samples = [];
    for (const target of [0, 15, 29.966]) {
      const state = await page.evaluate(async t => {
        const v = document.querySelector('video'); v.pause();
        if (Math.abs(v.currentTime - t) > 0.00001) {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(`Seek ${t} timed out`)), 10000);
            v.addEventListener('seeked', () => { clearTimeout(timeout); resolve(); }, { once: true });
            v.currentTime = t;
          });
        }
        return { target: t, time: v.currentTime, readyState: v.readyState, seeking: v.seeking, width: v.videoWidth, height: v.videoHeight, error: v.error?.message ?? null };
      }, target);
      assert.ok(Math.abs(state.time - target) < 0.05); assert.ok(state.readyState >= 2); assert.equal(state.seeking, false); assert.equal(state.error, null);
      const screenshot = path.join(output, 'screenshots', `mp4-${String(target).replace('.', '-')}.png`);
      const clip = await page.evaluate(() => { const box = document.querySelector('#encoded-film').getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 }; });
      await page.screenshot({ path: screenshot, clip });
      samples.push({ ...state, screenshot: path.relative(output, screenshot) });
    }
    return samples;
  });

  await check('Actual MP4 plays its complete 30 seconds and ends without media errors', async () => {
    await page.evaluate(async () => { const v = document.querySelector('video'); v.currentTime = 0; await v.play(); });
    const samples = [], start = performance.now(), deadline = start + 40000;
    while (performance.now() < deadline) {
      await delay(500);
      const state = await page.evaluate(() => { const v = document.querySelector('video'); return { time: v.currentTime, paused: v.paused, ended: v.ended, error: v.error?.message ?? null, playbackQuality: v.getVideoPlaybackQuality ? { totalVideoFrames: v.getVideoPlaybackQuality().totalVideoFrames, droppedVideoFrames: v.getVideoPlaybackQuality().droppedVideoFrames } : null }; });
      samples.push(state);
      assert.equal(state.error, null);
      if (state.ended) break;
    }
    const final = samples.at(-1), elapsedMs = Math.round(performance.now() - start);
    assert.ok(samples.length >= 50, 'Playback ended before a complete run'); assert.equal(final.ended, true); assert.equal(final.paused, true); assert.ok(Math.abs(final.time - 30) < 0.05);
    for (let i = 1; i < samples.length; i++) assert.ok(samples[i].time >= samples[i - 1].time, 'Video clock moved backward');
    const errors = await page.evaluate(() => window.mp4Errors); report.mediaErrors = errors; assert.deepEqual(errors, []); assert.deepEqual(report.browserErrors, []);
    return { elapsedMs, final, samples };
  });
} catch (error) { report.failures.push({ name: 'MP4 browser verification setup', error: error.stack || String(error) }); console.error(error); }
finally {
  await runtime?.close(); report.completedAt = new Date().toISOString(); report.passed = report.failures.length === 0;
  await mkdir(output, { recursive: true }); await writeFile(path.join(output, 'mp4-browser-verification.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(`${report.checks.filter(c => c.passed).length}/${report.checks.length} MP4 checks passed`);
if (!report.passed) process.exit(1);
