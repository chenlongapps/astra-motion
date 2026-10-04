import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import timing from '../src/timing.json' with { type: 'json' };
import backgroundConfig from './audio/background.json' with { type: 'json' };
import { compose } from './audio/score.mjs';
import { SAMPLE_RATE, renderSoundtrack, floatWav, readPcmWav } from './audio/synth.mjs';

const run = promisify(execFile);
export const root = fileURLToPath(new URL('../', import.meta.url));
export const soundtrack = path.join(root, 'public/audio/generated.wav');
export const backgroundFile = fileURLToPath(new URL(`./audio/${backgroundConfig.file}`, import.meta.url));
export const pcmHash = data => createHash('sha256').update(data).digest('hex');
export { timing };

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

export async function generateAudio({ file = soundtrack, reportFile = path.join(root, 'output/audio-generation.json'), sourceFile = backgroundFile } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'astra-motion-audio-'));
  const partial = `${file}.${path.basename(directory)}.partial.wav`;
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
      format: { sampleRate: pcm.sampleRate, channels: pcm.channels, bits: pcm.bits, samplesPerChannel: pcm.samples, duration: pcm.duration },
      pcmSha256: pcmHash(pcm.data), loudness: { integratedLufs: final.input_i, truePeakDbtp: final.input_tp, loudnessRangeLu: final.input_lra },
      voices: { music: 0, recordedBackgrounds: 1, effects: score.effects.length },
      effectsPcmSha256: pcmHash(floatWav(effects).subarray(44)),
      cues: score.groups.map(({ cue, frame, time, duration }) => ({ cue, frame, time, duration, sample: Math.round(time * SAMPLE_RATE) })),
    };
    await mkdir(path.dirname(file), { recursive: true });
    await copyFile(master, partial); await rename(partial, file);
    if (reportFile) { await mkdir(path.dirname(reportFile), { recursive: true }); await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n'); }
    return report;
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(partial, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await generateAudio();
  console.log(`Generated ${report.file}: ${report.format.duration}s / 48 kHz stereo / imported BGM / ${report.cues.length} action cues.`);
  console.log(`Master: ${report.loudness.integratedLufs} LUFS, ${report.loudness.truePeakDbtp} dBTP. PCM SHA-256: ${report.pcmSha256}`);
}
