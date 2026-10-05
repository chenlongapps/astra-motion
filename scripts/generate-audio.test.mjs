import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { audioSourceHash, backgroundFile, pcmHash, reusableAudioReport, soundtrack } from './generate-audio.mjs';
import { exportAudioNames } from './export-audio.mjs';
import { readPcmWav } from './audio/synth.mjs';

const audioDirectory = path.dirname(soundtrack);

// A cached soundtrack is only reused while the sources, the rendered PCM and
// the derived web export all still describe the same audio.
async function cacheFixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'astra-audio-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, exportAudioNames.wav), reportFile = path.join(directory, 'report.json');
  await symlink(soundtrack, file);
  await symlink(path.join(audioDirectory, exportAudioNames.m4a), path.join(directory, exportAudioNames.m4a));
  await symlink(path.join(audioDirectory, exportAudioNames.manifest), path.join(directory, exportAudioNames.manifest));
  // Derive cache metadata from tracked assets, never the ignored output/ report.
  const report = {
    audioSha256: await audioSourceHash(),
    pcmSha256: pcmHash(readPcmWav(await readFile(soundtrack)).data),
    background: { sourceSha256: pcmHash(await readFile(backgroundFile)) },
  };
  await writeFile(reportFile, JSON.stringify(report));
  return { directory, file, reportFile, report };
}

test('unchanged bundled audio is reusable without local generation output', async t => {
  const { file, reportFile, report } = await cacheFixture(t);
  const reused = await reusableAudioReport({ file, reportFile, sourceFile: backgroundFile });
  assert.deepEqual(reused, { ...report, reused: true });
});

test('changed sources, changed PCM, or a stale web export force a regeneration', async t => {
  const { directory, file, reportFile, report: valid } = await cacheFixture(t);
  const writeReport = value => writeFile(reportFile, JSON.stringify(value));
  for (const [name, value] of [['the source fingerprint', { ...valid, audioSha256: 'stale-source' }], ['the rendered PCM', { ...valid, pcmSha256: '0'.repeat(64) }], ['the imported recording', { ...valid, background: { ...valid.background, sourceSha256: '0'.repeat(64) } }]]) {
    await writeReport(value);
    assert.equal(await reusableAudioReport({ file, reportFile, sourceFile: backgroundFile }), null, `a changed ${name} must not reuse the cached soundtrack`);
  }
  // A truncated WAV breaks both the manifest and the PCM length checks.
  const truncated = path.join(directory, 'truncated.wav');
  await writeFile(truncated, (await readFile(soundtrack)).subarray(0, 4096));
  await writeReport(valid);
  assert.equal(await reusableAudioReport({ file: truncated, reportFile, sourceFile: backgroundFile }), null);
  const withoutExport = await mkdtemp(path.join(directory, 'without-export-')), alone = path.join(withoutExport, exportAudioNames.wav);
  await symlink(soundtrack, alone);
  assert.equal(await reusableAudioReport({ file: alone, reportFile, sourceFile: backgroundFile }), null, 'a WAV without the matching web export must not be reused');
  assert.equal(await reusableAudioReport({ file, reportFile: path.join(directory, 'missing.json'), sourceFile: backgroundFile }), null);
  assert.equal(await reusableAudioReport({ file, reportFile, sourceFile: path.join(directory, 'missing.m4a') }), null);
});

test('force always regenerates, whatever the cache says', async t => {
  const { file, reportFile } = await cacheFixture(t);
  assert.equal((await reusableAudioReport({ file, reportFile, sourceFile: backgroundFile }))?.reused, true);
  assert.equal(await reusableAudioReport({ file, reportFile, sourceFile: backgroundFile, force: true }), null);
});
