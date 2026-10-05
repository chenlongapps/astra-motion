import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { audioSourceHash, backgroundFile, defaultReportFile, reusableAudioReport, soundtrack } from './generate-audio.mjs';
import { exportAudioNames } from './export-audio.mjs';

const audioDirectory = path.dirname(soundtrack);

// A cached soundtrack is only reused while the sources, the rendered PCM and
// the derived web export all still describe the same audio.
async function cacheFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'astra-audio-cache-'));
  await symlink(soundtrack, path.join(directory, exportAudioNames.wav));
  await symlink(path.join(audioDirectory, exportAudioNames.m4a), path.join(directory, exportAudioNames.m4a));
  await symlink(path.join(audioDirectory, exportAudioNames.manifest), path.join(directory, exportAudioNames.manifest));
  return directory;
}

test('the bundled report describes a reusable soundtrack while nothing changed', async t => {
  const directory = await cacheFixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const report = JSON.parse(await readFile(defaultReportFile, 'utf8'));
  await writeFile(path.join(directory, 'report.json'), JSON.stringify({ ...report, audioSha256: await audioSourceHash() }));
  const reused = await reusableAudioReport({ file: path.join(directory, exportAudioNames.wav), reportFile: path.join(directory, 'report.json'), sourceFile: backgroundFile });
  assert.equal(reused?.reused, true);
  assert.equal(reused.pcmSha256, report.pcmSha256);
});

test('changed sources, changed PCM, or a stale web export force a regeneration', async t => {
  const directory = await cacheFixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, exportAudioNames.wav), reportFile = path.join(directory, 'report.json');
  const report = JSON.parse(await readFile(defaultReportFile, 'utf8'));
  const valid = { ...report, audioSha256: await audioSourceHash() };
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
  await symlink(path.join(directory, exportAudioNames.m4a), path.join(directory, 'alone.wav'));
  assert.equal(await reusableAudioReport({ file: path.join(directory, 'alone.wav'), reportFile, sourceFile: backgroundFile }), null, 'a WAV without the matching web export must not be reused');
  assert.equal(await reusableAudioReport({ file, reportFile: path.join(directory, 'missing.json'), sourceFile: backgroundFile }), null);
  assert.equal(await reusableAudioReport({ file, reportFile, sourceFile: path.join(directory, 'missing.m4a') }), null);
});

test('force always regenerates, whatever the cache says', async t => {
  const directory = await cacheFixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, exportAudioNames.wav), reportFile = path.join(directory, 'report.json');
  const report = JSON.parse(await readFile(defaultReportFile, 'utf8'));
  await writeFile(reportFile, JSON.stringify({ ...report, audioSha256: await audioSourceHash() }));
  assert.equal(await reusableAudioReport({ file, reportFile, sourceFile: backgroundFile, force: true }), null);
});
