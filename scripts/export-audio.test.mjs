import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, writeFile, rename, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportAudioNames, prepareExportAudio, publishAudioFiles, verifyExportAudio } from './export-audio.mjs';

async function temporary(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'astra-export-audio-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('the shipped audio manifest matches WAV, AAC and the shared timeline without FFmpeg', async () => {
  const manifest = await verifyExportAudio();
  assert.equal(manifest.frames, 900); assert.equal(manifest.fps, 30);
});

test('build validation rejects stale WAV, corrupted AAC and a changed timeline', async t => {
  const directory = await temporary(t);
  const copy = async () => { for (const name of Object.values(exportAudioNames)) await cp(new URL(`../public/audio/${name}`, import.meta.url), path.join(directory, name)); };
  await copy(); await verifyExportAudio(directory);
  await writeFile(path.join(directory, exportAudioNames.wav), 'a changed soundtrack');
  await assert.rejects(verifyExportAudio(directory), /已过期/);
  await copy(); await writeFile(path.join(directory, exportAudioNames.m4a), 'corrupted audio');
  await assert.rejects(verifyExportAudio(directory), /已过期/);
  await copy();
  const manifestFile = path.join(directory, exportAudioNames.manifest), manifest = JSON.parse(await readFile(manifestFile));
  await writeFile(manifestFile, JSON.stringify({ ...manifest, frames: 899 }));
  await assert.rejects(verifyExportAudio(directory), /已过期/);
});

test('publishing restores the previous audio pair when a later rename fails', async t => {
  const directory = await temporary(t), files = ['generated.wav', 'generated.m4a', 'export-audio.json'];
  for (const file of files) await writeFile(path.join(directory, file), `old ${file}`);
  let calls = 0;
  await assert.rejects(publishAudioFiles(files.map(file => ({ file: path.join(directory, file), bytes: Buffer.from(`new ${file}`) })), {
    move: async (from, to) => { if (++calls === 3) throw new Error('simulated disk failure'); await rename(from, to); },
  }), /simulated disk failure/);
  for (const file of files) assert.equal(await readFile(path.join(directory, file), 'utf8'), `old ${file}`);
  assert.deepEqual((await readdir(directory)).sort(), files.sort());
});

test('a failed audio encode preserves source and previously published assets', async t => {
  const directory = await temporary(t), file = path.join(directory, 'generated.wav');
  await writeFile(file, 'existing WAV'); await writeFile(path.join(directory, 'generated.m4a'), 'existing AAC');
  await assert.rejects(prepareExportAudio(file, directory, { runCommand: async () => { throw new Error('encoder unavailable'); } }), /encoder unavailable/);
  assert.equal(await readFile(file, 'utf8'), 'existing WAV');
  assert.equal(await readFile(path.join(directory, 'generated.m4a'), 'utf8'), 'existing AAC');
});
