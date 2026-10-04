import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { openRenderer } from './browser.mjs';
import { selectResolution } from './render-options.mjs';
import { checkFrameCache } from './frame-cache.mjs';
import { generateAudio, soundtrack, timing } from './generate-audio.mjs';
import { checkVideoEncoder, selectVideoEncoder, writeVideoFrame } from './video-encoder.mjs';
import { acquireRenderLock, createRenderWorkspace } from './render-lock.mjs';
import { createFrameCapture, selectCaptureMode } from './frame-capture.mjs';

const startedAt = performance.now();
const run = promisify(execFile), validationAbort = new AbortController();
const resolution = selectResolution(process.argv.slice(2)), { width, height, output } = resolution;
const timings = { audio: 0, browserStartup: 0, draw: 0, screenshots: 0, frameWrites: 0, encoderWait: 0, encodingWall: 0, validation: 0, total: 0 };
const timingsSeconds = () => Object.fromEntries(Object.entries(timings).map(([key, ms]) => [key, Math.round(ms / 10) / 100]));
const frameCount = timing.frames, duration = frameCount / timing.fps;
const refreshArgument = process.argv.find(arg => arg.startsWith('--refresh-frames='));
const refreshRanges = refreshArgument?.slice('--refresh-frames='.length).split(',').map(range => range.split(':').map(Number));
if (refreshRanges?.some(range => range.length !== 2 || range.some(f => !Number.isInteger(f) || f < 0 || f >= frameCount) || range[0] > range[1])) throw new Error('Use --refresh-frames=START:END[,START:END] with inclusive frame indices 0–899.');
if (refreshRanges && process.argv.includes('--samples')) throw new Error('--refresh-frames cannot be combined with --samples.');
const sampleOnly = process.argv.includes('--samples') || !!refreshRanges;
const keepFrames = process.argv.includes('--keep-frames') || !!refreshRanges;
const fromFrames = process.argv.includes('--from-frames');
if (fromFrames && sampleOnly) throw new Error('--from-frames cannot be combined with --samples.');
const videoEncoder = selectVideoEncoder(process.argv.slice(2), resolution);
const captureMode = selectCaptureMode(process.argv.slice(2));
const file = path.join(output, 'astra-motion.mp4');
const lock = await acquireRenderLock(output);
if (lock.recoveredOwner) console.log(`Recovered interrupted export lock (PID ${lock.recoveredOwner.pid}); no active FFmpeg found.`);
let runtime, capture, workspace, temporary, encoder, encoding, encodingStartedAt, lastFrame = -1, interrupted = false;
function interrupt() {
  interrupted = true;
  validationAbort.abort();
  encoder?.kill('SIGTERM');
  void runtime?.browser.close().catch(() => {});
}
function checkInterrupted() { if (interrupted) throw new Error('Export interrupted.'); }
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, interrupt);
try {
  if (!sampleOnly) {
    checkVideoEncoder(videoEncoder, resolution);
    console.log(`Video encoder: ${videoEncoder.name}${videoEncoder.hardware ? ` (hardware required; target bitrate ${videoEncoder.bitrate})` : ' (CPU; slow / CRF 18)'}.`);
  }
  if (fromFrames || refreshRanges) await checkFrameCache(path.join(output, 'frames'), resolution, frameCount);
  checkInterrupted();
  console.log(`Resolution: ${resolution.name} (${width}×${height}); output: ${output}.`);
  await mkdir(path.join(output, 'keyframes'), { recursive: true });
  if (keepFrames) await mkdir(path.join(output, 'frames'), { recursive: true });
  // Generate before opening the player or encoder; a failed generation preserves
  // the previous soundtrack and final movie. Frame-only previews need no FFmpeg.
  if (!sampleOnly) {
    ({ workspace, temporary } = await createRenderWorkspace(output));
    const start = performance.now();
    const audio = await generateAudio();
    timings.audio = performance.now() - start;
    console.log(`Mixed imported BGM and action effects: ${audio.loudness.integratedLufs} LUFS / ${audio.cues.length} action cues.`);
  }
  checkInterrupted();
  const browserStartedAt = performance.now();
  // Own shutdown so the browser stops before lock cleanup.
  runtime = fromFrames ? null : await openRenderer({ resolution, handleSignals: false });
  if (runtime) timings.browserStartup = performance.now() - browserStartedAt;
  checkInterrupted();
  if (runtime) {
    capture = await createFrameCapture(runtime.page, resolution, captureMode);
    console.log(`PNG capture: ${captureMode}${captureMode === 'fast' ? ' (Chromium fast lossless PNG)' : ' (standard lossless PNG)'}.`);
  }
  if (!sampleOnly) {
    const input = fromFrames
      ? ['-framerate', String(timing.fps), '-start_number', '0', '-i', path.join(output, 'frames', '%04d.png')]
      : ['-f', 'image2pipe', '-framerate', String(timing.fps), '-i', 'pipe:0'];
    // Leave the MP4 index at the end, avoiding an extra in-place faststart rewrite.
    encodingStartedAt = performance.now();
    encoder = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', ...input, '-i', soundtrack, '-map', '0:v:0', '-map', '1:a:0', '-frames:v', String(frameCount), ...videoEncoder.args, '-pix_fmt', 'yuv420p', '-r', String(timing.fps), '-c:a', 'aac', '-b:a', '192k', '-af', `atrim=duration=${duration},asetpts=PTS-STARTPTS`, '-t', String(duration), temporary], { stdio: [fromFrames ? 'ignore' : 'pipe', 'ignore', 'inherit'] });
    encoding = new Promise((resolve, reject) => { encoder.on('error', reject); encoder.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with ${code}`))); });
    // Prevent an unhandled rejection if FFmpeg exits before the screenshot loop does.
    encoding.catch(() => {});
    encoder.stdin?.on('error', () => {});
  }
  const frames = refreshRanges ? [...new Set(refreshRanges.flatMap(([start, end]) => Array.from({ length: end - start + 1 }, (_, i) => start + i)))].sort((a, b) => a - b) : sampleOnly ? [...Array.from({ length: 60 }, (_, i) => i * 15), 899] : Array.from({ length: frameCount }, (_, i) => i);
  for (const f of fromFrames ? [] : frames) {
    checkInterrupted();
    let start = performance.now();
    await runtime.page.evaluate(frame => window.renderFrame(frame), f);
    timings.draw += performance.now() - start;
    start = performance.now();
    const png = await capture.capture();
    timings.screenshots += performance.now() - start;
    start = performance.now();
    if (f % 15 === 0 || f === 899) await writeFile(path.join(output, 'keyframes', `${String(f).padStart(4, '0')}.png`), png);
    if (keepFrames) await writeFile(path.join(output, 'frames', `${String(f).padStart(4, '0')}.png`), png);
    timings.frameWrites += performance.now() - start;
    if (encoder) {
      start = performance.now();
      await writeVideoFrame(encoder, png);
      timings.encoderWait += performance.now() - start;
    }
    lastFrame = f;
    if (f % 90 === 0 || f === 899) console.log(`Rendered ${f + 1} / 900 frames${sampleOnly ? ' (sample mode)' : ''}`);
  }
  if (runtime?.errors.length) throw new Error(runtime.errors.join('\n'));
  checkInterrupted();
  if (refreshRanges) console.log(`Refreshed ${frames.length} cached frames; use --from-frames to encode the full sequence.`);
  if (encoder) {
    if (fromFrames) console.log('Encoding the cached 900-frame sequence…');
    const start = performance.now();
    encoder.stdin?.end(); await encoding;
    timings.encoderWait += performance.now() - start;
    timings.encodingWall = performance.now() - encodingStartedAt;
    const validationStartedAt = performance.now();
    const probe = await run('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', temporary], { encoding: 'utf8', signal: validationAbort.signal, maxBuffer: 2 ** 20 });
    const info = JSON.parse(probe.stdout);
    const video = info.streams.find(s => s.codec_type === 'video'), audio = info.streams.find(s => s.codec_type === 'audio');
    if (!video || video.width !== width || video.height !== height || video.avg_frame_rate !== '30/1' || Number(video.nb_read_frames) !== 900 || Math.abs(Number(video.duration) - 30) > 0.001 || !audio || Math.abs(Number(audio.duration) - 30) > 0.001 || video.pix_fmt !== 'yuv420p') throw new Error('The exported video failed its media format checks.');
    // Decode both complete streams: metadata alone cannot catch damaged media packets.
    await run('ffmpeg', ['-hide_banner', '-v', 'error', '-xerror', '-i', temporary, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'], { signal: validationAbort.signal, maxBuffer: 2 ** 20 });
    timings.validation = performance.now() - validationStartedAt;
    checkInterrupted();
    await rename(temporary, file);
    info.format.filename = file;
    info.validation = { fullDecodePassed: true, checkedAt: new Date().toISOString(), soundtrack: 'public/audio/generated.wav' };
    timings.total = performance.now() - startedAt;
    info.render = { resolution: resolution.name, width, height, encoder: videoEncoder.name, hardware: videoEncoder.hardware, bitrate: videoEncoder.bitrate, capture: fromFrames ? undefined : captureMode, source: fromFrames ? 'cached-png' : 'browser-png', timingsSeconds: timingsSeconds() };
    await writeFile(path.join(output, 'ffprobe.json'), JSON.stringify(info, null, 2) + '\n');
    await rm(workspace, { recursive: true });
    console.log(`Saved ${file}: ${width}×${height} / 30 fps / 900 frames / 30 seconds / locally generated original score and effects.`);
  }
  if (!encoder) timings.total = performance.now() - startedAt;
  console.log(`Timings (seconds): ${Object.entries(timingsSeconds()).map(([key, value]) => `${key}=${value}`).join(', ')}.`);
} catch (e) {
  encoder?.kill('SIGTERM');
  await encoding?.catch(() => {});
  timings.total = performance.now() - startedAt;
  console.error(`Export failed after frame ${lastFrame}. Failed encodes do not replace the final MP4.${workspace ? ` Diagnostic files: ${workspace}.` : ''}`);
  console.error(`Timings (seconds): ${Object.entries(timingsSeconds()).map(([key, value]) => `${key}=${value}`).join(', ')}.`);
  throw e;
} finally {
  await capture?.close().catch(() => {});
  try { await runtime?.close(); }
  finally {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(signal, interrupt);
    await lock.release();
  }
}
