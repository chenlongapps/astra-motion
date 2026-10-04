import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readAacTrack } from '../src/mp4.js';
import timing from '../src/timing.json' with { type: 'json' };

const run = promisify(execFile);
const audioDirectory = fileURLToPath(new URL('../public/audio/', import.meta.url));
const sha256 = data => createHash('sha256').update(data).digest('hex');
export const exportAudioNames = { wav: 'generated.wav', m4a: 'generated.m4a', manifest: 'export-audio.json' };

export async function prepareExportAudio(file, directory, { runCommand = run } = {}) {
  const wav = await readFile(file), target = path.join(directory, 'export.m4a');
  await runCommand('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-i', file, '-map', '0:a:0', '-vn', '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '192k', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', '-movflags', '+faststart', target], { maxBuffer: 2 ** 20 });
  const m4a = await readFile(target), track = readAacTrack(m4a);
  if (Math.abs(track.duration - timing.frames / timing.fps) > 1 / 48000) throw new Error('The web export soundtrack must be exactly 30 seconds.');
  await runCommand('ffmpeg', ['-v', 'error', '-nostdin', '-xerror', '-i', target, '-map', '0:a:0', '-f', 'null', '-'], { maxBuffer: 2 ** 20 });
  const manifest = { version: 1, fps: timing.fps, frames: timing.frames, wavSha256: sha256(wav), m4aSha256: sha256(m4a) };
  return { m4a, manifest, manifestBytes: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') };
}

// Stage every file before publishing. Backups let a later rename failure restore
// the previous WAV/M4A/manifest pair, including an existing generation report.
export async function publishAudioFiles(files, { move = rename } = {}) {
  const id = randomUUID(), staged = [];
  try {
    for (const { file, bytes } of files) {
      await mkdir(path.dirname(file), { recursive: true });
      const item = { file, partial: `${file}.${id}.partial`, backup: `${file}.${id}.backup`, previous: false, published: false };
      staged.push(item);
      await writeFile(item.partial, bytes, { flag: 'wx' });
      try { const previous = await readFile(file); await writeFile(item.backup, previous, { flag: 'wx' }); item.previous = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    for (const item of staged) { await move(item.partial, item.file); item.published = true; }
  } catch (error) {
    const recoveryErrors = [];
    for (const item of staged.filter(item => item.published).reverse()) {
      try {
        if (item.previous) { await rename(item.backup, item.file); item.previous = false; }
        else await rm(item.file, { force: true });
      } catch (recoveryError) { item.keepBackup = true; recoveryErrors.push(recoveryError); }
    }
    if (recoveryErrors.length) throw new AggregateError([error, ...recoveryErrors], `Audio publication failed; recovery files: ${staged.filter(item => item.keepBackup && item.previous).map(item => item.backup).join(', ')}`);
    throw error;
  } finally {
    for (const item of staged) {
      await rm(item.partial, { force: true });
      if (!item.keepBackup) await rm(item.backup, { force: true });
    }
  }
}

export async function verifyExportAudio(directory = audioDirectory) {
  try {
    const [wav, m4a, bytes] = await Promise.all(Object.values(exportAudioNames).map(name => readFile(path.join(directory, name))));
    const manifest = JSON.parse(bytes), track = readAacTrack(m4a);
    if (manifest.version !== 1 || manifest.wavSha256 !== sha256(wav) || manifest.m4aSha256 !== sha256(m4a) || manifest.fps !== timing.fps || manifest.frames !== timing.frames || Math.abs(track.duration - timing.frames / timing.fps) > 1 / 48000) throw new Error('WAV, AAC or timing does not match the manifest.');
    return manifest;
  } catch (error) {
    throw new Error('网页导出音轨缺失或已过期，请运行 npm run generate:export-audio。', { cause: error });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = await mkdtemp(path.join(tmpdir(), 'astra-export-audio-'));
  try {
    const prepared = await prepareExportAudio(path.join(audioDirectory, exportAudioNames.wav), directory);
    await publishAudioFiles([
      { file: path.join(audioDirectory, exportAudioNames.m4a), bytes: prepared.m4a },
      { file: path.join(audioDirectory, exportAudioNames.manifest), bytes: prepared.manifestBytes },
    ]);
    console.log('Prepared browser export audio: 30 seconds / AAC-LC / 48 kHz stereo / 192 kbps.');
  } finally { await rm(directory, { recursive: true, force: true }); }
}
