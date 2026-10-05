import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFrameQueue } from './frame-queue.mjs';

// Out-of-order capture must reach the writer strictly in index order.
test('out-of-order publishes are written in index order', async () => {
  const written = [];
  const queue = createFrameQueue({ total: 4, write: async (payload, index) => { await new Promise(resolve => setImmediate(resolve)); written.push(index, payload); } });
  await Promise.all([queue.publish(1, 'b'), queue.publish(0, 'a')]);
  assert.equal(queue.pending, 0);
  await Promise.all([queue.publish(3, 'd'), queue.publish(2, 'c')]);
  await queue.settled();
  assert.deepEqual(written, [0, 'a', 1, 'b', 2, 'c', 3, 'd']);
  assert.equal(queue.written, 4);
});

test('a page is only released once its own frame is written', async () => {
  const events = [];
  const queue = createFrameQueue({ total: 2, write: async payload => {
    events.push(`write:${payload}`);
    await new Promise(resolve => setImmediate(resolve));
    events.push(`written:${payload}`);
  } });
  const first = queue.publish(0, 'a').then(() => events.push('release:a'));
  const second = queue.publish(1, 'b').then(() => events.push('release:b'));
  await Promise.all([first, second]);
  // Frames are handed to the writer in order, and a page is released only after
  // its own frame reached the encoder, never before.
  assert.deepEqual(events.filter(event => /^write:/.test(event)), ['write:a', 'write:b']);
  for (const frame of ['a', 'b']) {
    assert.ok(events.indexOf(`release:${frame}`) > events.indexOf(`written:${frame}`), `release:${frame} before the frame was written`);
    assert.ok(events.indexOf(`written:${frame}`) > events.indexOf(`write:${frame}`));
  }
});

test('duplicate, already written, and out-of-range publishes are rejected', async () => {
  const queue = createFrameQueue({ total: 3, write: async () => {} });
  const first = queue.publish(0, 'a'), second = queue.publish(0, 'again');
  await assert.rejects(second, /published twice/);
  await first;
  await assert.rejects(queue.publish(0, 'late'), /already written/);
  await assert.rejects(queue.publish(3, 'beyond'), /outside the 0–2/);
  await assert.rejects(queue.publish(-1, 'before'), /outside the 0–2/);
  await Promise.all([queue.publish(1, 'b'), queue.publish(2, 'c')]);
  await queue.settled();
});

test('a failed write aborts waiting workers and reports the first failure', async () => {
  const queue = createFrameQueue({ total: 3, write: async payload => { if (payload === 'b') throw new Error('FFmpeg stopped while rendering.'); } });
  await queue.publish(0, 'a');
  await assert.rejects(queue.publish(1, 'b'), /FFmpeg stopped/);
  await assert.rejects(queue.publish(2, 'c'), /FFmpeg stopped/);
  await assert.rejects(queue.settled(), /FFmpeg stopped/);
  assert.equal(queue.pending, 0);
  // The writer claims a frame before writing it, so the failed frame counts as
  // consumed: nothing after it can be written anyway.
  assert.equal(queue.written, 2);
});

test('abort releases queued frames and later publishes fail immediately', async () => {
  const queue = createFrameQueue({ total: 4, write: async () => { await new Promise(() => {}); } });
  const stalled = queue.publish(0, 'a');
  const queued = queue.publish(1, 'b');
  queue.abort(new Error('Export interrupted.'));
  await assert.rejects(queued, /Export interrupted/);
  await assert.rejects(stalled, /Export interrupted/);
  await assert.rejects(queue.publish(2, 'c'), /Export interrupted/);
  assert.equal(queue.pending, 0);
  assert.equal(queue.written, 0);
  await assert.rejects(queue.settled(), /Export interrupted/);
});
