import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateAudio, prepareSoundtrack, measureAudio, pcmHash, root, soundtrack, timing } from './generate-audio.mjs';
import { compose } from './audio/score.mjs';
import { SAMPLE_RATE, readPcmWav, renderBus, renderSoundtrack, floatWav } from './audio/synth.mjs';
import { selectRenderOptions } from './render-options.mjs';
import { verifyExportAudio } from './export-audio.mjs';

// Check real rendered PCM and decoded AAC, rather than only event timestamps.
const videoOnly = process.argv.includes('--video');
const resolution = selectRenderOptions(process.argv.slice(2));
const output = videoOnly ? resolution.output : path.join(root, 'output');
const report = { startedAt: new Date().toISOString(), passed: false, fps: resolution.fps, ...(videoOnly ? { resolution: resolution.name } : {}), checks: [], failures: [] };
async function check(name, fn) {
  try { const details = await fn(); report.checks.push({ name, passed: true, details }); console.log(`PASS ${name}`); }
  catch (error) { report.failures.push({ name, error: error.stack }); report.checks.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}

function mono(channels) {
  return Float32Array.from(channels[0], (sample, i) => (sample + channels[1][i]) / 2);
}

function alignment(reference, actual, frame) {
  const start = Math.round(frame / timing.fps * SAMPLE_RATE), length = Math.round(SAMPLE_RATE * 0.12);
  const limit = Math.round(SAMPLE_RATE / resolution.fps);
  let best = { correlation: -1, delaySamples: 0 };
  for (let lag = -limit; lag <= limit; lag++) {
    let dot = 0, aa = 0, bb = 0;
    for (let i = 0; i < length; i += 4) {
      const a = reference[start + i], b = actual[start + i + lag];
      dot += a * b; aa += a * a; bb += b * b;
    }
    const correlation = dot / Math.sqrt(aa * bb);
    if (correlation > best.correlation) best = { correlation, delaySamples: lag };
  }
  assert.ok(best.correlation > 0.94, `Decoded content does not match at frame ${frame}: ${best.correlation}`);
  // Half a frame leaves room for onset envelopes and still satisfies ±1 frame.
  assert.ok(Math.abs(best.delaySamples) < limit / 2, `Audio shifted at frame ${frame}: ${best.delaySamples} samples`);
  return { frame, ...best, delayMs: best.delaySamples / SAMPLE_RATE * 1000 };
}

let directory;
try {
  const current = readPcmWav(await readFile(soundtrack));
  const keyFrames = ['cut', 'whoosh', 'corrected', 'exportDone', 'signature'].map(key => timing.cues[key]);
  if (videoOnly) {
    const video = path.join(output, 'astra-motion.mp4');
    await check('Final MP4 contains the generated music and effects without a frame of AAC delay', async () => {
      const bytes = execFileSync('ffmpeg', ['-v', 'error', '-i', video, '-map', '0:a:0', '-ar', String(SAMPLE_RATE), '-ac', '2', '-f', 'f32le', 'pipe:1'], { maxBuffer: 20 * 2 ** 20 });
      const decoded = new Float32Array(bytes.length / 8);
      for (let i = 0; i < decoded.length; i++) decoded[i] = (bytes.readFloatLE(i * 8) + bytes.readFloatLE(i * 8 + 4)) / 2;
      assert.ok(decoded.length >= current.samples);
      const reference = mono(current.signal);
      return keyFrames.map(frame => alignment(reference, decoded, frame));
    });
    await check('AAC loudness and true peak remain comfortable after encoding', async () => {
      const measured = await measureAudio(video);
      assert.ok(Math.abs(measured.input_i + 16) <= 1);
      assert.ok(measured.input_tp <= -1, `AAC peak: ${measured.input_tp} dBTP`);
      return { integratedLufs: measured.input_i, truePeakDbtp: measured.input_tp };
    });
  } else {
    await check('Bundled WAV is exactly 30 seconds of audible, unclipped stereo PCM', async () => {
      assert.equal(current.sampleRate, SAMPLE_RATE); assert.equal(current.channels, 2); assert.equal(current.bits, 16);
      assert.equal(current.samples, timing.frames / timing.fps * SAMPLE_RATE); assert.equal(current.duration, 30);
      const stats = current.signal.map(channel => {
        let peak = 0, power = 0, sum = 0;
        for (const sample of channel) { assert.ok(Number.isFinite(sample)); peak = Math.max(peak, Math.abs(sample)); power += sample * sample; sum += sample; }
        assert.ok(peak > 0.05 && peak < 1); assert.ok(power / channel.length > 0.001);
        assert.ok(Math.abs(sum / channel.length) < 0.002, 'Excessive DC offset');
        assert.equal(channel[0], 0); assert.ok(Math.abs(channel.at(-1)) <= 1 / 32768);
        return { peak, rms: Math.sqrt(power / channel.length), dc: sum / channel.length };
      });
      const measured = await measureAudio(soundtrack);
      assert.ok(Math.abs(measured.input_i + 16) <= 1); assert.ok(measured.input_tp <= -1.49);
      return { duration: current.duration, samplesPerChannel: current.samples, channels: stats, integratedLufs: measured.input_i, truePeakDbtp: measured.input_tp };
    });
    directory = await mkdtemp(path.join(tmpdir(), 'astra-motion-audio-verify-'));
    await check('Web AAC matches the bundled WAV and preserves cue alignment after priming removal', async () => {
      const manifest = await verifyExportAudio();
      const bytes = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(root, 'public/audio/generated.m4a'), '-map', '0:a:0', '-af', 'atrim=end_sample=1440000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 20 * 2 ** 20 });
      assert.equal(bytes.length, current.samples * 8);
      const decoded = Float32Array.from({ length: current.samples }, (_, i) => (bytes.readFloatLE(i * 8) + bytes.readFloatLE(i * 8 + 4)) / 2);
      return { manifest, alignment: keyFrames.map(frame => alignment(mono(current.signal), decoded, frame)) };
    });
    await check('Two independent generations reproduce the bundled PCM byte for byte', async () => {
      const first = await generateAudio({ file: path.join(directory, 'generated.wav'), reportFile: null, exportFiles: true });
      const second = await generateAudio({ file: path.join(directory, 'second.wav'), reportFile: null });
      await verifyExportAudio(directory);
      assert.equal(first.pcmSha256, second.pcmSha256); assert.equal(first.pcmSha256, pcmHash(current.data));
      return { pcmSha256: first.pcmSha256, independentGenerations: 2, matchesBundledAsset: true, generatedWebAudioValid: true };
    });
    const score = compose(timing);
    await check('All action effects become audible within one authored frame of their visual cue', async () => {
      return score.groups.map(group => {
        const events = score.effects.filter(e => e.cue === group.cue).map(e => ({ ...e, time: e.time - group.time }));
        assert.ok(events.every(e => e.time >= 0), `Effect precedes ${group.cue}`);
        const end = Math.max(...events.map(e => e.time + e.duration));
        const channels = renderBus(events, Math.ceil(end * SAMPLE_RATE));
        const firstAudible = channels[0].findIndex((sample, i) => Math.max(Math.abs(sample), Math.abs(channels[1][i])) >= 0.001);
        // Acoustic attack envelopes are authored in time, independent of output sampling.
        assert.ok(firstAudible >= 0 && firstAudible < SAMPLE_RATE / timing.fps, `${group.cue} onset: ${firstAudible} samples`);
        return { cue: group.cue, frame: group.frame, onsetDelaySamples: firstAudible, onsetDelayMs: firstAudible / SAMPLE_RATE * 1000 };
      });
    });
    const prepared = await prepareSoundtrack();
    await check('Replacing the BGM preserves all existing action-effect samples', async () => {
      const original = renderSoundtrack(score, timing).effects;
      assert.deepEqual(prepared.effects, original);
      return { effects: score.effects.length, cues: score.groups.length, effectsPcmSha256: pcmHash(floatWav(prepared.effects).subarray(44)), background: prepared.background };
    });
    await check('Mastering preserves imported BGM and actual transient timing at five key moments', async () => {
      const reference = mono(prepared.mix), actual = mono(current.signal);
      return keyFrames.map(frame => alignment(reference, actual, frame));
    });
  }
} catch (error) { report.failures.push({ name: 'Audio verification setup', error: error.stack }); }
finally {
  if (directory) await rm(directory, { recursive: true, force: true });
  report.completedAt = new Date().toISOString(); report.passed = report.failures.length === 0;
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, videoOnly ? 'audio-video-verification.json' : 'audio-verification.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(`${report.checks.filter(c => c.passed).length}/${report.checks.length} audio checks passed.`);
if (!report.passed) process.exitCode = 1;
