import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { openRenderer, output } from './browser.mjs';
import profiles from '../src/render-profiles.json' with { type: 'json' };
import { selectFrameRate } from './render-options.mjs';
import { frameTiming } from '../src/frame-timing.js';

// Explicit, full-length browser-export acceptance. Normal `verify` remains a
// smoke check and never creates complete movies.
const run = promisify(execFile), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const { fps, frames } = frameTiming(selectFrameRate(process.argv.slice(2)));
const report = { startedAt: new Date().toISOString(), passed: false, fps, frames, exports: [] };
const directory = await mkdtemp(path.join(tmpdir(), 'astra-browser-export-'));
const screenshots = path.join(output, 'screenshots');
await mkdir(screenshots, { recursive: true });
let runtime;
try {
  runtime = await openRenderer({ render: false, width: 1440, height: 1100 });
  const { page } = runtime;
  await page.evaluate(() => window.exportReady);
  await page.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory });
  await page.evaluate(() => {
    window.exportUrls = []; window.revokedExportUrls = [];
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); window.exportUrls.push(url); return url; };
    URL.revokeObjectURL = url => { window.revokedExportUrls.push(url); revoke(url); };
  });
  const decodedAudio = await run('ffmpeg', ['-v', 'error', '-i', 'public/audio/generated.m4a', '-map', '0:a:0', '-af', 'atrim=end_sample=1440000', '-f', 'f32le', '-'], { encoding: null, maxBuffer: 16 * 1024 ** 2 });
  for (const resolution of Object.keys(profiles)) {
    const started = performance.now(), expected = profiles[resolution];
    await page.evaluate(({ resolution, fps }) => {
      if (document.querySelector('#export-dialog').open) document.querySelector('#export-close').click();
      window.animation.pause(); window.animation.seek(321);
      document.querySelector('#export').click();
      if (document.querySelector('#export-dialog').dataset.state === 'complete') document.querySelector('#export-again').click();
      document.getElementById(`resolution-${resolution}`).click();
      const rate = document.getElementById(`fps-${fps}`);
      if (rate.disabled) throw new Error(`Unsupported export: ${resolution} / ${fps} fps`);
      rate.click();
      document.querySelector('#export-start').click();
    }, { resolution, fps });
    const deadline = performance.now() + 10 * 60 * 1000;
    let lastProgress = -1;
    while (true) {
      const state = await page.evaluate(() => ({ busy: document.querySelector('#export-dialog').getAttribute('aria-busy') === 'true', progress: document.querySelector('#export-progress').value, error: document.querySelector('#export-error').hidden ? null : document.querySelector('#export-error').textContent }));
      if (state.error) throw new Error(state.error);
      if (!state.busy) break;
      if (state.progress >= lastProgress + fps * 3) { lastProgress = state.progress; console.log(`${resolution} / ${fps} fps: ${state.progress} / ${frames} frames`); }
      if (performance.now() > deadline) throw new Error(`${resolution} browser export timed out.`);
      await delay(500);
    }
    const ready = await page.evaluate(() => ({ frame: window.animation.frame, playing: window.animation.playing, downloadEnabled: !document.querySelector('#download').disabled, filename: document.querySelector('#download').dataset.filename, urls: window.exportUrls.length, revoked: window.revokedExportUrls.length }));
    assert.equal(ready.frame, 321); assert.equal(ready.playing, false); assert.ok(ready.downloadEnabled);
    assert.equal(ready.filename, `astra-motion-${resolution}-${fps}fps.mp4`);
    if (resolution === '4k') assert.equal(ready.revoked, 1, 'Starting a new export did not release the old result');
    await page.screenshot({ path: path.join(screenshots, `web-export-${resolution}.png`), fullPage: true });
    await page.evaluate(() => document.querySelector('#download').click());
    const file = path.join(directory, ready.filename);
    const downloadDeadline = performance.now() + 30000;
    while (true) {
      try { if ((await stat(file)).size > 0) break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (performance.now() > downloadDeadline) throw new Error('Browser download timed out.');
      await delay(100);
    }
    const { stdout } = await run('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8', maxBuffer: 2 ** 20 });
    const info = JSON.parse(stdout), video = info.streams.find(stream => stream.codec_type === 'video'), audio = info.streams.find(stream => stream.codec_type === 'audio');
    assert.equal(video.width, expected.width); assert.equal(video.height, expected.height);
    assert.equal(video.codec_name, 'h264'); assert.equal(video.avg_frame_rate, `${fps}/1`); assert.equal(Number(video.nb_read_frames), frames);
    assert.equal(Number(video.duration), 30); assert.equal(Number(audio.duration), 30); assert.equal(Number(info.format.duration), 30);
    assert.equal(audio.codec_name, 'aac'); assert.equal(audio.sample_rate, '48000'); assert.equal(audio.channels, 2);
    await run('ffmpeg', ['-v', 'error', '-xerror', '-i', file, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'], { maxBuffer: 2 ** 20 });
    const movieAudio = await run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-af', 'atrim=end_sample=1440000', '-f', 'f32le', '-'], { encoding: null, maxBuffer: 16 * 1024 ** 2 });
    assert.equal(hash(movieAudio.stdout), hash(decodedAudio.stdout), 'Muxing shifted or changed the original AAC soundtrack');
    const repeatDirectory = path.join(directory, `repeat-${resolution}`);
    await mkdir(repeatDirectory);
    await page.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: repeatDirectory });
    await page.evaluate(() => { document.querySelector('#export-close').click(); document.querySelector('#export').click(); document.querySelector('#download').click(); });
    const repeat = path.join(repeatDirectory, ready.filename);
    const repeatDeadline = performance.now() + 30000;
    while (true) {
      try { if ((await stat(repeat)).size === (await stat(file)).size) break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (performance.now() > repeatDeadline) throw new Error('Repeated download timed out.');
      await delay(100);
    }
    assert.equal(hash(await readFile(file)), hash(await readFile(repeat)), 'Repeated download after reopening differs');
    await page.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory });
    // Save decoded samples for visual inspection; only temporary movies exist.
    for (const frame of [0, frames / 2, frames - 1]) await run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', '-update', '1', path.join(screenshots, `web-export-${resolution}-${fps}fps-frame-${frame}.png`)], { maxBuffer: 2 ** 20 });
    report.exports.push({ resolution, width: video.width, height: video.height, frames: Number(video.nb_read_frames), duration: Number(video.duration), audioDuration: Number(audio.duration), bytes: (await stat(file)).size, audioPcmMatches: true, repeatDownloadMatches: true, fullDecodePassed: true, durationSeconds: Math.round((performance.now() - started) / 1000) });
    console.log(`PASS ${resolution}: ${fps} fps / ${frames} frames / 30 seconds / AAC sync / repeated download`);
  }
  assert.equal(runtime.page.errors.length, 0, runtime.page.errors.join('\n'));
  report.passed = true;
} catch (error) {
  report.error = error.stack || String(error); console.error(error); process.exitCode = 1;
} finally {
  await runtime?.close(); await rm(directory, { recursive: true, force: true });
  report.completedAt = new Date().toISOString();
  await writeFile(path.join(output, 'browser-export-verification.json'), JSON.stringify(report, null, 2) + '\n');
}
