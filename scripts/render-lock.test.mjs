import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { acquireRenderLock, createRenderWorkspace } from './render-lock.mjs';

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'astra-render-lock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('only one concurrent exporter can own an output directory', async t => {
  const directory = await temporaryDirectory(t);
  const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => acquireRenderLock(directory)));
  const owners = attempts.filter(result => result.status === 'fulfilled');
  assert.equal(owners.length, 1);
  for (const result of attempts.filter(result => result.status === 'rejected')) assert.match(result.reason.message, /directory is locked/);
  const lock = owners[0].value, owner = JSON.parse(await readFile(lock.file, 'utf8'));
  assert.equal(owner.pid, process.pid);
  assert.ok(owner.token && owner.startedAt);
  await lock.release(); await lock.release();
  await assert.rejects(access(lock.file), { code: 'ENOENT' });
  const next = await acquireRenderLock(directory);
  await next.release();
});

test('1080p and 4K directories can be locked independently', async t => {
  const directory = await temporaryDirectory(t);
  const hd = await acquireRenderLock(directory), uhd = await acquireRenderLock(path.join(directory, '4k'));
  await hd.release(); await uhd.release();
});

test('incomplete or invalid lock metadata is not automatically reclaimed', async t => {
  const directory = await temporaryDirectory(t), file = path.join(directory, '.render.lock');
  for (const owner of [null, { pid: 99999999 }, { pid: 0, token: 'interrupted' }, { pid: -1, token: 'interrupted' }, { pid: '99999999', token: 'interrupted' }]) {
    const value = owner ? JSON.stringify(owner) : '';
    await writeFile(file, value);
    await assert.rejects(acquireRenderLock(directory), /metadata is incomplete/);
    assert.equal(await readFile(file, 'utf8'), value);
  }
});

test('an interrupted export is recovered when its owner is gone and no FFmpeg is running', async t => {
  const directory = await temporaryDirectory(t), file = path.join(directory, '.render.lock');
  const previous = { pid: 99999999, token: 'interrupted', command: ['/old-project/scripts/render.mjs'] };
  await writeFile(file, JSON.stringify(previous));
  const lock = await acquireRenderLock(directory, { probe: () => false, processes: async () => ['/usr/bin/node', '/bin/ps'] });
  assert.deepEqual(lock.recoveredOwner, previous);
  const owner = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(owner.pid, process.pid); assert.notEqual(owner.token, previous.token);
  await assert.rejects(access(`${file}.recovery`), { code: 'ENOENT' });
  await lock.release();
  await assert.rejects(access(file), { code: 'ENOENT' });
});

test('a live lock owner is protected without scanning or signalling encoders', async t => {
  const directory = await temporaryDirectory(t), first = await acquireRenderLock(directory);
  const value = await readFile(first.file, 'utf8');
  await assert.rejects(acquireRenderLock(directory, { processes: () => assert.fail('A live owner must not trigger recovery') }), /owner is still running/);
  assert.equal(await readFile(first.file, 'utf8'), value);
  await first.release();
});

test('orphaned or unrelated FFmpeg processes prevent recovery of a dead owner lock', async t => {
  const directory = await temporaryDirectory(t), file = path.join(directory, '.render.lock');
  const value = JSON.stringify({ pid: 99999999, token: 'interrupted' });
  await writeFile(file, value);
  for (const command of ['ffmpeg', '/opt/homebrew/bin/ffmpeg', '/Applications/Video Tools/ffmpeg', '/usr/bin/FFmpeg']) {
    await assert.rejects(acquireRenderLock(directory, { probe: () => false, processes: async () => [command] }), /FFmpeg is still running/);
    assert.equal(await readFile(file, 'utf8'), value);
    await assert.rejects(access(`${file}.recovery`), { code: 'ENOENT' });
  }
});

