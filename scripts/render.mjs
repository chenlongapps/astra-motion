import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { openRenderPages } from './browser.mjs';
import { selectRenderOptions } from './render-options.mjs';
import { checkFrameCache, frameCacheMetadata, writeFrameCacheMetadata } from './frame-cache.mjs';
import { generateAudio, soundtrack } from './generate-audio.mjs';
import { checkVideoEncoder, selectVideoEncoder, writeVideoFrame } from './video-encoder.mjs';
import { acquireRenderLock, createRenderWorkspace } from './render-lock.mjs';
import { createFrameCapture, selectCaptureMode } from './frame-capture.mjs';
import { createFrameQueue } from './frame-queue.mjs';
import { createExportProgress, createEncoderFeed, loadPhaseEstimates } from './render-progress.mjs';

const startedAt = performance.now();
const run = promisify(execFile), validationAbort = new AbortController();
const resolution = selectRenderOptions(process.argv.slice(2)), { width, height, output, fps, frames: frameCount, duration } = resolution;
const timings = { audio: 0, browserStartup: 0, draw: 0, screenshots: 0, frameWrites: 0, encoderWait: 0, encodingWall: 0, validation: 0, total: 0 };
const timingsSeconds = () => Object.fromEntries(Object.entries(timings).map(([key, ms]) => [key, Math.round(ms / 10) / 100]));
const refreshArgument = process.argv.find(arg => arg.startsWith('--refresh-frames='));
const refreshRanges = refreshArgument?.slice('--refresh-frames='.length).split(',').map(range => range.split(':').map(Number));
if (refreshRanges?.some(range => range.length !== 2 || range.some(f => !Number.isInteger(f) || f < 0 || f >= frameCount) || range[0] > range[1])) throw new Error(`Use --refresh-frames=START:END[,START:END] with inclusive frame indices 0–${frameCount - 1}.`);
if (refreshRanges && process.argv.includes('--samples')) throw new Error('--refresh-frames cannot be combined with --samples.');
const sampleOnly = process.argv.includes('--samples') || !!refreshRanges;
const plannedFrames = refreshRanges ? refreshRanges.reduce((sum, [start, end]) => sum + (end - start + 1), 0) : sampleOnly ? duration * 2 + 1 : frameCount;
const keepFrames = process.argv.includes('--keep-frames') || !!refreshRanges;
const fromFrames = process.argv.includes('--from-frames');
if (fromFrames && sampleOnly) throw new Error('--from-frames cannot be combined with --samples.');
// The ETA tail only counts phases this run performs.
const plannedPhases = [...(fromFrames || refreshRanges ? ['cache'] : []), ...(sampleOnly ? [] : ['audio']), ...(fromFrames ? [] : ['browser', 'capture']), ...(sampleOnly ? [] : ['encode', 'validate'])];
const videoEncoder = selectVideoEncoder(process.argv.slice(2), resolution);
const captureMode = selectCaptureMode(process.argv.slice(2));
const file = path.join(output, 'astra-motion.mp4');
const lock = await acquireRenderLock(output);
if (lock.recoveredOwner) console.log(`Recovered interrupted export lock (PID ${lock.recoveredOwner.pid}); no active FFmpeg found.`);
// Seed the ETA from the previous export of the same profile so even the first
// phase can estimate the rest of the pipeline.
const progress = createExportProgress({
  label: `${resolution.name}${fps} ${refreshRanges ? 'refresh' : sampleOnly ? 'samples' : 'export'}`,
  estimates: await loadPhaseEstimates(path.join(output, 'ffprobe.json'), { resolution: resolution.name, fps, encoder: sampleOnly ? undefined : videoEncoder, source: fromFrames ? 'cached-png' : 'browser-png', frames: plannedFrames }),
  phases: plannedPhases,
});
let runtime, capture, workspace, temporary, encoder, encoding, encodingStartedAt, lastFrame = -1, interrupted = false, encodedFrames = 0, draining = false;
// One PNG capture per render page, created before the workers start.
const captures = new Map();
function interrupt() {
  interrupted = true;
  validationAbort.abort();
  encoder?.kill('SIGTERM');
  void runtime?.browser.close().catch(() => {});
}
function checkInterrupted() { if (interrupted) throw new Error('Export interrupted.'); }
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, interrupt);
try {
  const cacheProfile = keepFrames && !sampleOnly && !fromFrames ? await frameCacheMetadata(resolution) : resolution;
  if (!sampleOnly) {
    checkVideoEncoder(videoEncoder, resolution);
    progress.note(`Video encoder: ${videoEncoder.name}${videoEncoder.hardware ? ` (hardware required; target bitrate ${videoEncoder.bitrate})` : ' (CPU; slow / CRF 18)'}.`);
  }
  progress.note(`Resolution: ${resolution.name} (${width}×${height}) / ${fps} fps; output: ${output}.`);
  await mkdir(path.join(output, 'keyframes'), { recursive: true });
  if (keepFrames) await mkdir(path.join(output, 'frames'), { recursive: true });
  if (keepFrames && !refreshRanges && !fromFrames) await rm(path.join(output, 'frames', 'manifest.json'), { force: true });
  if (fromFrames || refreshRanges) {
    progress.phase('cache', frameCount);
    await checkFrameCache(path.join(output, 'frames'), resolution, frameCount, { allowStaleSource: !!refreshRanges, onProgress: frame => progress.set(frame) });
  }
  checkInterrupted();
  // Generate before opening the player or encoder; a failed generation preserves
  // the previous soundtrack and final movie. Frame-only previews need no FFmpeg.
  if (!sampleOnly) {
    ({ workspace, temporary } = await createRenderWorkspace(output));
    progress.phase('audio');
    const start = performance.now();
    const audio = await generateAudio();
    timings.audio = performance.now() - start;
    progress.note(`Mixed imported BGM and action effects: ${audio.loudness.integratedLufs} LUFS / ${audio.cues.length} action cues${audio.reused ? ' (cached; unchanged sources)' : ''}.`);
  }
  checkInterrupted();
  const browserStartedAt = performance.now();
  // Own shutdown so the browser stops before lock cleanup.
  if (!fromFrames) progress.phase('browser');
  runtime = fromFrames ? null : await openRenderPages({ count: resolution.workers, resolution, handleSignals: false });
  if (runtime) timings.browserStartup = performance.now() - browserStartedAt;
  if (runtime && runtime.workers > 1) progress.note(`Capturing on ${runtime.workers} render pages in parallel; frames still reach the encoder in order.`);
  checkInterrupted();
  if (runtime) {
    for (const page of runtime.pages) captures.set(page, await createFrameCapture(page, resolution, captureMode));
    capture = { async close() { for (const shot of captures.values()) await shot.close(); } };
    progress.note(`PNG capture: ${captureMode}${captureMode === 'fast' ? ' (Chromium fast lossless PNG)' : ' (standard lossless PNG)'}.`);
  }
  if (!sampleOnly) {
    const input = fromFrames
      ? ['-framerate', String(fps), '-start_number', '0', '-i', path.join(output, 'frames', '%04d.png')]
      : ['-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0'];
    // Leave the MP4 index at the end, avoiding an extra in-place faststart rewrite.
    encodingStartedAt = performance.now();
    // -progress writes key=value blocks into the same pipe as warnings; feed
    // them apart so real diagnostics still reach the terminal.
    const encoderFeed = createEncoderFeed({ onFrame: frame => { encodedFrames = Math.max(encodedFrames, frame); if (draining) progress.set(encodedFrames); }, forward: line => process.stderr.write(`${line}\n`) });
    encoder = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-stats_period', '1', '-y', ...input, '-i', soundtrack, '-map', '0:v:0', '-map', '1:a:0', '-frames:v', String(frameCount), ...videoEncoder.args, '-pix_fmt', 'yuv420p', '-r', String(fps), '-c:a', 'aac', '-b:a', '192k', '-af', `atrim=duration=${duration},asetpts=PTS-STARTPTS`, '-t', String(duration), '-progress', 'pipe:2', temporary], { stdio: [fromFrames ? 'ignore' : 'pipe', 'ignore', 'pipe'] });
    encoder.stderr?.on('data', chunk => encoderFeed.push(chunk.toString()));
    encoding = new Promise((resolve, reject) => { encoder.on('error', reject); encoder.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with ${code}`))); });
    // Prevent an unhandled rejection if FFmpeg exits before the screenshot loop does.
    encoding.catch(() => {});
    encoder.stdin?.on('error', () => {});
  }
  const frames = refreshRanges ? [...new Set(refreshRanges.flatMap(([start, end]) => Array.from({ length: end - start + 1 }, (_, i) => start + i)))].sort((a, b) => a - b) : sampleOnly ? [...Array.from({ length: duration * 2 }, (_, i) => i * fps / 2), frameCount - 1] : Array.from({ length: frameCount }, (_, i) => i);
  // Shared by every capture worker: one writer keeps the encoder, the frame
  // cache, and the progress counter moving strictly in frame order.
  async function writeFrameAsset(f, png) {
    let start = performance.now();
    if (f % (fps / 2) === 0 || f === frameCount - 1) await writeFile(path.join(output, 'keyframes', `${String(f).padStart(4, '0')}.png`), png);
    if (keepFrames) await writeFile(path.join(output, 'frames', `${String(f).padStart(4, '0')}.png`), png);
    timings.frameWrites += performance.now() - start;
    if (encoder) {
      start = performance.now();
      await writeVideoFrame(encoder, png);
      timings.encoderWait += performance.now() - start;
    }
    lastFrame = f;
    progress.advance(1);
  }
  if (!fromFrames) {
    progress.phase('capture', frames.length);
    // The pages render concurrently while the writer above keeps the encoder,
    // the frame cache and the progress counter in frame order. A page receives
    // its next frame only once the current one is written, so at most one frame
    // per page is held in memory, whatever the resolution.
    const queue = createFrameQueue({ total: frames.length, write: (png, index) => writeFrameAsset(frames[index], png) });
    let assigned = 0;
    const captureWorker = async page => {
      try {
        for (;;) {
          checkInterrupted();
          if (queue.failure) throw queue.failure;
          const index = assigned++;
          if (index >= frames.length) return;
          const f = frames[index];
          let start = performance.now();
          await page.evaluate(frame => window.renderFrame(frame), f);
          timings.draw += performance.now() - start;
          start = performance.now();
          const png = await captures.get(page).capture();
          timings.screenshots += performance.now() - start;
          await queue.publish(index, png);
        }
      } catch (error) { queue.abort(error); throw error; }
    };
    // Wait for every page: one failing page must stop the export before FFmpeg
    // receives an incomplete sequence.
    const results = await Promise.allSettled(runtime.pages.map(page => captureWorker(page)));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  }
  if (runtime?.errors.length) throw new Error(runtime.errors.join('\n'));
  checkInterrupted();
  if (keepFrames && !sampleOnly && !fromFrames) await writeFrameCacheMetadata(path.join(output, 'frames'), cacheProfile);
  if (refreshRanges) progress.note(`Refreshed ${frames.length} cached frames; run verify:frames with the same --resolution and --fps before --from-frames.`);
  if (encoder) {
    if (fromFrames) progress.note(`Encoding the cached ${frameCount}-frame sequence…`);
    progress.phase('encode', frameCount);
    draining = true;
    const start = performance.now();
    encoder.stdin?.end(); await encoding;
    draining = false;
    timings.encoderWait += performance.now() - start;
    timings.encodingWall = performance.now() - encodingStartedAt;
    progress.phase('validate');
    const validationStartedAt = performance.now();
    const probe = await run('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', temporary], { encoding: 'utf8', signal: validationAbort.signal, maxBuffer: 2 ** 20 });
    const info = JSON.parse(probe.stdout);
    const video = info.streams.find(s => s.codec_type === 'video'), audio = info.streams.find(s => s.codec_type === 'audio');
    if (!video || video.width !== width || video.height !== height || video.avg_frame_rate !== `${fps}/1` || Number(video.nb_read_frames) !== frameCount || Math.abs(Number(video.duration) - duration) > 0.001 || !audio || Math.abs(Number(audio.duration) - duration) > 0.001 || video.pix_fmt !== 'yuv420p') throw new Error('The exported video failed its media format checks.');
    // Decode both complete streams: metadata alone cannot catch damaged media packets.
    await run('ffmpeg', ['-hide_banner', '-v', 'error', '-xerror', '-i', temporary, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'], { signal: validationAbort.signal, maxBuffer: 2 ** 20 });
    timings.validation = performance.now() - validationStartedAt;
    checkInterrupted();
    await rename(temporary, file);
    info.format.filename = file;
    info.validation = { fullDecodePassed: true, checkedAt: new Date().toISOString(), soundtrack: 'public/audio/generated.wav' };
    timings.total = performance.now() - startedAt;
    info.render = { resolution: resolution.name, width, height, fps, frames: frameCount, encoder: videoEncoder.name, hardware: videoEncoder.hardware, bitrate: videoEncoder.bitrate, capture: fromFrames ? undefined : captureMode, source: fromFrames ? 'cached-png' : 'browser-png', workers: fromFrames ? undefined : runtime?.workers, timingsSeconds: timingsSeconds() };
    await writeFile(path.join(output, 'ffprobe.json'), JSON.stringify(info, null, 2) + '\n');
    await rm(workspace, { recursive: true });
    progress.note(`Saved ${file}: ${width}×${height} / ${fps} fps / ${frameCount} frames / ${duration} seconds / locally generated original score and effects.`);
  }
  if (!encoder) timings.total = performance.now() - startedAt;
  progress.note(`Timings (seconds): ${Object.entries(timingsSeconds()).map(([key, value]) => `${key}=${value}`).join(', ')}.`);
} catch (e) {
  encoder?.kill('SIGTERM');
  await encoding?.catch(() => {});
  timings.total = performance.now() - startedAt;
  // Close the live status line so the failure report starts on a fresh line.
  progress.end();
  console.error(`Export failed after frame ${lastFrame}. Failed encodes do not replace the final MP4.${workspace ? ` Diagnostic files: ${workspace}.` : ''}`);
  console.error(`Timings (seconds): ${Object.entries(timingsSeconds()).map(([key, value]) => `${key}=${value}`).join(', ')}.`);
  throw e;
} finally {
  await capture?.close().catch(() => {});
  try { await runtime?.close(); }
  finally {
    progress.end();
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(signal, interrupt);
    await lock.release();
  }
}
