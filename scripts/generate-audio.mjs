import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import timing from '../src/timing.json' with { type: 'json' };
import backgroundConfig from './audio/background.json' with { type: 'json' };
import { compose } from './audio/score.mjs';
import { SAMPLE_RATE, renderSoundtrack, floatWav, readPcmWav } from './audio/synth.mjs';
import { exportAudioNames, prepareExportAudio, publishAudioFiles } from './export-audio.mjs';

const run = promisify(execFile);
export const root = fileURLToPath(new URL('../', import.meta.url));
export const soundtrack = path.join(root, 'public/audio/generated.wav');
export const backgroundFile = fileURLToPath(new URL(`./audio/${backgroundConfig.file}`, import.meta.url));
export const defaultReportFile = path.join(root, 'output/audio-generation.json');
// Everything that changes the rendered PCM: the imported recording, the
// authored timing and any synthesis or web-export code that consumes them.
const audioDirectory = 'scripts/audio';
const audioSourceFiles = ['src/timing.json', 'scripts/export-audio.mjs', ...(await readdir(path.join(root, audioDirectory))).sort().map(name => `${audioDirectory}/${name}`)];
export const pcmHash = data => createHash('sha256').update(data).digest('hex');
export { timing };

async function hashFiles(files) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(`${file}\0`);
    hash.update(await readFile(path.join(root, file)));
  }
  return hash.digest('hex');
}

// Fingerprint of everything that shapes the rendered PCM, exposed for tests.
export const audioSourceHash = () => hashFiles(audioSourceFiles);

// Re-rendering the soundtrack costs minutes of CPU and produces the very same
// bytes when nothing it depends on changed. Reuse the previous generation only
// while the sources, the rendered PCM and the web export all still agree, so a
// stale or hand-edited asset is always regenerated.
export async function reusableAudioReport({ file = soundtrack, reportFile = defaultReportFile, sourceFile = backgroundFile, force = false } = {}) {
  if (force) return null;
  let report;
  try { report = JSON.parse(await readFile(reportFile, 'utf8')); } catch { return null; }
  try {
    if (report.audioSha256 !== await hashFiles(audioSourceFiles)) return null;
    if (report.background?.sourceSha256 !== pcmHash(await readFile(sourceFile))) return null;
    const wav = await readFile(file), pcm = readPcmWav(wav);
    if (pcm.sampleRate !== SAMPLE_RATE || pcm.channels !== 2 || pcm.bits !== 16 || pcm.samples !== timing.frames / timing.fps * SAMPLE_RATE) return null;
    if (pcmHash(pcm.data) !== report.pcmSha256) return null;
    // The web export is derived from this WAV; keep it in step with the cache.
    const manifest = JSON.parse(await readFile(path.join(path.dirname(file), exportAudioNames.manifest), 'utf8'));
    if (manifest.version !== 1 || manifest.wavSha256 !== pcmHash(wav) || manifest.m4aSha256 !== pcmHash(await readFile(path.join(path.dirname(file), exportAudioNames.m4a)))) return null;
    if (manifest.fps !== timing.fps || manifest.frames !== timing.frames) return null;
  } catch { return null; }
  return { ...report, reused: true };
}

function loudnessJson(stderr) {
  const text = stderr.match(/\{\s*"input_i"[\s\S]*?\}/g)?.at(-1);
  if (!text) throw new Error('FFmpeg did not return loudness measurements.');
  const result = JSON.parse(text);
  for (const key of ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset']) {
    result[key] = Number(result[key]);
    if (!Number.isFinite(result[key])) throw new Error(`Invalid loudness measurement: ${key}`);
  }
  return result;
}

export async function measureAudio(file) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostdin', '-i', file, '-vn', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=7:print_format=json', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 2 ** 20 });
  return loudnessJson(stderr);
}

export async function prepareSoundtrack({ sourceFile = backgroundFile } = {}) {
  // Keep the supplied recording as the persistent BGM source. A missing or bad
  // input must fail instead of silently switching back to the procedural tune.
  const source = await readFile(sourceFile), measured = await measureAudio(sourceFile);
  const length = Math.round(timing.frames / timing.fps * SAMPLE_RATE);
  const gainDb = backgroundConfig.targetLufs - measured.input_i;
  const filter = `aresample=${SAMPLE_RATE},highpass=f=${backgroundConfig.highpassHz},volume=${gainDb}dB,apad=whole_len=${length},atrim=end_sample=${length},asetpts=PTS-STARTPTS`;
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-nostdin', '-i', sourceFile, '-map', '0:a:0', '-vn', '-ar', String(SAMPLE_RATE), '-ac', '2', '-af', filter, '-f', 'f32le', 'pipe:1'], { encoding: null, maxBuffer: length * 8 + 2 ** 20 });
  if (stdout.length !== length * 8) throw new Error('The decoded background has the wrong sample count.');
  const channels = [new Float32Array(length), new Float32Array(length)];
  for (let i = 0; i < length; i++) for (let c = 0; c < 2; c++) channels[c][i] = stdout.readFloatLE((i * 2 + c) * 4);
  const score = compose(timing), rendered = renderSoundtrack(score, timing, { background: channels });
  return {
    ...rendered, score,
    background: {
      title: backgroundConfig.title, originalFilename: backgroundConfig.originalFilename,
      file: path.relative(root, sourceFile), sourceSha256: pcmHash(source),
      sourceIntegratedLufs: measured.input_i, gainDb, highpassHz: backgroundConfig.highpassHz,
      startSeconds: 0, playbackRate: 1, samplesPerChannel: length,
    },
  };
}