test('failed owner or encoder process checks preserve the lock and release the recovery guard', async t => {
  const directory = await temporaryDirectory(t), file = path.join(directory, '.render.lock');
  const value = JSON.stringify({ pid: 99999999, token: 'interrupted' });
  await writeFile(file, value);
  await assert.rejects(acquireRenderLock(directory, { probe: () => { throw new Error('EPERM'); } }), /Cannot check the lock owner/);
  await assert.rejects(acquireRenderLock(directory, { probe: () => false, processes: async () => { throw new Error('ps unavailable'); } }), /Cannot check active encoders/);
  await assert.rejects(acquireRenderLock(directory, { probe: () => false, processes: async () => [] }), /process listing is empty/);
  assert.equal(await readFile(file, 'utf8'), value);
  await assert.rejects(access(`${file}.recovery`), { code: 'ENOENT' });
});

test('competing recoveries leave exactly one exporter owning the directory', async t => {
  const directory = await temporaryDirectory(t), file = path.join(directory, '.render.lock');
  await writeFile(file, JSON.stringify({ pid: 99999999, token: 'interrupted' }));
  let finishScan, scanning;
  const scanStarted = new Promise(resolve => { scanning = resolve; });
  const scan = new Promise(resolve => { finishScan = resolve; });
  const options = { probe: pid => pid === process.pid, processes: () => { scanning(); return scan; } };
  const firstAttempt = acquireRenderLock(directory, options);
  await scanStarted;
  try {
    const others = await Promise.allSettled(Array.from({ length: 7 }, () => acquireRenderLock(directory, options)));
    assert.ok(others.every(result => result.status === 'rejected' && /recovering the lock/.test(result.reason.message)));
  } finally { finishScan(['/usr/bin/node']); }
  const lock = await firstAttempt;
  const owner = await readFile(file, 'utf8');
  await assert.rejects(acquireRenderLock(directory, options), /owner is still running/);
  assert.equal(await readFile(file, 'utf8'), owner);
  await lock.release();
});

test('recovery preserves a lock whose ownership changes during the process scan', async t => {
  const directory = await temporaryDirectory(t), file = path.join(directory, '.render.lock');
  await writeFile(file, JSON.stringify({ pid: 99999999, token: 'interrupted' }));
  const replacement = JSON.stringify({ pid: process.pid, token: 'new-owner' });
  await assert.rejects(acquireRenderLock(directory, {
    probe: () => false,
    processes: async () => { await writeFile(file, replacement); return ['/usr/bin/node']; },
  }), /ownership changed during recovery/);
  assert.equal(await readFile(file, 'utf8'), replacement);
  await assert.rejects(access(`${file}.recovery`), { code: 'ENOENT' });
});

test('an existing recovery guard blocks cleanup without touching either lock', async t => {
  const directory = await temporaryDirectory(t), file = path.join(directory, '.render.lock');
  const value = JSON.stringify({ pid: 99999999, token: 'interrupted' });
  await writeFile(file, value); await writeFile(`${file}.recovery`, 'another recovery');
  await assert.rejects(acquireRenderLock(directory, { probe: () => false }), /recovering the lock/);
  assert.equal(await readFile(file, 'utf8'), value);
  assert.equal(await readFile(`${file}.recovery`, 'utf8'), 'another recovery');
});

test('cleanup refuses to remove a lock it no longer owns', async t => {
  const directory = await temporaryDirectory(t), lock = await acquireRenderLock(directory);
  await writeFile(lock.file, JSON.stringify({ token: 'someone-else', pid: process.pid }));
  await assert.rejects(lock.release(), /ownership changed/);
  assert.equal(JSON.parse(await readFile(lock.file, 'utf8')).token, 'someone-else');
});

test('each export workspace has a unique same-filesystem Astra Motion MP4 path', async t => {
  const directory = await temporaryDirectory(t);
  await mkdir(directory, { recursive: true });
  const first = await createRenderWorkspace(directory), second = await createRenderWorkspace(directory);
  assert.equal(path.basename(first.temporary), 'astra-motion.partial.mp4');
  assert.equal(path.basename(second.temporary), 'astra-motion.partial.mp4');
  assert.notEqual(first.temporary, second.temporary);
  assert.equal(path.dirname(first.workspace), directory);
  assert.equal(path.dirname(first.temporary), first.workspace);
  await writeFile(first.temporary, 'first'); await writeFile(second.temporary, 'second');
  assert.equal(await readFile(first.temporary, 'utf8'), 'first');
  assert.equal(await readFile(second.temporary, 'utf8'), 'second');
});
