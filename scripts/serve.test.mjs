import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStaticServer, byteRange } from './serve.mjs';

test('byte ranges support bounded, open, and suffix requests and reject invalid ones', () => {
  assert.deepEqual(byteRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(byteRange('bytes=8-999', 10), { start: 8, end: 9 });
  assert.deepEqual(byteRange('bytes=3-', 10), { start: 3, end: 9 });
  assert.deepEqual(byteRange('bytes=-4', 10), { start: 6, end: 9 });
  for (const value of ['bytes=-0', 'bytes=-', 'bytes=5-2', 'bytes=10-', 'bytes=0-1,3-4', 'bytes=9007199254740992-']) assert.throws(() => byteRange(value, 10));
});

test('static server serves native modules and media ranges without exposing repository files', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'astra-server-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ['src', 'public/audio', '.git']) await mkdir(path.join(directory, name), { recursive: true });
  await writeFile(path.join(directory, 'index.html'), '<h1>Player</h1>');
  await writeFile(path.join(directory, 'src/main.js'), 'export const ready = true;');
  await writeFile(path.join(directory, 'public/audio/generated.wav'), '0123456789');
  await writeFile(path.join(directory, '.git/config'), 'private');
  const server = await createStaticServer({ directory });
  t.after(() => server.close());
  assert.match(await (await fetch(server.url)).text(), /Player/);
  const module = await fetch(`${server.url}src/main.js`);
  assert.match(module.headers.get('content-type'), /javascript/);
  const media = await fetch(`${server.url}audio/generated.wav`, { headers: { Range: 'bytes=2-5' } });
  assert.equal(media.status, 206); assert.equal(media.headers.get('content-range'), 'bytes 2-5/10'); assert.equal(await media.text(), '2345');
  const head = await fetch(`${server.url}audio/generated.wav`, { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), '10'); assert.equal(await head.text(), '');
  assert.equal((await fetch(`${server.url}audio/generated.wav`, { headers: { Range: 'bytes=20-' } })).status, 416);
  for (const url of ['.git/config', 'package.json', 'src/%2e%2e/%2e%2e/etc/passwd', 'src/main.js%00', '%zz', 'missing']) assert.ok((await fetch(server.url + url)).status >= 400, url);
  assert.equal((await fetch(server.url, { method: 'POST' })).status, 405);
  const external = await mkdtemp(path.join(tmpdir(), 'astra-outside-'));
  t.after(() => rm(external, { recursive: true, force: true }));
  await writeFile(path.join(external, 'secret.js'), 'secret');
  await symlink(path.join(external, 'secret.js'), path.join(directory, 'src/secret.js'));
  assert.equal((await fetch(`${server.url}src/secret.js`)).status, 404);
});

test('preview serves copied assets directly without a public/ directory', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'astra-preview-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'fonts')); await writeFile(path.join(directory, 'fonts/test.ttf'), 'font');
  const server = await createStaticServer({ directory, publicAssets: false });
  t.after(() => server.close());
  assert.equal(await (await fetch(`${server.url}fonts/test.ttf`)).text(), 'font');
});