export async function generateAudio({ file = soundtrack, reportFile = defaultReportFile, sourceFile = backgroundFile, exportFiles = file === soundtrack, force = false } = {}) {
  const reused = await reusableAudioReport({ file, reportFile, sourceFile, force });
  if (reused) return reused;
  const directory = await mkdtemp(path.join(tmpdir(), 'astra-motion-audio-'));
  try {
    const { score, mix, effects, background } = await prepareSoundtrack({ sourceFile });
    const raw = path.join(directory, 'mix.wav'), master = path.join(directory, 'master.wav');
    await writeFile(raw, floatWav(mix));
    const measured = await measureAudio(raw);
    const filter = `loudnorm=I=-16:TP=-1.5:LRA=7:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true:print_format=json,aresample=${SAMPLE_RATE},atrim=end_sample=${mix[0].length},asetpts=PTS-STARTPTS`;
    await run('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-i', raw, '-af', filter, '-ar', String(SAMPLE_RATE), '-ac', '2', '-c:a', 'pcm_s16le', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', master], { encoding: 'utf8', maxBuffer: 2 ** 20 });
    const bytes = await readFile(master), pcm = readPcmWav(bytes), final = await measureAudio(master);
    if (pcm.sampleRate !== SAMPLE_RATE || pcm.samples !== mix[0].length) throw new Error('The generated soundtrack has the wrong sample rate or length.');
    if (Math.abs(final.input_i + 16) > 1 || final.input_tp > -1.49) throw new Error(`Mastering failed: ${final.input_i} LUFS, ${final.input_tp} dBTP.`);
    let peak = 0;
    for (const channel of pcm.signal) for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
    if (peak === 0 || peak >= 1) throw new Error('The soundtrack is silent or clipped.');
    const report = {
      generatedAt: new Date().toISOString(), source: 'User-provided background recording mixed with existing procedural action effects',
      file: path.relative(root, file), background,
      audioSha256: await hashFiles(audioSourceFiles),
      format: { sampleRate: pcm.sampleRate, channels: pcm.channels, bits: pcm.bits, samplesPerChannel: pcm.samples, duration: pcm.duration },
      pcmSha256: pcmHash(pcm.data), loudness: { integratedLufs: final.input_i, truePeakDbtp: final.input_tp, loudnessRangeLu: final.input_lra },
      voices: { music: 0, recordedBackgrounds: 1, effects: score.effects.length },
      effectsPcmSha256: pcmHash(floatWav(effects).subarray(44)),
      cues: score.groups.map(({ cue, frame, time, duration }) => ({ cue, frame, time, duration, sample: Math.round(time * SAMPLE_RATE) })),
    };
    const files = [{ file, bytes }];
    if (exportFiles) {
      const browserAudio = await prepareExportAudio(master, directory);
      const audioFile = path.join(path.dirname(file), exportAudioNames.m4a);
      files.push({ file: audioFile, bytes: browserAudio.m4a }, { file: path.join(path.dirname(file), exportAudioNames.manifest), bytes: browserAudio.manifestBytes });
      report.browserExport = { file: path.relative(root, audioFile), ...browserAudio.manifest };
    }
    if (reportFile) files.push({ file: reportFile, bytes: Buffer.from(JSON.stringify(report, null, 2) + '\n') });
    await publishAudioFiles(files);
    return report;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const force = process.argv.includes('--force');
  const report = await generateAudio({ force });
  if (report.reused) {
    console.log(`Reused ${report.file}: sources unchanged since ${report.generatedAt}; PCM SHA-256: ${report.pcmSha256}. Pass --force to regenerate.`);
  } else {
    console.log(`Generated ${report.file}: ${report.format.duration}s / 48 kHz stereo / imported BGM / ${report.cues.length} action cues.`);
    console.log(`Master: ${report.loudness.integratedLufs} LUFS, ${report.loudness.truePeakDbtp} dBTP. PCM SHA-256: ${report.pcmSha256}`);
  }
}
